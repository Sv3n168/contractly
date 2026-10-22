import json
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import calc, income, ocr
from ..categories import CATEGORIES, CATEGORY_MAP, INTERVALS, TAX_RELEVANT_DEFAULT, tax_relevant
from ..config import settings
from ..db import get_db
from ..models import AppSetting, IncomeSource
from ..reminders import load_outbox, refresh_outbox
from ..schemas import OfferOut, ProfileIn
from ..security import vault
from ..services import contract_detail, contract_summary, load_contracts, today
from .auth import current_user_id

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/meta")
def meta():
    return {
        "categories": [{**c, "tax_default": c["key"] in TAX_RELEVANT_DEFAULT} for c in CATEGORIES],
        "intervals": INTERVALS,
        "today": today(),
        "ocr": ocr.available(),
        "smtp": bool(settings.smtp_host),
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
    sources = list(db.scalars(select(IncomeSource).options(selectinload(IncomeSource.entries))).unique())
    money_in = income.overview(sources, contracts, ref, months_back=12) if sources else None
    return {
        "income_monthly_net": money_in["monthly_net"] if money_in else None,
        "fixed_cost_ratio": money_in["fixed_cost_ratio"] if money_in else None,
        "free_monthly": money_in["free_monthly"] if money_in else None,
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


def _calendar(user_id: str) -> Response:
    """iCalendar feed built from the user's reminder outbox, so it also works while logged out."""
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//contractly//DE",
        "CALSCALE:GREGORIAN",
        "X-WR-CALNAME:Contractly Fristen",
    ]
    for item in load_outbox(user_id).get("items", []):
        day = date.fromisoformat(item["date"])
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{item['key'].replace(':', '-')}@contractly",
                f"DTSTAMP:{stamp}",
                f"DTSTART;VALUE=DATE:{day:%Y%m%d}",
                f"DTEND;VALUE=DATE:{day + timedelta(days=1):%Y%m%d}",
                f"SUMMARY:{_ics_escape(item['title'])}",
                f"DESCRIPTION:{_ics_escape(item.get('detail') or '')}",
            ]
        )
        alarm = item.get("alarm_days") or max((day - date.fromisoformat(item["notify_date"])).days, 0)
        if alarm:
            lines.extend(
                [
                    "BEGIN:VALARM",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:{_ics_escape(item['title'])}",
                    f"TRIGGER:-P{alarm}D",
                    "END:VALARM",
                ]
            )
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return Response("\r\n".join(lines) + "\r\n", media_type="text/calendar; charset=utf-8")


@router.get("/calendar/{token}.ics")
def calendar_feed_token(token: str):
    """Calendar subscription for calendar apps (which can't log in): protected by a secret token."""
    user_id = vault.user_for_calendar_token(token)
    if not user_id:
        raise HTTPException(404, "Unbekannter Kalender-Link")
    return _calendar(user_id)


@router.get("/calendar.ics")
def calendar_feed(user_id: str = Depends(current_user_id)):
    refresh_outbox(user_id)
    return _calendar(user_id)


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


