"""Contractly thinks along: what a contract still lacks, and short computed insights.

``gaps`` names the data a running contract misses for the cancellation letter, the emergency folder
or the energy forecast. ``insights`` finds a few things worth knowing across all contracts (cost
trend and its driver, several subscriptions of one kind, monthly paid insurance, prices unchanged
for years) and ranks them by the money involved.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy.orm import Session

from . import calc
from .categories import CATEGORY_MAP
from .models import AppSetting, Contract

IGNORED_GAPS = "ignored_gaps"  # attributes key: gaps the user doesn't need for this contract
DISMISSED = "insights_dismissed"  # app setting: insight key -> day it was dismissed
DISMISS_DAYS = 365

ENERGY = ("electricity", "gas")
INSURANCE = ("car_insurance", "legal_protection", "liability", "household", "insurance")
SUBSCRIPTIONS = {"streaming": "Streaming-Abos", "fitness": "Fitness-Verträge"}
# tariffs that usually get cheaper for new customers than for loyal ones
NEW_CUSTOMER_MARKETS = ("mobile", "internet", "electricity", "gas")


def _euro(v: float) -> str:
    return f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def _label(category: str) -> str:
    return CATEGORY_MAP.get(category, {}).get("label", category)


# ------------------------------------------------------------------ gaps


def gaps(c: Contract, ref: date) -> list[dict]:
    """Missing data of a running contract, each with the form field that takes it."""
    if calc.contract_state(c, ref) != "active":
        return []
    attrs = c.attributes or {}
    out: list[dict] = []

    def add(key: str, label: str, why: str, field: str) -> None:
        out.append({"key": key, "label": label, "why": why, "field": field})

    if c.category != "loan":
        if not (c.provider_address or "").strip() and c.category != "streaming":
            add("address", "Anschrift des Anbieters", "für das Kündigungsschreiben", "provider_address")
        if not (c.customer_number or c.contract_number):
            add(
                "numbers",
                "Kunden- oder Vertragsnummer",
                "damit der Anbieter dich bei einer Kündigung zuordnet",
                "customer_number",
            )
        if c.notice_value is None:
            add("notice", "Kündigungsfrist", "sonst kann Contractly nicht an die Frist erinnern", "notice_value")
    if not c.documents:
        add("document", "Vertragsunterlagen", "für die Notfall-Mappe und falls es Streit gibt", "documents")
    if c.category in ENERGY:
        if not attrs.get("consumption_kwh") and len(c.meter_readings) < 2:
            add(
                "consumption",
                "Jahresverbrauch",
                "für die Prognose von Nachzahlung oder Guthaben",
                "attr_consumption_kwh",
            )
        current = calc.price_at(c, ref)
        unit = (current.details or {}).get("unit_price_ct") if current is not None else None
        if unit is None and attrs.get("unit_price_ct") is None:
            add("unit_price", "Arbeitspreis", "für die Prognose und den Tarifvergleich", "attr_unit_price_ct")
    ignored = set(attrs.get(IGNORED_GAPS) or [])
    return [g for g in out if g["key"] not in ignored]


def gap_ack(contract_id: int, gap_key: str) -> str:
    """Key under which the dashboard's "open data" note was acknowledged for one gap."""
    return f"gap:{contract_id}:{gap_key}"


def incomplete(contracts: list[Contract], ref: date, acknowledged: set[str] = frozenset()) -> list[dict]:
    """Contracts with open data, without the gaps already acknowledged on the dashboard."""
    out = []
    for c in contracts:
        missing = [{**g, "ack": gap_ack(c.id, g["key"])} for g in gaps(c, ref)]
        missing = [g for g in missing if g["ack"] not in acknowledged]
        if missing:
            out.append({"contract_id": c.id, "name": c.name, "category": c.category, "gaps": missing})
    return out


# ------------------------------------------------------------------ insights


def _active(value: dict, ref: date) -> dict:
    """Dismissals of the last year (older ones show again)."""
    keep = {}
    for key, day in value.items():
        try:
            if (ref - date.fromisoformat(day)).days < DISMISS_DAYS:
                keep[key] = day
        except (TypeError, ValueError):
            continue
    return keep


def dismissed(db: Session, ref: date) -> set[str]:
    return set(_active(_stored(db), ref))


def dismiss(db: Session, keys: list[str], ref: date) -> None:
    _store(db, {**_active(_stored(db), ref), **dict.fromkeys(keys, ref.isoformat())})


def restore(db: Session, keys: list[str]) -> None:
    """Undo a dismissal."""
    _store(db, {k: v for k, v in _stored(db).items() if k not in keys})


def _stored(db: Session) -> dict:
    row = db.get(AppSetting, DISMISSED)
    return dict(row.value) if row else {}


def _store(db: Session, value: dict) -> None:
    row = db.get(AppSetting, DISMISSED)
    if row is None:
        db.add(AppSetting(key=DISMISSED, value=value))
    else:
        row.value = value
    db.commit()


