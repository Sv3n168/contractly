import asyncio
import mimetypes
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import ocr
from ..config import settings
from ..db import get_db
from ..models import Document
from ..schemas import DocumentOut
from ..services import document_out
from .contracts import get_contract

router = APIRouter(prefix="/api", tags=["documents"])

CHUNK = 1024 * 1024


async def _store_upload(file: UploadFile) -> tuple[str, str, int, str]:
    """Stream an upload into the documents directory. Returns (original, stored, size, type)."""
    original = Path(file.filename or "dokument").name[:300]
    suffix = Path(original).suffix.lower()[:10]
    stored = f"{uuid.uuid4().hex}{suffix}"
    target = settings.documents_dir / stored
    limit = settings.max_upload_mb * 1024 * 1024
    size = 0
    try:
        with target.open("wb") as fh:
            while chunk := await file.read(CHUNK):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"Datei größer als {settings.max_upload_mb} MB")
                fh.write(chunk)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    content_type = file.content_type or mimetypes.guess_type(original)[0] or "application/octet-stream"
    return original, stored, size, content_type


@router.post("/contracts/{contract_id}/documents", response_model=DocumentOut, status_code=201)
async def upload_document(
    contract_id: int,
    file: UploadFile = File(...),
    description: str | None = Form(None),
    db: Session = Depends(get_db),
):
    c = get_contract(db, contract_id)
    original, stored, size, content_type = await _store_upload(file)
    doc = Document(
        original_name=original,
        stored_name=stored,
        content_type=content_type,
        size=size,
        description=description or None,
    )
    c.documents.append(doc)
    db.commit()
    db.refresh(doc)
    return document_out(doc)


def _get_doc(db: Session, doc_id: int) -> Document:
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "Dokument nicht gefunden")
    return doc


@router.get("/documents/{doc_id}")
def download_document(doc_id: int, download: bool = False, db: Session = Depends(get_db)):
    doc = _get_doc(db, doc_id)
    path = settings.documents_dir / doc.stored_name
    if not path.is_file():
        raise HTTPException(404, "Datei fehlt im Speicher")
    media_type = doc.content_type or "application/octet-stream"
    # Only render harmless types inline; everything else (e.g. HTML) is downloaded.
    inline_ok = media_type == "application/pdf" or media_type.startswith(("image/", "text/plain"))
    disposition = "inline" if inline_ok and not download else "attachment"
    return FileResponse(
        path,
        media_type=media_type,
        filename=doc.original_name,
        content_disposition_type=disposition,
        # (CSP sandbox would break the browser's built-in PDF viewer, so PDFs are exempt.)
        headers={"X-Content-Type-Options": "nosniff"}
        | ({} if media_type == "application/pdf" else {"Content-Security-Policy": "sandbox"}),
    )


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: int, db: Session = Depends(get_db)):
    doc = _get_doc(db, doc_id)
    path = settings.documents_dir / doc.stored_name
    db.delete(doc)
    db.commit()
    path.unlink(missing_ok=True)
    return Response(status_code=204)


@router.post("/documents/{doc_id}/extract")
async def extract_document(doc_id: int, refresh: bool = False, db: Session = Depends(get_db)):
    """Extract text (PDF text layer or OCR) and suggest contract data found in it."""
    doc = _get_doc(db, doc_id)
    method = "cache"
    if refresh or not doc.extracted_text:
        path = settings.documents_dir / doc.stored_name
        if not path.is_file():
            raise HTTPException(404, "Datei fehlt im Speicher")
        try:
            text, method = await asyncio.to_thread(ocr.extract_text, path, doc.content_type)
        except ocr.OcrError as exc:
            raise HTTPException(422, f"Texterkennung fehlgeschlagen: {exc}") from exc
        doc.extracted_text = text
        db.commit()
    text = doc.extracted_text or ""
    return {
        "document_id": doc.id,
        "method": method,
        "characters": len(text),
        "text": text[:20000],
        "suggestions": ocr.detect_fields(text),
    }


@router.post("/documents/analyze", status_code=201)
async def analyze_unassigned(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a document before the contract exists and get pre-filled data for the new contract.

    The document is stored without a contract; pass its id as ``document_ids`` when creating
    the contract to attach it. Unassigned documents older than a day are cleaned up.
    """
    original, stored, size, content_type = await _store_upload(file)
    doc = Document(original_name=original, stored_name=stored, content_type=content_type, size=size)
    db.add(doc)
    db.commit()
    text, method, error = "", None, None
    try:
        text, method = await asyncio.to_thread(ocr.extract_text, settings.documents_dir / stored, content_type)
        doc.extracted_text = text
        db.commit()
    except ocr.OcrError as exc:
        error = str(exc)
    return {
        "document_id": doc.id,
        "original_name": original,
        "method": method,
        "error": error,
        "text": text[:20000],
        "suggestions": ocr.detect_fields(text) if text else [],
    }


def cleanup_unassigned(db: Session, older_than_hours: int = 24) -> int:
    cutoff = datetime.now() - timedelta(hours=older_than_hours)
    stale = db.scalars(select(Document).where(Document.contract_id.is_(None), Document.uploaded_at < cutoff)).all()
    for doc in stale:
        (settings.documents_dir / doc.stored_name).unlink(missing_ok=True)
        db.delete(doc)
    db.commit()
    return len(stale)
