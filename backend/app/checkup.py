"""The yearly check: five minutes, once a year – only the contracts that need a decision.

Every contract gets plain-language reasons why it is worth a look (bonus used up, price went
up, price guarantee ends, never compared, subscription maybe unused, energy installment too
low, deadline coming up). The user answers each with "keep", "compare" or "cancel"; the
answers are kept for the summary at the end.
"""

from datetime import date, timedelta

from sqlalchemy.orm import Session

from . import calc
from .categories import SUBSCRIPTION_CATEGORIES, is_energy
from .models import AppSetting, Contract

SETTING = "checkup"
DUE_DAY = (1, 15)  # the check is due mid-January
COMPARABLE = {"mobile", "internet", "electricity", "gas", "car_insurance", "legal_protection", "liability", "household"}
DECISIONS = ("ok", "compare", "cancel")


def _money(v: float) -> str:
    return f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def reasons(c: Contract, today: date) -> list[dict]:
    """Why this contract deserves a look this year (empty: nothing to do)."""
    out: list[dict] = []
    year_ago = today - timedelta(days=365)
    prices = calc.recurring_prices(c)

    # Introductory price over / price went up within the last year
    for prev, cur in zip(prices, prices[1:], strict=False):
        if not (year_ago <= cur.valid_from <= today):
            continue
        old_m = calc.monthly_equivalent(prev.amount, prev.interval)
        new_m = calc.monthly_equivalent(cur.amount, cur.interval)
        if new_m > old_m * 1.005:
            promo = "aktion" in (prev.note or "").lower()
            text = (
                f"Aktionspreis ist ausgelaufen – seit {cur.valid_from:%d.%m.%Y} {_money(new_m - old_m)} mehr pro Monat"
                if promo
                else f"Seit {cur.valid_from:%d.%m.%Y} {_money(new_m - old_m)} pro Monat teurer"
            )
            out.append({"code": "promo_ended" if promo else "price_up", "text": text})
    # Switching bonus used up after the minimum term
    bonus = any(p.interval == "once" and (p.details or {}).get("kind") == "bonus" for p in c.prices)
    if bonus and c.min_term_months and calc.add_months(c.start_date, c.min_term_months) <= today:
        out.append({"code": "bonus_gone", "text": "Der Wechselbonus ist verbraucht – Neukunden zahlen oft weniger"})
    # Price guarantee
    guarantee = (c.attributes or {}).get("price_guarantee_until")
    if guarantee:
        try:
            until = date.fromisoformat(str(guarantee)[:10])
        except ValueError:
            until = None
        if until and today - timedelta(days=180) <= until <= today + timedelta(days=90):
            verb = "endet am" if until >= today else "ist abgelaufen seit"
            out.append({"code": "guarantee", "text": f"Preisgarantie {verb} {until:%d.%m.%Y}"})
    # Never compared after two years
    if c.category in COMPARABLE and not c.offers and calc.add_months(c.start_date, 24) <= today:
        years = (today - c.start_date).days // 365
        out.append({"code": "not_compared", "text": f"Seit {years} Jahren beim selben Anbieter und nie verglichen"})
    # Subscription maybe unused
    if c.category in SUBSCRIPTION_CATEGORIES:
        checked = c.last_checked_on or c.start_date
        if (today - checked).days >= 330:
            out.append({"code": "unused", "text": "Nutzt du das noch regelmäßig?"})
    # Energy: installment too low
    if is_energy(c.category) and c.meter_readings:
        e = calc.energy_analysis(c, today) or {}
        best = e.get("settlement_best_case")
        if best is not None and best < -50:
            out.append(
                {
                    "code": "backpayment",
                    "text": f"Abschlag reicht nicht – etwa {_money(-e['settlement_estimate'])} Nachzahlung",
                }
            )
    # A real cancellation deadline coming up
    terms = calc.term_info(c, today)
    if terms.cancellation_deadline and not terms.flexible and terms.cancellation_deadline <= today + timedelta(days=60):
        out.append(
            {
                "code": "deadline",
                "text": f"Kündigungsfrist bis {terms.cancellation_deadline:%d.%m.%Y} – jetzt entscheiden",
            }
        )
    return out


def state(db: Session) -> dict:
    row = db.get(AppSetting, SETTING)
    return dict(row.value) if row else {}


def _save(db: Session, value: dict) -> None:
    row = db.get(AppSetting, SETTING)
    if row is None:
        db.add(AppSetting(key=SETTING, value=value))
    else:
        row.value = value
    db.commit()


def _run(db: Session, today: date) -> dict:
    """Answers of this year's check (a new year starts a new check)."""
    s = state(db)
    if s.get("year") != today.year:
        s = {"year": today.year, "decisions": {}, "completed_on": None, "last_completed_on": s.get("completed_on")}
    return s


def overview(db: Session, contracts: list[Contract], today: date) -> dict:
    run = _run(db, today)
    decided = run["decisions"]
    items = []
    running = [c for c in contracts if c.end_date is None or c.end_date >= today]
    for c in running:
        if c.cancelled_on and str(c.id) not in decided:
            continue  # already on its way out
        why = reasons(c, today)
        if not why and str(c.id) not in decided:
            continue
        terms = calc.term_info(c, today)
        items.append(
            {
                "contract_id": c.id,
                "name": c.name,
                "provider": c.provider,
                "category": c.category,
                "monthly_cost": round(calc.current_monthly_cost(c, today), 2),
                "reasons": why,
                "cancellation_deadline": terms.cancellation_deadline,
                "next_term_end": terms.next_term_end,
                "flexible": terms.flexible,
                "decision": decided.get(str(c.id)),
            }
        )
    order = {"deadline": 0, "backpayment": 1, "promo_ended": 2, "price_up": 2, "guarantee": 3}
    items.sort(key=lambda i: (min((order.get(r["code"], 5) for r in i["reasons"]), default=9), -i["monthly_cost"]))
    return {
        "year": run["year"],
        "items": items,
        "running": len(running),
        "completed_on": run.get("completed_on"),
        "last_completed_on": run.get("last_completed_on"),
        "summary": summary(items),
    }


def summary(items: list[dict]) -> dict:
    by = {d: [i for i in items if i["decision"] == d] for d in DECISIONS}
    return {
        "reviewed": sum(len(v) for v in by.values()),
        "open": sum(1 for i in items if not i["decision"]),
        "ok": len(by["ok"]),
        "compare": len(by["compare"]),
        "cancel": len(by["cancel"]),
        "cancel_savings_year": round(sum(i["monthly_cost"] for i in by["cancel"]) * 12, 2),
    }


def decide(db: Session, contract: Contract, decision: str, today: date) -> None:
    run = _run(db, today)
    run["decisions"] = {**run["decisions"], str(contract.id): decision}
    contract.last_checked_on = today  # also answers the subscription check
    _save(db, run)


def complete(db: Session, today: date) -> None:
    run = _run(db, today)
    run["completed_on"] = today.isoformat()
    _save(db, run)


def due_date(db: Session, contracts: list[Contract], today: date) -> date | None:
    """When the next check is due: mid-January, starting the year after the first contract was recorded."""
    if not contracts:
        return None
    s = state(db)
    first_year = min(c.created_at.year if c.created_at else c.start_date.year for c in contracts)
    year = max(today.year, first_year + 1)
    if s.get("year") == today.year and s.get("completed_on"):
        year = today.year + 1
    return date(year, *DUE_DAY)