def _trend(contracts: list[Contract], ref: date) -> dict | None:
    year_ago = calc.add_months(ref, -12)
    by_cat: dict[str, float] = defaultdict(float)
    before = now = 0.0
    for c in contracts:
        old, new = calc.current_monthly_cost(c, year_ago), calc.current_monthly_cost(c, ref)
        before += old
        now += new
        by_cat[c.category] += new - old
    delta = now - before
    if not before or abs(delta) < 5 or abs(delta) / before < 0.03:
        return None
    up = delta > 0
    driver, amount = max(by_cat.items(), key=lambda kv: kv[1] if up else -kv[1])
    since = year_ago.strftime("%m/%Y")
    text = (
        f"Deine Fixkosten sind seit {since} um {_euro(abs(delta))} im Monat {'gestiegen' if up else 'gesunken'} "
        f"({'+' if up else '−'}{abs(delta) / before * 100:.0f} %)"
    )
    if (amount > 0) == up and abs(amount) >= abs(delta) * 0.4:
        text += f", vor allem durch {_label(driver)} ({'+' if up else '−'}{_euro(abs(amount))})"
    return {
        "key": f"trend:{ref.year}-{ref.month}",
        "kind": "trend",
        "tone": "warn" if up else "good",
        "title": "Kostenentwicklung",
        "text": text + ".",
        "link": "#/costs",
        "action": "Auswertung",
        "weight": abs(delta) * 12,
    }


def _bundles(contracts: list[Contract], ref: date) -> list[dict]:
    out = []
    for cat, many in SUBSCRIPTIONS.items():
        group = [c for c in contracts if c.category == cat]
        if len(group) < 2:
            continue
        monthly = sum(calc.current_monthly_cost(c, ref) for c in group)
        if monthly <= 0:
            continue
        names = ", ".join(c.name for c in group[:3]) + (" …" if len(group) > 3 else "")
        out.append(
            {
                "key": f"bundle:{cat}:{len(group)}",
                "kind": "bundle",
                "tone": "info",
                "title": f"{len(group)} {many}",
                "text": f"{names} kosten zusammen {_euro(monthly)} im Monat – {_euro(monthly * 12)} im Jahr. "
                "Nutzt du alle noch?",
                "link": "#/contracts",
                "action": "Ansehen",
                "weight": monthly * 12 * 0.3,
            }
        )
    return out


def _yearly_payment(contracts: list[Contract], ref: date) -> list[dict]:
    out = []
    for c in contracts:
        if c.category not in INSURANCE:
            continue
        p = calc.price_at(c, ref)
        if p is None or p.interval != "monthly":
            continue
        yearly = calc.current_monthly_cost(c, ref) * 12
        if yearly < 60:
            continue
        out.append(
            {
                "key": f"yearly:{c.id}",
                "kind": "yearly",
                "tone": "info",
                "title": "Jährlich zahlen?",
                "text": f"{c.name} zahlst du monatlich. Viele Versicherer verlangen dafür einen Ratenzuschlag "
                f"von 3–5 % – bei jährlicher Zahlung wären das hier etwa {_euro(yearly * 0.04)} im Jahr weniger.",
                "link": f"#/contracts/{c.id}",
                "action": "Zum Vertrag",
                "weight": yearly * 0.04,
            }
        )
    return out


def _loyalty(contracts: list[Contract], ref: date) -> list[dict]:
    out = []
    for c in contracts:
        if c.category not in NEW_CUSTOMER_MARKETS or c.offers:
            continue
        prices = calc.recurring_prices(c)
        since = max((p.valid_from for p in prices), default=c.start_date)
        months = (ref.year - since.year) * 12 + ref.month - since.month
        if months < 24:
            continue
        if c.last_checked_on and (ref - c.last_checked_on).days < 365:
            continue
        yearly = calc.current_monthly_cost(c, ref) * 12
        if yearly <= 0:
            continue
        years = months // 12
        out.append(
            {
                "key": f"loyal:{c.id}:{since.isoformat()}",
                "kind": "loyal",
                "tone": "info",
                "title": f"Seit {years} Jahren gleicher Tarif",
                "text": f"{c.name} läuft seit {since.strftime('%m/%Y')} unverändert ({_euro(yearly)} im Jahr). "
                "Neukundentarife sind meist günstiger – ein kurzer Vergleich lohnt sich.",
                "link": f"#/contracts/{c.id}?tab=compare",
                "action": "Vergleichen",
                "weight": yearly * 0.15,
            }
        )
    return out


def insights(db: Session, contracts: list[Contract], ref: date, limit: int = 3) -> list[dict]:
    """The few insights worth the most money, without the ones dismissed in the last year."""
    running = [c for c in contracts if calc.contract_state(c, ref) == "active"]
    found = [i for i in (_trend(contracts, ref),) if i]
    found += _bundles(running, ref) + _yearly_payment(running, ref) + _loyalty(running, ref)
    hidden = dismissed(db, ref)
    found = [i for i in found if i["key"] not in hidden]
    found.sort(key=lambda i: i["weight"], reverse=True)
    for i in found:
        i["weight"] = round(i["weight"], 2)
    return found[:limit]
