"""Emergency folder for relatives ("Notfall-Mappe"): view, personal note, encrypted export."""

import asyncio
import base64

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import emergency
from ..db import get_db
from ..models import AppSetting, Document
from ..services import load_contracts, today
from .documents import read_document

router = APIRouter(prefix="/api/emergency", tags=["emergency"])

SETTING = "emergency"


def _folder(db: Session) -> dict:
    profile = db.get(AppSetting, "profile")
    note = db.get(AppSetting, SETTING)
    return emergency.build(
        load_contracts(db), profile.value if profile else {}, (note.value if note else {}).get("note", ""), today()
    )


@router.get("")
def get_folder(db: Session = Depends(get_db)):
    return _folder(db)


class NoteIn(BaseModel):
    note: str = Field("", max_length=5000)


@router.put("/note")
def put_note(data: NoteIn, db: Session = Depends(get_db)):
    row = db.get(AppSetting, SETTING)
    if row is None:
        db.add(AppSetting(key=SETTING, value={"note": data.note}))
    else:
        row.value = {**row.value, "note": data.note}
    db.commit()
    return {"note": data.note}


class ExportIn(BaseModel):
    passphrase: str = Field(min_length=10, max_length=200)
    include_documents: bool = True


@router.post("/export")
async def export(data: ExportIn, db: Session = Depends(get_db)):
    """A single HTML file, encrypted with the passphrase, that opens offline in any browser."""
    folder = _folder(db)
    documents: dict[int, dict] = {}
    skipped = 0
    if data.include_documents:
        budget = emergency.MAX_DOCUMENT_BYTES
        for c in folder["contracts"]:
            for d in c["documents"]:
                if d["size"] > budget:
                    skipped += 1
                    continue
                doc = db.get(Document, d["id"])
                content = await asyncio.to_thread(read_document, doc)
                budget -= len(content)
                documents[d["id"]] = {
                    "name": doc.original_name,
                    "type": doc.content_type,
                    "data": base64.b64encode(content).decode(),
                }
    folder["skipped_documents"] = skipped
    # Key derivation and encryption take a moment: keep the event loop free.
    blob = await asyncio.to_thread(emergency.encrypt, {"folder": folder, "documents": documents}, data.passphrase)
    html = emergency.viewer_html(blob, folder["generated_on"])
    return Response(
        html,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="notfall-mappe-{folder["generated_on"]:%Y-%m-%d}.html"',
            "X-Skipped-Documents": str(skipped),
        },
    )
