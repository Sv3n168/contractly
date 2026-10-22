"""Income: salary history (net always, gross optional), bonuses and other income.

Amounts behave like contract prices – an entry is valid from its date until the next one
(a raise), "once" entries are one-off payments (bonus, holiday pay) – so the proven monthly
cost calculation is reused for the monthly income.
"""

from datetime import date
from types import SimpleNamespace

from . import calc
from .models import IncomeSource

KINDS = {
    "salary": {"label": "Gehalt", "icon": "💼"},
    "pension": {"label": "Rente / Pension", "icon": "🏖️"},
    "side_job": {"label": "Nebenjob", "icon": "🧰"},
    "self_employed": {"label": "Selbstständig", "icon": "🧾"},
    "rental": {"label": "Mieteinnahmen", "icon": "🏠"},
    "child_benefit": {"label": "Kindergeld", "icon": "👶"},
    "capital": {"label": "Kapitalerträge", "icon": "📈"},
    "other": {"label": "Sonstiges", "icon": "💶"},
}


def _as_contract(source: IncomeSource, field: str, recurring_only: bool = False):
    """The source as a "contract" whose prices are the net (or gross) amounts."""
    prices = [
        SimpleNamespace(valid_from=e.valid_from, amount=getattr(e, field), interval=e.interval, details={}, note=e.note)
        for e in source.entries
        if getattr(e, field) is not None and not (recurring_only and e.interval == "once")
    ]
    return SimpleNamespace(
        start_date=source.start_date,
        end_date=source.end_date,
        prices=prices,
        share_percent=None,
        category="income",
        attributes={},
    )


def monthly(source: IncomeSource, first: date, last: date, field: str = "net", recurring_only: bool = False):
    return calc.monthly_costs(_as_contract(source, field, recurring_only), first, last)


def current(source: IncomeSource, today: date, field: str = "net") -> float | None:
    c = _as_contract(source, field, recurring_only=True)
    if not c.prices:
        return None
    return round(calc.current_monthly_cost(c, today), 2)


def raises(source: IncomeSource) -> list[dict]:
    """Changes of the regular income (net, and gross when known on both sides)."""
    entries = [e for e in source.entries if e.interval != "once"]
    out = []
    for prev, cur in zip(entries, entries[1:], strict=False):
        old = calc.monthly_equivalent(prev.net, prev.interval)
        new = calc.monthly_equivalent(cur.net, cur.interval)
        if abs(new - old) < 0.005:
            continue
        item = {
            "date": cur.valid_from,
            "source_id": source.id,
            "source": source.name,
            "old_net": round(old, 2),
            "new_net": round(new, 2),
            "pct_net": round((new / old - 1) * 100, 1) if old else None,
        }
        if prev.gross is not None and cur.gross is not None:
            og, ng = (
                calc.monthly_equivalent(prev.gross, prev.interval),
                calc.monthly_equivalent(cur.gross, cur.interval),
            )
            item.update(
                {
                    "old_gross": round(og, 2),
                    "new_gross": round(ng, 2),
                    "pct_gross": round((ng / og - 1) * 100, 1) if og else None,
                }
            )
        out.append(item)
    return out


def source_out(source: IncomeSource, today: date) -> dict:
    return {
        "id": source.id,
        "name": source.name,
        "kind": source.kind,
        "kind_label": KINDS.get(source.kind, KINDS["other"])["label"],
        "icon": KINDS.get(source.kind, KINDS["other"])["icon"],
        "payer": source.payer,
        "start_date": source.start_date,
        "end_date": source.end_date,
        "note": source.note,
        "active": source.end_date is None or source.end_date >= today,
        "current_net": current(source, today),
        "current_gross": current(source, today, "gross"),
        "entries": [
            {
                "id": e.id,
                "valid_from": e.valid_from,
                "net": e.net,
                "gross": e.gross,
                "interval": e.interval,
                "note": e.note,
            }
            for e in sorted(source.entries, key=lambda e: e.valid_from, reverse=True)
        ],
        "raises": raises(source),
    }


def overview(sources: list[IncomeSource], contracts: list, today: date, months_back: int = 24) -> dict:
    first = calc.month_start(calc.add_months(today, -(months_back - 1)))
    last = calc.month_end(today)
    keys = [calc.month_key(m) for m in calc.iter_months(first, last)]
    regular = dict.fromkeys(keys, 0.0)
    one_off = dict.fromkeys(keys, 0.0)
    for s in sources:
        rec = monthly(s, first, last, recurring_only=True)
        total = monthly(s, first, last)
        for k in keys:
            regular[k] += rec.get(k, 0.0)
            one_off[k] += total.get(k, 0.0) - rec.get(k, 0.0)
    costs = dict.fromkeys(keys, 0.0)
    for c in contracts:
        for k, v in calc.monthly_costs(c, first, last).items():
            if k in costs:
                costs[k] += v

    monthly_net = round(sum(current(s, today) or 0 for s in sources), 2)
    grosses = [g for s in sources if (g := current(s, today, "gross"))]
    monthly_gross = round(sum(grosses), 2) if grosses else None
    last12 = keys[-12:]
    net_12m = round(sum(regular[k] + one_off[k] for k in last12), 2)
    bonus_12m = round(sum(one_off[k] for k in last12), 2)
    fixed = round(sum(calc.current_monthly_cost(c, today) for c in contracts), 2)
    # bonuses spread over the year count, too: what is really available per month
    avg_net = net_12m / 12 if net_12m else monthly_net

    # Per calendar year; the current one up to this month (no projection)
    years: dict[int, dict] = {}
    first_start = min((s.start_date for s in sources), default=today)
    for s in sources:
        if not s.entries:
            continue
        y_first = date(min(e.valid_from for e in s.entries).year, 1, 1)
        for field in ("net", "gross"):
            for k, v in monthly(s, y_first, last, field).items():
                y = int(k[:4])
                # complete: a past year the recorded income covers from January on
                full = y < today.year and first_start <= date(y, 1, 1)
                row = years.setdefault(y, {"year": y, "net": 0.0, "gross": 0.0, "complete": full})
                row[field] += v
    year_rows = [
        {**row, "net": round(row["net"], 2), "gross": round(row["gross"], 2) or None}
        for _, row in sorted(years.items())
    ]

    return {
        "monthly_net": monthly_net,
        "monthly_gross": monthly_gross,
        "net_12m": net_12m,
        "bonus_12m": bonus_12m,
        "fixed_costs_monthly": fixed,
        "fixed_cost_ratio": round(fixed / avg_net, 4) if avg_net else None,
        "free_monthly": round(avg_net - fixed, 2) if avg_net else None,
        "months": keys,
        "regular": [round(regular[k], 2) for k in keys],
        "one_off": [round(one_off[k], 2) for k in keys],
        "costs": [round(costs[k], 2) for k in keys],
        "years": year_rows,
        "raises": sorted((r for s in sources for r in raises(s)), key=lambda r: r["date"], reverse=True),
        "kinds": [{"key": k, **v} for k, v in KINDS.items()],
    }
