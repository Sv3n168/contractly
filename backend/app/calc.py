"""Cost, deadline and comparison calculations.

All functions are pure (operate on model objects or plain values) so they can
be tested without a database.
"""

import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from .categories import INTERVALS, is_energy
from .models import Contract, Offer, PriceEntry

# --------------------------------------------------------------------------- dates


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    year = d.year + m // 12
    month = m % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def month_start(d: date) -> date:
    return d.replace(day=1)


def month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def iter_months(first: date, last: date):
    cur = month_start(first)
    while cur <= last:
        yield cur
        cur = add_months(cur, 1)


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def parse_month(value: str) -> date:
    year, month = value.split("-")[:2]
    return date(int(year), int(month), 1)


# --------------------------------------------------------------------------- prices


def monthly_equivalent(amount: float, interval: str) -> float:
    months = INTERVALS.get(interval, {}).get("months")
    if not months:
        return 0.0
    return amount / months


def energy_monthly_cost(base_price_month, unit_price_ct, consumption_kwh) -> float | None:
    if base_price_month is None and unit_price_ct is None:
        return None
    if unit_price_ct is not None and not consumption_kwh:
        return None
    base = float(base_price_month or 0)
    work = float(unit_price_ct or 0) * float(consumption_kwh or 0) / 100 / 12
    return base + work


def recurring_prices(contract: Contract) -> list[PriceEntry]:
    return sorted((p for p in contract.prices if p.interval != "once"), key=lambda p: p.valid_from)


def price_at(contract: Contract, day: date) -> PriceEntry | None:
    current = None
    for p in recurring_prices(contract):
        if p.valid_from <= day:
            current = p
        else:
            break
    return current


def is_active_on(contract: Contract, day: date) -> bool:
    return contract.start_date <= day and (contract.end_date is None or contract.end_date >= day)


def current_monthly_cost(contract: Contract, today: date) -> float:
    """Monthly equivalent of the recurring price effective today (0 if inactive)."""
    if not is_active_on(contract, today):
        return 0.0
    p = price_at(contract, today)
    if p is None:
        # Contract not started billing yet but active: use the first known price.
        prices = recurring_prices(contract)
        p = prices[0] if prices else None
    return monthly_equivalent(p.amount, p.interval) if p else 0.0


def _segments(contract: Contract, until: date):
    """Yield (from, to_inclusive, monthly_amount) for the contract's recurring prices."""
    prices = recurring_prices(contract)
    if not prices:
        return
    end = contract.end_date or until
    end = min(end, until)
    for i, p in enumerate(prices):
        seg_from = max(p.valid_from, contract.start_date)
        seg_to = prices[i + 1].valid_from - timedelta(days=1) if i + 1 < len(prices) else end
        seg_to = min(seg_to, end)
        if i == 0 and p.valid_from > contract.start_date:
            # The first price also covers the time before its valid_from date.
            seg_from = contract.start_date
        if seg_from <= seg_to:
            yield seg_from, seg_to, monthly_equivalent(p.amount, p.interval)


def monthly_costs(
    contract: Contract,
    first: date,
    last: date,
    increase_pct: float = 0.0,
    today: date | None = None,
    clip: bool = False,
) -> dict[str, float]:
    """Cost per month (prorated by days) between the months of ``first`` and ``last``.

    ``increase_pct`` applies a compounding yearly increase to months after ``today``
    (used for projections). With ``clip`` the costs stop exactly at ``last`` instead of
    covering its whole month.
    """
    result = {month_key(m): 0.0 for m in iter_months(first, last)}
    horizon_end = last if clip else month_end(last)
    for seg_from, seg_to, monthly in _segments(contract, horizon_end):
        for m in iter_months(max(seg_from, month_start(first)), seg_to):
            m_first, m_last = m, month_end(m)
            overlap = (min(seg_to, m_last) - max(seg_from, m_first)).days + 1
            if overlap <= 0:
                continue
            factor = overlap / m_last.day
            amount = monthly * factor
            if increase_pct and today and m_first > today:
                years = (m_first - today).days / 365.25
                amount *= (1 + increase_pct / 100) ** years
            key = month_key(m)
            if key in result:
                result[key] += amount
    for p in contract.prices:
        if p.interval == "once" and p.valid_from <= horizon_end:
            key = month_key(p.valid_from)
            if key in result:
                result[key] += p.amount
    return {k: round(v, 2) for k, v in result.items()}


