import json
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import calc, ocr
from ..categories import CATEGORIES, CATEGORY_MAP, INTERVALS
from ..config import settings
from ..db import get_db
from ..models import AppSetting, Reminder
from ..schemas import OfferOut, ProfileIn
from ..services import contract_detail, contract_summary, load_contracts, today

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/meta")
def meta():
    return {
        "categories": CATEGORIES,
        "intervals": INTERVALS,
        "today": today(),
        "ocr": ocr.available(),
        "auth": bool(settings.password),
    }


@router.get("/profile")
def get_profile(db: Session = Depends(get_db)):
    row = db.get(AppSetting, "profile")
    return ProfileIn(**(row.value if row else {}))


@router.put("/profile")
def put_profile(data: ProfileIn, db: Session = Depends(get_db)):
    row = db.get(AppSetting, "profile")
    if row is None:
        row = AppSetting(key="profile", value={})
        db.add(row)
    row.value = data.model_dump()
    db.commit()
    return data


@router.get("/stats/summary")
def summary(
    deadline_days: int = Query(60, ge=1, le=365),
    db: Session = Depends(get_db),
):
    ref = today()
    contracts = load_contracts(db)
    summaries = [contract_summary(c, ref) for c in contracts]
    running = [s for s in summaries if s.state in ("active", "cancelled")]

    by_category: dict[str, dict] = {}
    for s in running:
        entry = by_category.setdefault(s.category, {"category": s.category, "monthly": 0.0, "count": 0})
        entry["monthly"] += s.monthly_cost
        entry["count"] += 1
    categories = sorted(by_category.values(), key=lambda e: e["monthly"], reverse=True)
    for e in categories:
        e["monthly"] = round(e["monthly"], 2)
        e["yearly"] = round(e["monthly"] * 12, 2)

    monthly_total = round(sum(s.monthly_cost for s in running), 2)
    year_ago = calc.add_months(ref, -12)
    monthly_year_ago = round(sum(calc.current_monthly_cost(c, year_ago) for c in contracts), 2)

    year_start = date(ref.year, 1, 1)
    ytd = 0.0
    for c in contracts:
        ytd += sum(calc.monthly_costs(c, year_start, ref, clip=True).values())

    horizon = ref + timedelta(days=deadline_days)
    deadlines = []
    for s in summaries:
        if s.cancellation_deadline and s.cancellation_deadline <= horizon and not s.monthly_cancellable:
            deadlines.append(
                {
                    "contract_id": s.id,
                    "name": s.name,
                    "category": s.category,
                    "type": "deadline",
                    "date": s.cancellation_deadline,
                    "term_end": s.next_term_end,
                    "days_left": (s.cancellation_deadline - ref).days,
                }
            )
        elif s.state == "cancelled" and s.end_date and s.end_date <= horizon:
            deadlines.append(
                {
                    "contract_id": s.id,
                    "name": s.name,
                    "category": s.category,
                    "type": "ends",
                    "date": s.end_date,
                    "term_end": s.end_date,
                    "days_left": (s.end_date - ref).days,
                }
            )
    deadlines.sort(key=lambda d: d["date"])

    price_changes = []
    for c in contracts:
        prices = calc.recurring_prices(c)
        for prev, cur in zip(prices, prices[1:], strict=False):
            if ref - timedelta(days=180) <= cur.valid_from <= ref + timedelta(days=90):
                old_m = calc.monthly_equivalent(prev.amount, prev.interval)
                new_m = calc.monthly_equivalent(cur.amount, cur.interval)
                price_changes.append(
                    {
                        "contract_id": c.id,
                        "name": c.name,
                        "category": c.category,
                        "date": cur.valid_from,
                        "old_monthly": round(old_m, 2),
                        "new_monthly": round(new_m, 2),
                        "diff": round(new_m - old_m, 2),
                    }
                )
    price_changes.sort(key=lambda p: p["date"], reverse=True)

    savings = [v for v in (calc.switch_savings(c, ref) for c in contracts) if v is not None]
    extras_12m = round(sum(calc.average_extras(c, ref) * 12 for c in contracts), 2)

    top = sorted(running, key=lambda s: s.monthly_cost, reverse=True)[:5]
    return {
        "today": ref,
        "active_count": len(running),
        "total_count": len(summaries),
        "monthly_total": monthly_total,
        "yearly_total": round(monthly_total * 12, 2),
        "monthly_year_ago": monthly_year_ago,
        "ytd_total": round(ytd, 2),
        "switch_savings": round(sum(savings), 2),
        "switch_count": len(savings),
        "extras_12m": extras_12m,
        "by_category": categories,
        "deadlines": deadlines,
        "price_changes": price_changes[:8],
        "top_contracts": top,
    }


def _series(
    contracts,
    first: date,
    last: date,
    group: str,
    increase_pct: float = 0.0,
    ref: date | None = None,
    include_extras: bool = False,
):
    months = [calc.month_key(m) for m in calc.iter_months(first, last)]
    grouped: dict[str, dict] = {}
    for c in contracts:
        extra = calc.average_extras(c, ref) if include_extras and ref else 0.0
        costs = calc.monthly_costs(c, first, last, increase_pct=increase_pct, today=ref, extra_monthly=extra)
        if not any(costs.values()):
            continue
        if group == "category":
            key = c.category
            label = CATEGORY_MAP.get(c.category, {}).get("label", c.category)
        else:
            key = str(c.id)
            label = c.name
        entry = grouped.setdefault(
            key, {"key": key, "label": label, "category": c.category, "values": defaultdict(float)}
        )
        for m, v in costs.items():
            entry["values"][m] += v
    series = []
    for entry in grouped.values():
        entry["values"] = [round(entry["values"][m], 2) for m in months]
        series.append(entry)
    series.sort(key=lambda e: sum(e["values"]), reverse=True)
    totals = [round(sum(s["values"][i] for s in series), 2) for i in range(len(months))]
    return months, series, totals


