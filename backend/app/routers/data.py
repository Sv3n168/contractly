"""Start over: remove all contracts and everything attached, keep the account and the profile."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..db import documents_dir, get_db
from ..models import (
    AppSetting,
    Contract,
    Document,
    IncomeEntry,
    IncomeSource,
    MeterReading,
    NotificationLog,
    Offer,
    PriceEntry,
    Reminder,
)
from ..reminders import refresh_outbox
from .auth import current_user_id

router = APIRouter(prefix="/api/data", tags=["data"])

CONFIRM = "LÖSCHEN"
# Kept: the profile (name, address – sender of cancellation letters). Login, password, 2FA and
# notification settings live in the user store, not in this database, so they stay anyway.
KEEP_SETTINGS = ("profile",)


class ResetIn(BaseModel):
    confirm: str


@router.post("/reset")
def reset(data: ResetIn, db: Session = Depends(get_db), user_id: str = Depends(current_user_id)):
    if data.confirm.strip().upper() != CONFIRM:
        raise HTTPException(400, f"Zur Bestätigung bitte „{CONFIRM}“ eingeben")
    removed = {
        "contracts": db.scalar(select(func.count(Contract.id))) or 0,
        "income_sources": db.scalar(select(func.count(IncomeSource.id))) or 0,
        "documents": db.scalar(select(func.count(Document.id))) or 0,
    }
    files = list(db.scalars(select(Document.stored_name)))
    # children first, so no foreign key has to cascade
    for model in (IncomeEntry, IncomeSource, NotificationLog, MeterReading, Reminder, Offer, Document, PriceEntry):
        db.execute(delete(model))
    db.execute(Contract.__table__.update().values(predecessor_id=None))
    db.execute(delete(Contract))
    db.execute(delete(AppSetting).where(AppSetting.key.not_in(KEEP_SETTINGS)))
    db.commit()
    folder = documents_dir()
    for name in files:
        (folder / name).unlink(missing_ok=True)
    refresh_outbox(user_id)
    return removed