# --------------------------------------------------------------------------- terms


def notice_delta(value: int | None, unit: str | None, end: date) -> date:
    """Last day the cancellation must arrive for a term ending on ``end``."""
    value = value or 0
    if unit == "days":
        return end - timedelta(days=value)
    if unit == "weeks":
        return end - timedelta(weeks=value)
    # months: "3 Monate zum Laufzeitende" -> same day three months earlier
    return add_months(end + timedelta(days=1), -value) - timedelta(days=1)


@dataclass
class TermInfo:
    next_term_end: date | None
    cancellation_deadline: date | None
    # Past the minimum term and renewing monthly: cancellable any month, no "real" deadline.
    flexible: bool = False


def term_info(contract: Contract, today: date) -> TermInfo:
    if contract.end_date:
        return TermInfo(contract.end_date, None)
    info = _next_term(contract, today)
    min_end = add_months(contract.start_date, contract.min_term_months or 0) - timedelta(days=1)
    info.flexible = (contract.renewal_months or 1) <= 1 and (
        not contract.min_term_months or (info.next_term_end is not None and info.next_term_end > min_end)
    )
    return info


def _next_term(contract: Contract, today: date) -> TermInfo:
    min_term = contract.min_term_months or 0
    renewal = contract.renewal_months or 1
    k = 0
    while True:
        months = min_term + k * renewal if min_term else max(renewal, 1) * (k + 1)
        term_end = add_months(contract.start_date, months) - timedelta(days=1)
        deadline = notice_delta(contract.notice_value, contract.notice_unit, term_end)
        if deadline >= today:
            return TermInfo(term_end, deadline)
        k += 1
        if k > 5000:  # safety net for absurd data
            return TermInfo(None, None)


def contract_state(contract: Contract, today: date) -> str:
    if contract.start_date > today:
        return "planned"
    if contract.end_date and contract.end_date < today:
        return "ended"
    if contract.end_date:
        return "cancelled"
    return "active"


# --------------------------------------------------------------------------- chains


def contract_chain(contract: Contract) -> list[Contract]:
    """All contracts linked by predecessor/successor relations, in chronological order."""
    root = contract
    seen = {root.id}
    while root.predecessor is not None and root.predecessor.id not in seen:
        root = root.predecessor
        seen.add(root.id)
    chain: list[Contract] = []
    stack = [root]
    visited: set[int] = set()
    while stack:
        c = stack.pop()
        if c.id in visited:
            continue
        visited.add(c.id)
        chain.append(c)
        stack.extend(c.successors)
    return sorted(chain, key=lambda c: (c.start_date, c.id))


# --------------------------------------------------------------------------- offers


def contract_reference_monthly(contract: Contract, today: date) -> float:
    """What the current contract costs per month, used as comparison baseline.

    For energy contracts the tariff (base + unit price × consumption) is preferred
    over the instalment, which is only a prepayment.
    """
    if is_energy(contract.category):
        a = contract.attributes or {}
        energy = energy_monthly_cost(a.get("base_price_month"), a.get("unit_price_ct"), a.get("consumption_kwh"))
        if energy is not None:
            return energy
    cost = current_monthly_cost(contract, today)
    if cost == 0.0:
        p = price_at(contract, today) or (recurring_prices(contract) or [None])[-1]
        if p:
            cost = monthly_equivalent(p.amount, p.interval)
    return cost


def offer_monthly(offer: Offer, contract: Contract) -> float:
    if offer.monthly_price is not None:
        return offer.monthly_price
    consumption = (offer.attributes or {}).get("consumption_kwh") or (contract.attributes or {}).get("consumption_kwh")
    energy = energy_monthly_cost(offer.base_price_month, offer.unit_price_ct, consumption)
    return energy or 0.0


