import asyncio
import mimetypes
import os
import tempfile
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import ocr
from ..config import settings
from ..db import documents_dir, file_key, get_db
from ..models import Document
from ..schemas import DocumentOut
from ..security import decrypt_bytes, encrypt_bytes
from ..services import document_out
from .contracts import get_contract

router = APIRouter(prefix="/api", tags=["documents"])

CHUNK = 1024 * 1024


async def _store_upload(file: UploadFile) -> tuple[str, str, int, str]:
    """Encrypt an upload into the documents directory. Returns (original, stored, size, type)."""
    original = Path(file.filename or "dokument").name[:300]
    suffix = Path(original).suffix.lower()[:10]
    stored = f"{uuid.uuid4().hex}{suffix}"
    target = documents_dir() / stored
    limit = settings.max_upload_mb * 1024 * 1024
    buf = bytearray()
    while chunk := await file.read(CHUNK):
        buf.extend(chunk)
        if len(buf) > limit:
            raise HTTPException(413, f"Datei größer als {settings.max_upload_mb} MB")
    size = len(buf)
    tmp = target.with_name(stored + ".partial")
    # Encrypting up to max_upload_mb takes a moment: keep the event loop free for other users.
    sealed = await asyncio.to_thread(encrypt_bytes, bytes(buf), file_key(), stored.encode())
    await asyncio.to_thread(tmp.write_bytes, sealed)
    tmp.replace(target)
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


def read_document(doc: Document) -> bytes:
    path = documents_dir() / doc.stored_name
    if not path.is_file():
        raise HTTPException(404, "Datei fehlt im Speicher")
    return decrypt_bytes(path.read_bytes(), file_key(), doc.stored_name.encode())


@contextmanager
def plaintext_copy(doc: Document):
    """Short-lived decrypted copy for external tools (OCR), preferably in RAM (/dev/shm)."""
    shm = Path("/dev/shm")
    tmp_dir = shm if shm.is_dir() and os.access(shm, os.W_OK) else None
    with tempfile.TemporaryDirectory(dir=tmp_dir) as tmp:
        path = Path(tmp) / f"doc{Path(doc.stored_name).suffix}"
        path.write_bytes(read_document(doc))
        try:
            yield path
        finally:
            path.unlink(missing_ok=True)


def _get_doc(db: Session, doc_id: int) -> Document:
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "Dokument nicht gefunden")
    return doc


@router.get("/documents/{doc_id}")
def download_document(doc_id: int, download: bool = False, db: Session = Depends(get_db)):
    doc = _get_doc(db, doc_id)
    content = read_document(doc)
    media_type = doc.content_type or "application/octet-stream"
    # Only render harmless types inline; everything else (e.g. HTML) is downloaded.
    inline_ok = media_type == "application/pdf" or media_type.startswith(("image/", "text/plain"))
    disposition = "inline" if inline_ok and not download else "attachment"
    headers = {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(doc.original_name)}",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    # CSP sandbox would break the browser's built-in PDF viewer, so PDFs are exempt.
    if media_type != "application/pdf":
        headers["Content-Security-Policy"] = "sandbox"
    return Response(content, media_type=media_type, headers=headers)


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: int, db: Session = Depends(get_db)):
    doc = _get_doc(db, doc_id)
    path = documents_dir() / doc.stored_name
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
        try:
            with plaintext_copy(doc) as path:
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
        with plaintext_copy(doc) as path:
            text, method = await asyncio.to_thread(ocr.extract_text, path, content_type)
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
        (documents_dir() / doc.stored_name).unlink(missing_ok=True)
        db.delete(doc)
    db.commit()
    return len(stale)