@router.get("/ha/summary")
def home_assistant_summary(request: Request):
    """Read-only key figures for Home Assistant (Bearer API token). Works while logged out."""
    header = request.headers.get("authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else request.query_params.get("token", "")
    user_id = vault.user_for_api_token(token)
    if not user_id:
        raise HTTPException(401, "Ungültiger API-Token")
    summary = load_outbox(user_id).get("summary")
    if not summary:
        raise HTTPException(404, "Noch keine Daten – einmal in Contractly anmelden")
    return summary


# --------------------------------------------------------------------------- yearly report & tax export


def _year_report(db: Session, year: int) -> dict:
    first, last = date(year, 1, 1), date(year, 12, 31)
    ref = today()
    rows = []
    months = [calc.month_key(m) for m in calc.iter_months(first, last)]
    monthly = dict.fromkeys(months, 0.0)
    switches, price_changes = [], []
    extras_total = 0.0
    for c in load_contracts(db):
        costs = calc.monthly_costs(c, first, min(last, ref) if year == ref.year else last, clip=True)
        total = round(sum(costs.values()), 2)
        for m, v in costs.items():
            monthly[m] += v
        extras = sum(calc.extras_by_month(c, first, last).values()) * calc.share(c)
        extras_total += extras
        if total:
            rows.append(
                {
                    "id": c.id,
                    "name": c.name,
                    "provider": c.provider,
                    "category": c.category,
                    "total": total,
                    "extras": round(extras, 2),
                    "share_percent": c.share_percent,
                    "tax_relevant": tax_relevant(c.category, c.tax_relevant),
                    "contract_number": c.contract_number,
                }
            )
        if c.predecessor and first <= c.start_date <= last:
            switches.append(
                {
                    "date": c.start_date,
                    "from": c.predecessor.name,
                    "to": c.name,
                    "category": c.category,
                    "savings": calc.switch_savings(c, ref),
                }
            )
        prices = calc.recurring_prices(c)
        for prev, cur in zip(prices, prices[1:], strict=False):
            if first <= cur.valid_from <= last:
                old_m = calc.monthly_equivalent(prev.amount, prev.interval)
                new_m = calc.monthly_equivalent(cur.amount, cur.interval)
                if abs(new_m - old_m) > 0.005:
                    price_changes.append(
                        {"date": cur.valid_from, "name": c.name, "old": round(old_m, 2), "new": round(new_m, 2)}
                    )
    rows.sort(key=lambda r: -r["total"])
    by_cat: dict[str, float] = defaultdict(float)
    for r in rows:
        by_cat[r["category"]] += r["total"]
    total = round(sum(r["total"] for r in rows), 2)
    return {
        "year": year,
        "complete": year < ref.year,
        "total": total,
        "monthly_average": round(total / (ref.month if year == ref.year else 12), 2),
        "months": months,
        "monthly": [round(monthly[m], 2) for m in months],
        "by_category": sorted(
            ({"category": k, "total": round(v, 2)} for k, v in by_cat.items()), key=lambda e: -e["total"]
        ),
        "contracts": rows,
        "tax_total": round(sum(r["total"] for r in rows if r["tax_relevant"]), 2),
        "extras_total": round(extras_total, 2),
        "switches": sorted(switches, key=lambda s: s["date"]),
        "price_changes": sorted(price_changes, key=lambda p: p["date"]),
    }


@router.get("/stats/report")
def yearly_report(
    year: int = Query(default_factory=lambda: today().year, ge=2000, le=2100), db: Session = Depends(get_db)
):
    return _year_report(db, year)


@router.get("/stats/tax.csv")
def tax_export(
    year: int = Query(default_factory=lambda: today().year, ge=2000, le=2100),
    all_contracts: bool = False,
    db: Session = Depends(get_db),
):
    """Yearly sums for the tax return (Excel-friendly CSV, German number format)."""
    report = _year_report(db, year)
    lines = [
        "Vertrag;Anbieter;Kategorie;Vertragsnummer;Eigener Anteil;Betrag " + str(year) + " (EUR);Steuerlich relevant"
    ]
    total = 0.0
    for r in report["contracts"]:
        if not (all_contracts or r["tax_relevant"]):
            continue
        total += r["total"]
        cells = [
            r["name"],
            r["provider"] or "",
            CATEGORY_MAP.get(r["category"], {}).get("label", r["category"]),
            r["contract_number"] or "",
            f"{r['share_percent'] or 100} %",
            f"{r['total']:.2f}".replace(".", ","),
            "ja" if r["tax_relevant"] else "nein",
        ]
        lines.append(";".join('"' + str(c).replace('"', '""') + '"' for c in cells))
    lines.append(f'"Summe";;;;;{total:.2f};'.replace(".", ","))
    body = "﻿" + "\r\n".join(lines) + "\r\n"
    name = f"contractly-steuer-{year}.csv" if not all_contracts else f"contractly-kosten-{year}.csv"
    return Response(
        body, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )
