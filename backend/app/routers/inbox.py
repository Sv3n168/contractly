"""Letters and e-mails from providers: upload (photo, PDF, .eml) or paste, review, apply."""

import asyncio
import re
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import messages, ocr
from ..categories import is_energy
from ..db import get_db
from ..models import Contract, Document, PriceEntry, Reminder
from ..services import load_contracts
from .contracts import get_contract
from .documents import plaintext_copy, read_upload, store_bytes

router = APIRouter(prefix="/api/inbox", tags=["inbox"])

MAX_TEXT = 200_000
# Header lines kept in front of an e-mail's text, so the message can be analysed again later.
HEADER_RE = re.compile(r"^(Von|Betreff|Datum): (.*)$", re.M)


def _email_text(mail: dict) -> str:
    head = [f"Von: {mail['sender_name']} <{mail['sender_address']}>".replace(" <>", "")]
    if mail["subject"]:
        head.append(f"Betreff: {mail['subject']}")
    if mail["date"]:
        head.append(f"Datum: {mail['date']:%d.%m.%Y}")
    return "\n".join(head) + "\n\n" + mail["text"]


def _meta(text: str) -> tuple[str, dict]:
    """Split stored text into body and the e-mail header written by ``_email_text``."""
    meta: dict = {}
    body = text
    if text.startswith("Von: ") or text.startswith("Betreff: "):
        head, _, body = text.partition("\n\n")
        for key, value in HEADER_RE.findall(head):
            meta[key] = value.strip()
    sender = meta.get("Von", "")
    name, _, addr = sender.partition(" <")
    sent = messages.parse_date(meta["Datum"]) if meta.get("Datum") else None
    return body, {
        "subject": meta.get("Betreff", ""),
        "sender": name.strip(),
        "sender_address": addr.rstrip(">"),
        "sent": sent,
    }


def _ocr(doc: Document) -> str:
    try:
        with plaintext_copy(doc) as path:
            text, _method = ocr.extract_text(path, doc.content_type)
        return text
    except ocr.OcrError:
        return ""


def _receive(db: Session, filename: str, data: bytes | None, content_type: str | None, pasted: str, subject: str):
    """Store the message (encrypted) and return (document, text)."""
    if data is not None and (filename.lower().endswith(".eml") or content_type == "message/rfc822"):
        mail = messages.read_email(data)
        if subject and not mail["subject"]:
            mail["subject"] = subject
        # A PDF/photo attachment (bill, letter) is the more useful document to keep.
        attachment = next((a for a in mail["attachments"] if a["content_type"] == "application/pdf"), None) or next(
            (a for a in mail["attachments"] if a["content_type"].startswith("image/")), None
        )
        text = _email_text(mail)
        if attachment:
            stored = store_bytes(attachment["filename"], attachment["data"], attachment["content_type"])
        else:
            name = re.sub(r"[^\w äöüÄÖÜß.\-]", "", mail["subject"] or "E-Mail")[:80] or "E-Mail"
            stored = store_bytes(f"{name}.txt", text.encode(), "text/plain")
        doc = _document(db, stored, mail["subject"])
        if attachment:
            text += "\n\n" + _ocr(doc)
    elif data is not None:
        stored = store_bytes(filename, data, content_type)
        doc = _document(db, stored, subject)
        text = _ocr(doc)
        if not text.strip():
            raise HTTPException(422, "Im Dokument wurde kein Text erkannt – ist das Foto scharf und gut beleuchtet?")
    else:
        text = (f"Betreff: {subject}\n\n" if subject else "") + pasted
        name = re.sub(r"[^\w äöüÄÖÜß.\-]", "", subject or "Nachricht")[:80] or "Nachricht"
        doc = _document(db, store_bytes(f"{name}.txt", text.encode(), "text/plain"), subject)
    doc.extracted_text = text[:MAX_TEXT]
    db.commit()
    return doc, doc.extracted_text


def _document(db: Session, stored: tuple[str, str, int, str], subject: str) -> Document:
    original, stored_name, size, content_type = stored
    doc = Document(
        original_name=original,
        stored_name=stored_name,
        size=size,
        content_type=content_type,
        description=(subject or None) and subject[:300],
    )
    db.add(doc)
    db.flush()
    return doc


def _analysis(db: Session, doc: Document, contract_id: int | None = None, choose: bool = True) -> dict:
    body, meta = _meta(doc.extracted_text or "")
    contracts = load_contracts(db)
    result = messages.analyze(body, contracts=contracts, **meta)
    best = result["candidates"][0] if result["candidates"] else None
    if contract_id is None and choose and best and best["score"] >= 5:
        contract_id = best["contract_id"]
    contract = get_contract(db, contract_id) if contract_id else None
    result["contract_id"] = contract_id
    result["actions"] = messages.propose_actions(result, contract)
    result["document_id"] = doc.id
    result["text"] = (doc.extracted_text or "")[:6000]
    result["original_name"] = doc.original_name
    result["suggestions"] = result.pop("fields")
    return result


