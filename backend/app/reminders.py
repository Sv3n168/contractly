"""Reminder aggregation and delivery (ntfy / e-mail).

Two kinds of reminders exist:
* automatic ones derived from contracts (cancellation deadline, contract end),
* user-defined ``Reminder`` rows, optionally repeating.
"""

import asyncio
import base64
import json
import logging
import os
import smtplib
import ssl
import urllib.request
from datetime import date, timedelta
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import calc
from . import db as database
from .categories import CATEGORY_MAP
from .config import settings
from .models import Contract, NotificationLog, Reminder
from .security import vault

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


# --------------------------------------------------------------------------- outbox
#
# While a user is logged out their data is encrypted and unreadable. To still deliver
# reminders (and serve the calendar feed), the upcoming reminders are kept in a small
# per-user "outbox" with dates and – unless the user opts in to contract names – only
# neutral labels such as "Kündigungsfrist Mobilfunk-Vertrag".

OUTBOX_DAYS = 400


def outbox_path(user_id: str) -> Path:
    return database.user_dir(user_id) / "outbox.json"


def load_outbox(user_id: str) -> dict:
    path = outbox_path(user_id)
    if not path.is_file():
        return {"items": [], "sent": []}
    return json.loads(path.read_text())


def _save_outbox(user_id: str, data: dict) -> None:
    path = outbox_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1, default=str))
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def _neutral_title(item: dict) -> str:
    label = CATEGORY_MAP.get(item.get("category") or "", {}).get("label")
    what = f"{label}-Vertrag" if label else "Vertrag"
    if item["kind"] == "deadline":
        return f"Kündigungsfrist {what}"
    if item["kind"] == "contract_end":
        return f"Vertragsende {what}"
    return f"Erinnerung ({what})" if item.get("contract_id") else "Eigene Erinnerung"


def refresh_outbox(user_id: str) -> None:
    """Rebuild the outbox from the (unlocked) user database."""
    if not database.is_open(user_id):
        return
    reveal = vault.user(user_id).get("settings", {}).get("reveal_names", False)
    with database.session(user_id) as db:
        items = collect(db, date.today(), horizon_days=OUTBOX_DAYS)
    data = load_outbox(user_id)
    data["items"] = [
        {
            "key": i["key"],
            "kind": i["kind"],
            "date": i["date"].isoformat(),
            "notify_date": i["notify_date"].isoformat(),
            "title": i["title"] if reveal else _neutral_title(i),
            "detail": (i.get("detail") or "") if reveal else "",
            "contract_id": i.get("contract_id"),
            "alarm_days": 14 if i["kind"] == "deadline" else None,
        }
        for i in items
    ]
    data["generated_at"] = date.today().isoformat()
    _save_outbox(user_id, data)


# --------------------------------------------------------------------------- delivery


def _targets(user_id: str) -> dict:
    """Where to deliver a user's notifications. The admin falls back to the global env settings."""
    user = vault.user(user_id)
    cfg = user.get("settings", {})
    is_admin = user.get("role") == "admin"
    ntfy = cfg.get("ntfy_url") or (settings.ntfy_url if is_admin else "")
    email = cfg.get("notify_email") or (settings.smtp_to if is_admin else "")
    return {"ntfy": ntfy, "email": email if settings.smtp_host else ""}


def channels(user_id: str) -> dict[str, bool]:
    t = _targets(user_id)
    return {
        "ntfy": bool(t["ntfy"]),
        "email": bool(t["email"]),
        "smtp_available": bool(settings.smtp_host),
        "calendar": True,
    }


def _send_ntfy(url: str, title: str, body: str, link: str | None) -> None:
    req = urllib.request.Request(url, data=body.encode("utf-8"), method="POST")
    # HTTP headers must be latin-1; ntfy accepts RFC 2047 encoded titles.
    req.add_header("Title", "=?UTF-8?B?" + base64.b64encode(title.encode()).decode() + "?=")
    req.add_header("Tags", "calendar")
    if link:
        req.add_header("Click", link)
    # The global access token only goes to the server configured via CONTRACTLY_NTFY_URL.
    if settings.ntfy_token and settings.ntfy_url and urlparse(url).netloc == urlparse(settings.ntfy_url).netloc:
        req.add_header("Authorization", f"Bearer {settings.ntfy_token}")
    with urllib.request.urlopen(req, timeout=15):
        pass


def _send_mail(to: str, title: str, body: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = title
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
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


def send(user_id: str, title: str, body: str, link: str | None = None) -> list[str]:
    """Send through the user's configured channels; returns the channels that succeeded."""
    t = _targets(user_id)
    sent = []
    if t["ntfy"]:
        try:
            _send_ntfy(t["ntfy"], title, body, link)
            sent.append("ntfy")
        except Exception:  # noqa: BLE001 - delivery must never crash the app
            log.exception("ntfy notification failed")
    if t["email"]:
        try:
            _send_mail(t["email"], title, body)
            sent.append("email")
        except Exception:  # noqa: BLE001
            log.exception("e-mail notification failed")
    return sent


def _format(item: dict) -> tuple[str, str, str | None]:
    when = date.fromisoformat(item["date"]).strftime("%d.%m.%Y")
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


def dispatch_due(user_id: str, ref: date) -> int:
    """Send due reminders of one user from the outbox (works while the user is logged out)."""
    if not any(_targets(user_id).values()):
        return 0
    data = load_outbox(user_id)
    sent = set(data.get("sent", []))
    count = 0
    for item in data.get("items", []):
        if item["notify_date"] > ref.isoformat() or item["key"] in sent:
            continue
        if send(user_id, *_format(item)):
            sent.add(item["key"])
            count += 1
    current = {i["key"] for i in data.get("items", [])}
    data["sent"] = sorted(k for k in sent if k in current)
    _save_outbox(user_id, data)
    return count


def run_notifications(ref: date | None = None) -> int:
    ref = ref or date.today()
    vault.expire_sessions()
    total = 0
    for user in vault.users():
        if user.get("status") != "active":
            continue
        uid = user["id"]
        try:
            refresh_outbox(uid)
            total += dispatch_due(uid, ref)
        except Exception:  # noqa: BLE001
            log.exception("reminders for user %s failed", uid)
    return total


async def notifier_loop() -> None:
    interval = max(settings.notify_interval_min, 1) * 60
    while True:
        try:
            sent = await asyncio.to_thread(run_notifications)
            if sent:
                log.info("sent %d reminder notification(s)", sent)
        except Exception:  # noqa: BLE001
            log.exception("reminder loop failed")
        await asyncio.sleep(interval)