def evaluate_offer(
    offer: Offer,
    contract: Contract,
    today: date,
    horizon_months: int,
    min_saving_year: float,
) -> dict:
    current = contract_reference_monthly(contract, today)
    monthly = offer_monthly(offer, contract)
    one_time = offer.one_time_costs or 0
    bonus = offer.bonus or 0

    current_total = current * horizon_months
    offer_total = monthly * horizon_months + one_time - bonus
    savings = current_total - offer_total
    savings_year = savings / horizon_months * 12 if horizon_months else 0

    first_year_offer = monthly * 12 + one_time - bonus
    first_year_current = current * 12

    # Month from which the offer is cumulatively cheaper (and stays cheaper).
    break_even = None
    cumulative = bonus - one_time
    for month in range(1, max(horizon_months, 1) * 3 + 1):
        cumulative += current - monthly
        if cumulative > 0 and current >= monthly:
            break_even = month
            break

    if savings_year >= min_saving_year:
        verdict = "worth_it"
    elif savings_year > 0:
        verdict = "marginal"
    else:
        verdict = "not_worth_it"

    return {
        "offer_id": offer.id,
        "monthly": round(monthly, 2),
        "monthly_diff": round(current - monthly, 2),
        "current_monthly": round(current, 2),
        "horizon_months": horizon_months,
        "current_total": round(current_total, 2),
        "offer_total": round(offer_total, 2),
        "savings_total": round(savings, 2),
        "savings_year": round(savings_year, 2),
        "first_year_current": round(first_year_current, 2),
        "first_year_offer": round(first_year_offer, 2),
        "effective_monthly": round(offer_total / horizon_months, 2) if horizon_months else monthly,
        "break_even_month": break_even,
        "verdict": verdict,
    }


# --------------------------------------------------------------------------- switches & energy

AVG_MONTH_DAYS = 365.25 / 12


def switch_savings(contract: Contract, today: date) -> float | None:
    """Money saved (or lost, negative) by this contract compared to keeping its predecessor's price."""
    pred = contract.predecessor
    if pred is None or contract.start_date > today:
        return None
    old_price = price_at(pred, pred.end_date or contract.start_date)
    if old_price is None:
        return None
    old_monthly = monthly_equivalent(old_price.amount, old_price.interval)
    until = min(contract.end_date or today, today)
    if until < contract.start_date:
        return None
    paid = sum(monthly_costs(contract, contract.start_date, until, clip=True).values())
    months = ((until - contract.start_date).days + 1) / AVG_MONTH_DAYS
    return round(old_monthly * months - paid, 2)


def energy_analysis(contract: Contract, today: date) -> dict | None:
    """Extrapolate yearly consumption from meter readings and estimate the annual settlement."""
    readings = sorted(contract.meter_readings, key=lambda r: r.reading_date)
    attrs = contract.attributes or {}
    result: dict = {"readings": len(readings)}
    if len(readings) >= 2:
        first, last = readings[0], readings[-1]
        days = (last.reading_date - first.reading_date).days
        consumed = last.value - first.value
        if days > 0 and consumed >= 0:
            result["consumption_per_year"] = round(consumed / days * 365, 0)
            result["period_days"] = days
            result["period_consumption"] = round(consumed, 1)
    consumption = result.get("consumption_per_year") or attrs.get("consumption_kwh")
    if consumption:
        result["consumption_used"] = consumption
        result["consumption_source"] = "readings" if "consumption_per_year" in result else "contract"
    current = price_at(contract, today)
    base = attrs.get("base_price_month")
    unit = attrs.get("unit_price_ct")
    if current is not None and current.details:
        base = current.details.get("base_price_month", base)
        unit = current.details.get("unit_price_ct", unit)
    if consumption and (base is not None or unit is not None):
        expected = float(base or 0) * 12 + float(unit or 0) * float(consumption) / 100
        result["expected_yearly_cost"] = round(expected, 2)
        result["suggested_installment"] = round(expected / 12, 2)
        installment = attrs.get("installment")
        if installment is None and current is not None:
            installment = monthly_equivalent(current.amount, current.interval)
        if installment:
            result["installment"] = round(float(installment), 2)
            result["yearly_installments"] = round(float(installment) * 12, 2)
            # positive: expected credit (Guthaben), negative: expected additional payment
            result["settlement_estimate"] = round(float(installment) * 12 - expected, 2)
    return result
