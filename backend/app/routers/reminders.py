from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import reminders as svc
from ..db import get_db
from ..models import Contract, NotificationLog, Reminder
from ..schemas import ReminderIn, ReminderOut
from ..services import today

router = APIRouter(prefix="/api/reminders", tags=["reminders"])


def _get(db: Session, reminder_id: int) -> Reminder:
    r = db.get(Reminder, reminder_id)
    if r is None:
        raise HTTPException(404, "Erinnerung nicht gefunden")
    return r


def _check_contract(db: Session, contract_id: int | None) -> None:
    if contract_id is not None and db.get(Contract, contract_id) is None:
        raise HTTPException(400, "Vertrag existiert nicht")


@router.get("/upcoming")
def upcoming(
    horizon_days: int = Query(90, ge=0, le=730),
    include_dismissed: bool = False,
    db: Session = Depends(get_db),
):
    items = svc.collect(db, today(), horizon_days, include_dismissed)
    return {
        "items": items,
        "due_count": sum(1 for i in items if i["due"] and not i["dismissed"]),
        "channels": svc.channels(),
    }


@router.get("", response_model=list[ReminderOut])
def list_reminders(include_done: bool = False, db: Session = Depends(get_db)):
    stmt = select(Reminder).order_by(Reminder.due_date)
    if not include_done:
        stmt = stmt.where(Reminder.done_at.is_(None))
    return list(db.scalars(stmt))


@router.post("", response_model=ReminderOut, status_code=201)
def create_reminder(data: ReminderIn, db: Session = Depends(get_db)):
    _check_contract(db, data.contract_id)
    r = Reminder(**data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.put("/{reminder_id}", response_model=ReminderOut)
def update_reminder(reminder_id: int, data: ReminderIn, db: Session = Depends(get_db)):
    r = _get(db, reminder_id)
    _check_contract(db, data.contract_id)
    for key, value in data.model_dump().items():
        setattr(r, key, value)
    db.commit()
    db.refresh(r)
    return r


@router.post("/{reminder_id}/done", response_model=ReminderOut)
def complete_reminder(reminder_id: int, db: Session = Depends(get_db)):
    """Completes a reminder; repeating reminders move on to their next occurrence."""
    r = _get(db, reminder_id)
    if r.repeat in svc.REPEAT_MONTHS:
        r.due_date = svc.next_due(r)
    else:
        r.done_at = today()
    db.commit()
    db.refresh(r)
    return r


@router.delete("/{reminder_id}", status_code=204)
def delete_reminder(reminder_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, reminder_id))
    db.commit()
    return Response(status_code=204)


@router.post("/dismiss")
def dismiss(key: str = Query(min_length=3, max_length=180), db: Session = Depends(get_db)):
    """Hide an automatic reminder (e.g. a deadline the user consciously lets pass)."""
    db.add(NotificationLog(key=f"dismiss:{key}"))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return {"ok": True}


@router.post("/test")
def test_notification():
    channels = svc.channels()
    if not (channels["ntfy"] or channels["email"]):
        raise HTTPException(400, "Kein Benachrichtigungskanal konfiguriert (ntfy oder SMTP)")
    sent = svc.send("Contractly: Testbenachrichtigung", "Benachrichtigungen funktionieren 🎉")
    if not sent:
        raise HTTPException(502, "Versand fehlgeschlagen – siehe Container-Log")
    return {"sent": sent}
