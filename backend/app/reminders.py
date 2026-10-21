"""Reminder aggregation and delivery (ntfy / e-mail).

Two kinds of reminders exist:
* automatic ones derived from contracts (cancellation deadline, contract end),
* user-defined ``Reminder`` rows, optionally repeating.
"""

import asyncio
import base64
import logging
import smtplib
import ssl
import urllib.request
from datetime import date, timedelta
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import calc
from .config import settings
from .models import Contract, NotificationLog, Reminder

log = logging.getLogger("contractly.reminders")

REPEAT_MONTHS = {"monthly": 1, "quarterly": 3, "half_yearly": 6, "yearly": 12}


def next_due(reminder: Reminder) -> date:
    """Due date after completing the current occurrence of a repeating reminder."""
    months = REPEAT_MONTHS.get(reminder.repeat)
    if not months:
        return reminder.due_date
    return calc.add_months(reminder.due_date, months)


def _logged_keys(db: Session) -> set[str]:
    return set(db.scalars(select(NotificationLog.key)))


def collect(db: Session, ref: date, horizon_days: int = 60, include_dismissed: bool = False) -> list[dict]:
    """All reminders whose due date lies before ``ref + horizon_days`` (overdue ones included)."""
    horizon = ref + timedelta(days=horizon_days)
    logged = _logged_keys(db)
    items: list[dict] = []

    for c in db.scalars(select(Contract)):
        terms = calc.term_info(c, ref)
        # Monthly cancellable contracts would remind every month - only remind for real deadlines.
        if terms.cancellation_deadline and c.reminder_days is not None and not terms.flexible:
            key = f"deadline:{c.id}:{terms.cancellation_deadline.isoformat()}"
            notify = terms.cancellation_deadline - timedelta(days=c.reminder_days)
            if notify <= horizon:
                items.append(
                    {
                        "key": key,
                        "kind": "deadline",
                        "title": f"Kündigungsfrist: {c.name}",
                        "date": terms.cancellation_deadline,
                        "notify_date": notify,
                        "contract_id": c.id,
                        "contract_name": c.name,
                        "category": c.category,
                        "detail": f"Kündigen bis {terms.cancellation_deadline:%d.%m.%Y}, "
                        f"sonst Verlängerung über {terms.next_term_end:%d.%m.%Y} hinaus",
                    }
                )
        if c.end_date and c.end_date >= ref and c.reminder_days is not None:
            notify = c.end_date - timedelta(days=min(c.reminder_days, 14))
            if notify <= horizon:
                items.append(
                    {
                        "key": f"end:{c.id}:{c.end_date.isoformat()}",
                        "kind": "contract_end",
                        "title": f"Vertragsende: {c.name}",
                        "date": c.end_date,
                        "notify_date": notify,
                        "contract_id": c.id,
                        "contract_name": c.name,
                        "category": c.category,
                        "detail": "Anschlussvertrag organisiert?",
                    }
                )

    for r in db.scalars(select(Reminder).where(Reminder.done_at.is_(None))):
        notify = r.due_date - timedelta(days=r.lead_days or 0)
        if notify <= horizon:
            items.append(
                {
                    "key": f"reminder:{r.id}:{r.due_date.isoformat()}",
                    "kind": "custom",
                    "reminder_id": r.id,
                    "title": r.title,
                    "date": r.due_date,
                    "notify_date": notify,
                    "repeat": r.repeat,
                    "contract_id": r.contract_id,
                    "contract_name": r.contract.name if r.contract else None,
                    "category": r.contract.category if r.contract else None,
                    "detail": r.note,
                }
            )

    result = []
    for item in items:
        item["dismissed"] = f"dismiss:{item['key']}" in logged
        if item["dismissed"] and not include_dismissed:
            continue
        item["due"] = item["notify_date"] <= ref
        item["overdue"] = item["date"] < ref
        item["days_left"] = (item["date"] - ref).days
        result.append(item)
    result.sort(key=lambda i: (i["date"], i["title"]))
    return result


# --------------------------------------------------------------------------- delivery


def channels() -> dict[str, bool]:
    return {
        "ntfy": bool(settings.ntfy_url),
        "email": bool(settings.smtp_host and settings.smtp_to),
        "calendar": True,
    }


def _send_ntfy(title: str, body: str, link: str | None) -> None:
    req = urllib.request.Request(settings.ntfy_url, data=body.encode("utf-8"), method="POST")
    # HTTP headers must be latin-1; ntfy accepts RFC 2047 encoded titles.
    req.add_header("Title", "=?UTF-8?B?" + base64.b64encode(title.encode()).decode() + "?=")
    req.add_header("Tags", "calendar")
    if link:
        req.add_header("Click", link)
    if settings.ntfy_token:
        req.add_header("Authorization", f"Bearer {settings.ntfy_token}")
    with urllib.request.urlopen(req, timeout=15):
        pass


def _send_mail(title: str, body: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = title
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = settings.smtp_to
    msg.set_content(body)
    if settings.smtp_security == "ssl":
        server = smtplib.SMTP_SSL(
            settings.smtp_host, settings.smtp_port, timeout=20, context=ssl.create_default_context()
        )
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20)
    with server:
        if settings.smtp_security == "starttls":
            server.starttls(context=ssl.create_default_context())
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


def send(title: str, body: str, link: str | None = None) -> list[str]:
    """Send through all configured channels; returns the channels that succeeded."""
    sent = []
    if settings.ntfy_url:
        try:
            _send_ntfy(title, body, link)
            sent.append("ntfy")
        except Exception:  # noqa: BLE001 - delivery must never crash the app
            log.exception("ntfy notification failed")
    if settings.smtp_host and settings.smtp_to:
        try:
            _send_mail(title, body)
            sent.append("email")
        except Exception:  # noqa: BLE001
            log.exception("e-mail notification failed")
    return sent


def _format(item: dict) -> tuple[str, str, str | None]:
    when = item["date"].strftime("%d.%m.%Y")
    body = f"{item['title']} – fällig am {when}"
    if item.get("detail"):
        body += f"\n{item['detail']}"
    link = None
    if settings.public_url:
        link = (
            f"{settings.public_url}/#/contracts/{item['contract_id']}"
            if item.get("contract_id")
            else (f"{settings.public_url}/#/reminders")
        )
        body += f"\n{link}"
    return f"Contractly: {item['title']}", body, link


def dispatch_due(db: Session, ref: date) -> int:
    """Send notifications for due reminders that were not sent yet. Returns the number sent."""
    if not any((settings.ntfy_url, settings.smtp_host and settings.smtp_to)):
        return 0
    logged = _logged_keys(db)
    count = 0
    for item in collect(db, ref, horizon_days=0):
        key = f"sent:{item['key']}"
        if not item["due"] or key in logged:
            continue
        if send(*_format(item)):
            db.add(NotificationLog(key=key))
            db.commit()
            count += 1
    return count


async def notifier_loop(session_factory) -> None:
    interval = max(settings.notify_interval_min, 1) * 60

    def run_once() -> int:
        db = session_factory()
        try:
            return dispatch_due(db, date.today())
        finally:
            db.close()

    while True:
        try:
            sent = await asyncio.to_thread(run_once)
            if sent:
                log.info("sent %d reminder notification(s)", sent)
        except Exception:  # noqa: BLE001
            log.exception("reminder loop failed")
        await asyncio.sleep(interval)