@router.get("/stats/timeseries")
def timeseries(
    start: str | None = Query(None, description="YYYY-MM"),
    end: str | None = Query(None, description="YYYY-MM"),
    group: str = Query("category", pattern="^(category|contract)$"),
    db: Session = Depends(get_db),
):
    ref = today()
    contracts = load_contracts(db)
    if start:
        first = calc.parse_month(start)
    elif contracts:
        first = max(min(c.start_date for c in contracts), calc.add_months(ref, -36))
    else:
        first = calc.add_months(ref, -11)
    last = calc.month_end(calc.parse_month(end)) if end else calc.month_end(ref)
    first = calc.month_start(min(first, last))
    months, series, totals = _series(contracts, first, last, group)
    return {"months": months, "series": series, "totals": totals, "current_month": calc.month_key(ref)}


@router.get("/stats/projection")
def projection(
    months: int = Query(24, ge=1, le=120),
    increase_pct: float = Query(0.0, ge=-50, le=100),
    group: str = Query("category", pattern="^(category|contract)$"),
    include_extras: bool = Query(False, description="Add the average additional charges of the last 12 months"),
    db: Session = Depends(get_db),
):
    """Forecast of future costs based on current prices, known end dates and an optional yearly increase."""
    ref = today()
    contracts = load_contracts(db)
    first = calc.add_months(calc.month_start(ref), 1)
    last = calc.month_end(calc.add_months(first, months - 1))
    labels, series, totals = _series(contracts, first, last, group, increase_pct, ref, include_extras)
    _, _, base_totals = _series(contracts, first, last, group, 0.0, ref, include_extras)
    yearly: dict[str, float] = defaultdict(float)
    for m, v in zip(labels, totals, strict=False):
        yearly[m[:4]] += v
    return {
        "months": labels,
        "series": series,
        "totals": totals,
        "sum": round(sum(totals), 2),
        "sum_without_increase": round(sum(base_totals), 2),
        "yearly": {k: round(v, 2) for k, v in sorted(yearly.items())},
        "increase_pct": increase_pct,
        "include_extras": include_extras,
        "extras_monthly": round(sum(calc.average_extras(c, ref) for c in contracts if c.end_date is None), 2),
    }


# --------------------------------------------------------------------------- calendar & export


def _ics_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


@router.get("/calendar.ics")
def calendar_feed(db: Session = Depends(get_db)):
    """iCalendar feed with cancellation deadlines and contract end dates."""
    ref = today()
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//contractly//DE",
        "CALSCALE:GREGORIAN",
        "X-WR-CALNAME:Contractly Fristen",
    ]

    def event(uid: str, day: date, summary: str, description: str, alarm_days: int | None = None):
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{uid}@contractly",
                f"DTSTAMP:{stamp}",
                f"DTSTART;VALUE=DATE:{day.strftime('%Y%m%d')}",
                f"DTEND;VALUE=DATE:{(day + timedelta(days=1)).strftime('%Y%m%d')}",
                f"SUMMARY:{_ics_escape(summary)}",
                f"DESCRIPTION:{_ics_escape(description)}",
            ]
        )
        if alarm_days:
            lines.extend(
                [
                    "BEGIN:VALARM",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:{_ics_escape(summary)}",
                    f"TRIGGER:-P{alarm_days}D",
                    "END:VALARM",
                ]
            )
        lines.append("END:VEVENT")

    for c in load_contracts(db):
        s = contract_summary(c, ref)
        if s.cancellation_deadline and not s.monthly_cancellable:
            event(
                f"deadline-{c.id}-{s.cancellation_deadline.isoformat()}",
                s.cancellation_deadline,
                f"Kündigungsfrist: {c.name}",
                f"Letzter Tag zur Kündigung. Laufzeitende: {s.next_term_end.strftime('%d.%m.%Y')}",
                alarm_days=14,
            )
        if c.end_date and c.end_date >= ref:
            event(f"end-{c.id}", c.end_date, f"Vertragsende: {c.name}", f"{c.provider or ''}".strip())
    for r in db.scalars(select(Reminder).where(Reminder.done_at.is_(None))):
        event(
            f"reminder-{r.id}-{r.due_date.isoformat()}",
            r.due_date,
            r.title,
            r.note or "",
            alarm_days=r.lead_days or None,
        )
    lines.append("END:VCALENDAR")
    return Response("\r\n".join(lines) + "\r\n", media_type="text/calendar; charset=utf-8")


@router.get("/export")
def export_all(db: Session = Depends(get_db)):
    ref = today()
    data = []
    for c in load_contracts(db):
        detail = contract_detail(c, ref).model_dump(mode="json")
        detail["offers"] = [OfferOut.model_validate(o).model_dump(mode="json") for o in c.offers]
        data.append(detail)
    headers = {"Content-Disposition": f'attachment; filename="contractly-export-{ref.isoformat()}.json"'}
    body = json.dumps({"exported_at": ref.isoformat(), "contracts": data}, indent=2, ensure_ascii=False)
    return Response(body, media_type="application/json", headers=headers)
