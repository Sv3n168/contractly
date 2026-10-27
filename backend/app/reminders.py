"""Reminder aggregation and delivery (ntfy / e-mail).

Two kinds of reminders exist:
* automatic ones derived from contracts (cancellation deadline, contract end),
* user-defined ``Reminder`` rows, optionally repeating.
"""

import asyncio
import base64
import ipaddress
import json
import logging
import os
import smtplib
import socket
import ssl
import urllib.request
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import calc, checkup, loans
from . import db as database
from .categories import CATEGORY_MAP, SUBSCRIPTION_CATEGORIES, is_energy
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

        items.extend(_scenario_items(c, ref, horizon))

    due = checkup.due_date(db, list(db.scalars(select(Contract))), ref)
    if due and due <= horizon:
        items.append(
            {
                "key": f"checkup:{due.year}",
                "kind": "checkup",
                "title": "Jahres-Check: 5 Minuten für deine Verträge",
                "date": due,
                "notify_date": due,
                "contract_id": None,
                "contract_name": None,
                "category": None,
                "detail": "Contractly zeigt dir nur die Verträge, bei denen sich ein Blick lohnt.",
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


def _item(c: Contract, kind: str, key_date: date, title: str, notify: date, detail: str) -> dict:
    return {
        "key": f"{kind}:{c.id}:{key_date.isoformat()}",
        "kind": kind,
        "title": title,
        "date": key_date,
        "notify_date": notify,
        "contract_id": c.id,
        "contract_name": c.name,
        "category": c.category,
        "detail": detail,
    }


def _scenario_items(c: Contract, ref: date, horizon: date) -> list[dict]:
    """Automatic reminders for everyday situations around a contract."""
    out = []
    running = c.end_date is None or c.end_date >= ref
    # Right of withdrawal (14 days after signing a new contract)
    if c.withdrawal_until and c.withdrawal_until >= ref:
        notify = c.withdrawal_until - timedelta(days=3)
        if notify <= horizon:
            title = f"Widerrufsfrist endet: {c.name}"
            out.append(
                _item(
                    c,
                    "withdrawal",
                    c.withdrawal_until,
                    title,
                    notify,
                    "Bis dahin kannst du ohne Angabe von Gründen widerrufen.",
                )
            )
    # Price guarantee ends (energy)
    guarantee = (c.attributes or {}).get("price_guarantee_until")
    if guarantee and running:
        try:
            until = date.fromisoformat(str(guarantee)[:10])
        except ValueError:
            until = None
        if until and until >= ref and until - timedelta(days=30) <= horizon:
            title = f"Preisgarantie endet: {c.name}"
            out.append(
                _item(
                    c,
                    "price_guarantee",
                    until,
                    title,
                    until - timedelta(days=30),
                    "Danach sind Preiserhöhungen möglich – guter Zeitpunkt zum Vergleichen.",
                )
            )
    # Announced price increase -> special right of cancellation until it takes effect
    prices = calc.recurring_prices(c)
    for prev, cur in zip(prices, prices[1:], strict=False):
        old_m = calc.monthly_equivalent(prev.amount, prev.interval)
        new_m = calc.monthly_equivalent(cur.amount, cur.interval)
        if running and new_m > old_m + 0.005 and cur.valid_from > ref:
            deadline = cur.valid_from - timedelta(days=1)
            notify = deadline - timedelta(days=14)
            if notify <= horizon:
                diff = f"{new_m - old_m:.2f}".replace(".", ",")
                title = f"Preiserhöhung: {c.name} (+{diff} €/Monat)"
                out.append(
                    _item(
                        c,
                        "price_increase",
                        deadline,
                        title,
                        notify,
                        "Sonderkündigungsrecht prüfen – meist bis zum Inkrafttreten möglich.",
                    )
                )
    # Cancellation sent but not confirmed yet
    if c.cancelled_on and not c.cancellation_confirmed_on and running:
        due = c.cancelled_on + timedelta(days=14)
        if due <= horizon:
            title = f"Kündigungsbestätigung fehlt: {c.name}"
            out.append(
                _item(c, "confirmation", due, title, due, "Beim Anbieter nachhaken, falls noch keine Bestätigung kam.")
            )
    # Meter readings point to a clearly higher consumption than the installment covers
    if is_energy(c.category) and running and c.meter_readings:
        e = calc.energy_analysis(c, ref) or {}
        gap = -(e.get("settlement_estimate") or 0)
        # Only warn when even the optimistic end of the forecast range means paying extra.
        sure = -(e.get("settlement_best_case") or 0) >= max(50, 0.05 * e.get("cost_low", 0))
        enough_data = e.get("forecast") and e["forecast"]["coverage"] >= 0.25
        if enough_data and e.get("needed_installment") and sure:
            amount = f"{e['needed_installment']:.2f}".replace(".", ",")
            title = f"Nachzahlung droht: {c.name} (ca. {gap:.0f} €)"
            detail = f"Abschlag auf {amount} € erhöhen, dann bleibt die Jahresabrechnung ohne Nachzahlung."
            out.append(_item(c, "installment_check", e["billing_year_end"], title, ref, detail))
    # Loans: end of the fixed-rate period, last payment, unused special repayment
    if loans.is_loan(c.category) and running:
        out.extend(_loan_items(c, ref, horizon))
    # Yearly "do I still use this?" for subscriptions
    if c.category in SUBSCRIPTION_CATEGORIES and c.end_date is None and c.start_date <= ref:
        # Yearly on the anniversary; an unanswered check stays open for two months, then waits a year.
        base = c.last_checked_on or c.start_date
        years = max(1, (ref.year - base.year) - (1 if (ref.month, ref.day) < (base.month, base.day) else 0))
        due = calc.add_months(base, 12 * years)
        if due < ref - timedelta(days=60):
            due = calc.add_months(base, 12 * (years + 1))
        if due <= horizon:
            title = f"Abo-Check: {c.name} noch genutzt?"
            out.append(_item(c, "subscription_check", due, title, due, "Wenn nicht: kündigen spart Geld."))
    return out


def _loan_items(c: Contract, ref: date, horizon: date) -> list[dict]:
    out = []
    a = loans.analysis(c, ref) or {}
    fixed = a.get("fixed_until")
    if fixed and fixed >= ref and a.get("balance_at_fixed_until"):
        notify = fixed - timedelta(days=365)  # banks offer follow-up financing about a year ahead
        if notify <= horizon:
            rest = f"{a['balance_at_fixed_until']:,.0f}".replace(",", ".")
            out.append(
                _item(
                    c,
                    "fixed_rate_end",
                    fixed,
                    f"Zinsbindung endet: {c.name}",
                    notify,
                    f"Dann noch ca. {rest} € offen – Anschlussfinanzierung vergleichen (Contractly rechnet mit).",
                )
            )
    payoff = a.get("payoff_date")
    if payoff and payoff >= ref and payoff - timedelta(days=14) <= horizon:
        out.append(
            _item(
                c,
                "loan_payoff",
                payoff,
                f"Letzte Rate: {c.name} 🎉",
                payoff - timedelta(days=14),
                "Danach prüfen, ob die Lastschrift endet – und den Vertrag in Contractly beenden.",
            )
        )
    if a.get("special_repayment_allowed") and a.get("balance"):
        due = date(ref.year, 11, 15)  # most contracts allow it once per calendar year
        done = any(d.year == ref.year for d, _ in loans.special_repayments(c))
        if not done and ref <= date(ref.year, 12, 31) and due <= horizon:
            allowed = f"{a['special_repayment_allowed']:,.0f}".replace(",", ".")
            out.append(
                _item(
                    c,
                    "special_repayment",
                    due,
                    f"Sondertilgung {ref.year}: {c.name}",
                    due,
                    f"Bis zu {allowed} € extra tilgen spart Zinsen – sonst verfällt das Recht für dieses Jahr.",
                )
            )
    return out


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
    if item["kind"] == "checkup":
        return "Jahres-Check: 5 Minuten für deine Verträge"
    if item["kind"] == "contract_end":
        return f"Vertragsende {what}"
    neutral = {
        "withdrawal": "Widerrufsfrist endet",
        "price_guarantee": "Preisgarantie endet",
        "price_increase": "Preiserhöhung – Sonderkündigung prüfen",
        "confirmation": "Kündigungsbestätigung fehlt",
        "subscription_check": "Abo-Check",
        "installment_check": "Abschlag prüfen – Nachzahlung droht",
        "fixed_rate_end": "Zinsbindung endet",
        "loan_payoff": "Letzte Kreditrate",
        "special_repayment": "Sondertilgung möglich",
    }
    if item["kind"] in neutral:
        return f"{neutral[item['kind']]} ({what})"
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
    # Numbers for the Home Assistant integration – only kept when the user created an API token.
    if vault.user(user_id).get("api_token"):
        data["summary"] = _summary(user_id, data["items"])
    else:
        data.pop("summary", None)
    _save_outbox(user_id, data)


def _summary(user_id: str, items: list[dict]) -> dict:
    from .services import contract_summary, load_contracts, on_account

    ref = date.today()
    with database.session(user_id) as db:
        summaries = [contract_summary(c, ref) for c in on_account(load_contracts(db))]
    running = [s for s in summaries if s.state in ("active", "cancelled")]
    monthly = round(sum(s.monthly_cost for s in running), 2)
    upcoming = [i for i in items if i["date"] >= ref.isoformat()]
    nxt = min(upcoming, key=lambda i: i["date"]) if upcoming else None
    return {
        "monthly_total": monthly,
        "yearly_total": round(monthly * 12, 2),
        "active_contracts": len(running),
        "due_reminders": sum(1 for i in items if i["notify_date"] <= ref.isoformat()),
        "next_date": nxt["date"] if nxt else None,
        "next_title": nxt["title"] if nxt else None,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }


# --------------------------------------------------------------------------- delivery


def ntfy_url_allowed(url: str, is_admin: bool) -> bool:
    """Members may not point the server at the internal network (only the admin decides that).

    Allowed for members: the ntfy server configured by the admin and public addresses.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    if is_admin:
        return True
    if settings.ntfy_url and parsed.hostname == urlparse(settings.ntfy_url).hostname:
        return True
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return True  # unresolvable: delivery fails anyway
    return all(ipaddress.ip_address(info[4][0].split("%")[0]).is_global for info in infos)


def _targets(user_id: str) -> dict:
    """Where to deliver a user's notifications. The admin falls back to the global env settings."""
    user = vault.user(user_id)
    cfg = user.get("settings", {})
    is_admin = user.get("role") == "admin"
    ntfy = cfg.get("ntfy_url") or (settings.ntfy_url if is_admin else "")
    if ntfy and not ntfy_url_allowed(ntfy, is_admin):  # checked again on every delivery (DNS may change)
        log.warning("ntfy address of user %s points to the internal network – skipped", user_id)
        ntfy = ""
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


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None  # a redirect must not lead the request somewhere else


_NO_REDIRECTS = urllib.request.build_opener(_RejectRedirects)


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
    with _NO_REDIRECTS.open(req, timeout=15):
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