@router.post("/analyze")
async def analyze_message(
    file: UploadFile | None = File(None),
    text: str | None = Form(None, max_length=MAX_TEXT),
    subject: str | None = Form(None, max_length=300),
    db: Session = Depends(get_db),
):
    """A letter (photo/PDF), an e-mail (.eml) or pasted text: what is it, which contract, what to do?"""
    if file is None and not (text or "").strip():
        raise HTTPException(400, "Bitte ein Foto, eine PDF- oder E-Mail-Datei wählen oder den Text einfügen")
    data = await read_upload(file) if file is not None else None
    if file is not None and (file.filename or "").lower().endswith(".msg"):
        raise HTTPException(
            400,
            "Outlook-Dateien (.msg) werden nicht unterstützt – die E-Mail als .eml speichern oder den Text einfügen",
        )
    doc, _ = await asyncio.to_thread(
        _receive,
        db,
        (file.filename if file else "") or "",
        data,
        file.content_type if file else None,
        text or "",
        subject or "",
    )
    return _analysis(db, doc)


def _inbox_document(db: Session, doc_id: int) -> Document:
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "Nachricht nicht gefunden")
    return doc


@router.get("/{doc_id}")
def proposal(doc_id: int, contract_id: int | None = None, db: Session = Depends(get_db)):
    """Proposed actions for another contract (or none: ``contract_id`` omitted -> new contract)."""
    return _analysis(db, _inbox_document(db, doc_id), contract_id, choose=False)


class Action(BaseModel):
    type: str = Field(pattern="^(price|extra|confirm_cancellation|reminder|withdrawal|attach|info|new_contract)$")
    valid_from: date | None = None
    amount: float | None = Field(None, ge=-100_000, le=100_000)
    interval: str | None = None
    details: dict = Field(default_factory=dict)
    on: date | None = None
    end_date: date | None = None
    until: date | None = None
    title: str | None = Field(None, max_length=200)
    due_date: date | None = None


class ApplyIn(BaseModel):
    contract_id: int
    actions: list[Action] = Field(default_factory=list, max_length=20)


def _apply(c: Contract, a: Action, written: date, db: Session) -> str | None:
    note = f"laut Schreiben vom {written:%d.%m.%Y}"
    if a.type == "price" and a.valid_from and a.amount is not None:
        details = {k: v for k, v in a.details.items() if k in ("base_price_month", "unit_price_ct")}
        if not is_energy(c.category):
            details = {}
        c.prices.append(
            PriceEntry(
                valid_from=a.valid_from,
                amount=round(a.amount, 2),
                interval=a.interval if a.interval in ("monthly", "quarterly", "half_yearly", "yearly") else "monthly",
                note=note,
                details=details,
            )
        )
        if details or (is_energy(c.category) and "installment" in (c.attributes or {})):
            attrs = dict(c.attributes or {})
            attrs.update(details)
            if is_energy(c.category):
                attrs["installment"] = round(a.amount, 2)
            c.attributes = attrs
        return "Preis"
    if a.type == "extra" and a.amount:
        credit = a.amount < 0
        c.prices.append(
            PriceEntry(
                valid_from=a.on or written,
                amount=round(a.amount, 2),
                interval="once",
                note=f"{'Guthaben' if credit else 'Nachzahlung'} {note}",
                details={} if credit else {"kind": "extra"},
            )
        )
        return "Abrechnung"
    if a.type == "confirm_cancellation":
        c.cancellation_confirmed_on = a.on or written
        c.cancelled_on = c.cancelled_on or a.on or written
        if a.end_date:
            c.end_date = a.end_date
        return "Kündigung"
    if a.type == "reminder" and a.due_date:
        db.add(
            Reminder(
                title=(a.title or f"Schreiben prüfen: {c.name}")[:200],
                due_date=a.due_date,
                lead_days=3,
                contract_id=c.id,
            )
        )
        return "Erinnerung"
    if a.type == "withdrawal" and a.until:
        c.withdrawal_until = a.until
        return "Widerrufsfrist"
    return None


@router.post("/{doc_id}/apply")
def apply_message(doc_id: int, data: ApplyIn, db: Session = Depends(get_db)):
    doc = _inbox_document(db, doc_id)
    c = get_contract(db, data.contract_id)
    body, meta = _meta(doc.extracted_text or "")
    written = meta["sent"] or messages.letter_date(body) or date.today()
    kind = messages.classify(body, meta["subject"])
    done = [x for a in data.actions if (x := _apply(c, a, written, db))]
    # The message is always kept with the contract, labelled so it can be found again.
    doc.contract_id = c.id
    label = f"{messages.KINDS[kind]} vom {written:%d.%m.%Y}"
    doc.description = (label + (f" – {meta['subject']}" if meta["subject"] else ""))[:300]
    db.commit()
    return {"contract_id": c.id, "applied": done}
