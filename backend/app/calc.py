"""Cost, deadline and comparison calculations.

All functions are pure (operate on model objects or plain values) so they can
be tested without a database.
"""

import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from . import loans
from .categories import INTERVALS, is_energy
from .forecast import forecast
from .loans import is_loan
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


EXTRA = "extra"


def is_extra(p: PriceEntry) -> bool:
    """One-off additional charge for a single month (e.g. roaming, calls abroad)."""
    return p.interval == "once" and (p.details or {}).get("kind") == EXTRA


def extras_by_month(contract: Contract, first: date, last: date) -> dict[str, float]:
    result: dict[str, float] = {}
    for p in contract.prices:
        if is_extra(p) and first <= p.valid_from <= last:
            key = month_key(p.valid_from)
            result[key] = round(result.get(key, 0.0) + p.amount, 2)
    return result


def average_extras(contract: Contract, today: date, months: int = 12) -> float:
    """Average additional charges per month over the last ``months`` months."""
    first = month_start(add_months(today, -(months - 1)))
    return sum(extras_by_month(contract, first, today).values()) / months


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


def share(contract: Contract) -> float:
    """Own share of the costs (e.g. 0.5 when a partner pays half); 1 when the partner pays a fixed amount."""
    if partner_amount(contract):
        return 1.0
    pct = contract.share_percent
    return 1.0 if pct is None else max(0, min(pct, 100)) / 100


def partner_amount(contract: Contract) -> float:
    """Fixed monthly amount a partner pays towards the contract (0 if none)."""
    return max(0.0, getattr(contract, "partner_amount", None) or 0.0)


def own_monthly(contract: Contract, monthly: float) -> float:
    """Own part of a monthly price: by percentage, or the price minus the partner's fixed amount."""
    if partner_amount(contract):
        return max(0.0, monthly - partner_amount(contract))
    return monthly * share(contract)


def current_monthly_cost(contract: Contract, today: date) -> float:
    """Own monthly equivalent of the recurring price effective today (0 if inactive)."""
    if not is_active_on(contract, today):
        return 0.0
    p = price_at(contract, today)
    if p is None:
        # Contract not started billing yet but active: use the first known price.
        prices = recurring_prices(contract)
        p = prices[0] if prices else None
    return own_monthly(contract, monthly_equivalent(p.amount, p.interval)) if p else 0.0


def _segments(contract: Contract, until: date):
    """Yield (from, to_inclusive, monthly_amount) for the contract's recurring prices."""
    prices = recurring_prices(contract)
    if not prices:
        return
    end = contract.end_date or until
    if contract.end_date is None and is_loan(contract.category):
        end = loans.payoff_date(contract) or end  # no more payments once the loan is repaid
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
    extra_monthly: float = 0.0,
) -> dict[str, float]:
    """Own cost per month (prorated by days, times the own share) between ``first`` and ``last``.

    ``increase_pct`` applies a compounding yearly increase to months after ``today``
    (used for projections), ``extra_monthly`` adds expected additional charges to those
    months. With ``clip`` the costs stop exactly at ``last`` instead of covering its whole month.
    """
    result = {month_key(m): 0.0 for m in iter_months(first, last)}
    partner = partner_amount(contract)
    horizon_end = last if clip else month_end(last)
    for seg_from, seg_to, monthly in _segments(contract, horizon_end):
        for m in iter_months(max(seg_from, month_start(first)), seg_to):
            m_first, m_last = m, month_end(m)
            overlap = (min(seg_to, m_last) - max(seg_from, m_first)).days + 1
            if overlap <= 0:
                continue
            factor = overlap / m_last.day
            amount = monthly * factor
            if today and m_first > today and increase_pct:
                years = (m_first - today).days / 365.25
                amount *= (1 + increase_pct / 100) ** years
            if partner:
                # the partner's fixed amount covers part of the regular price, never more than all of it
                amount = max(0.0, amount - partner * factor)
            if today and m_first > today:
                amount += extra_monthly * factor
            key = month_key(m)
            if key in result:
                result[key] += amount
    for p in contract.prices:
        if p.interval == "once" and p.valid_from <= horizon_end:
            key = month_key(p.valid_from)
            if key in result:
                result[key] += p.amount
    factor = share(contract)
    return {k: round(v * factor, 2) for k, v in result.items()}


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
    # The full price (not only the own share): offers are entered with their full price, too.
    p = price_at(contract, today)
    if p is None:
        prices = recurring_prices(contract)
        p = (prices[0] if is_active_on(contract, today) else prices[-1]) if prices else None
    return monthly_equivalent(p.amount, p.interval) if p else 0.0


def offer_monthly(offer: Offer, contract: Contract) -> float:
    if offer.monthly_price is not None:
        return offer.monthly_price
    consumption = (offer.attributes or {}).get("consumption_kwh") or (contract.attributes or {}).get("consumption_kwh")
    energy = energy_monthly_cost(offer.base_price_month, offer.unit_price_ct, consumption)
    return energy or 0.0


BONUS_LABELS = {
    "instant": "Sofortbonus",
    "new_customer": "Neukundenbonus",
    "switch": "Wechselbonus",
    "number_porting": "Bonus Rufnummernmitnahme",
    "cashback": "Cashback / Prämie",
}


def offer_bonuses(offer: Offer) -> list[dict]:
    """Bonuses of an offer; the legacy single ``bonus`` counts as an instant bonus."""
    items = [b for b in (offer.bonuses or []) if b.get("amount")]
    if not items and offer.bonus:
        items = [{"type": "instant", "amount": offer.bonus, "paid_after_months": 0}]
    return items


def offer_price_in_month(offer: Offer, contract: Contract, index: int) -> float:
    """Price of the offer in its ``index``-th month (0-based), honouring an introductory price."""
    if offer.promo_price is not None and offer.promo_months and index < offer.promo_months:
        return offer.promo_price
    return offer_monthly(offer, contract)


def _verdict(savings_year: float, min_saving_year: float) -> str:
    if savings_year >= min_saving_year:
        return "worth_it"
    if savings_year > 0:
        return "marginal"
    return "not_worth_it"


def evaluate_offer(
    offer: Offer,
    contract: Contract,
    today: date,
    horizon_months: int,
    min_saving_year: float,
    include_bonus: bool = True,
) -> dict:
    current = contract_reference_monthly(contract, today)
    monthly = offer_monthly(offer, contract)
    one_time = offer.one_time_costs or 0
    bonuses = offer_bonuses(offer)
    horizon = max(horizon_months, 1)

    # Bonuses are credited in the month they are paid out; later ones are outside the horizon.
    bonus_by_month: dict[int, float] = {}
    for b in bonuses:
        idx = int(b.get("paid_after_months") or 0)
        bonus_by_month[idx] = bonus_by_month.get(idx, 0.0) + float(b["amount"])
    bonus_in_horizon = sum(v for k, v in bonus_by_month.items() if k < horizon)
    bonus_outside = sum(v for k, v in bonus_by_month.items() if k >= horizon)
    counted_bonus = bonus_in_horizon if include_bonus else 0.0

    prices = [offer_price_in_month(offer, contract, i) for i in range(horizon)]
    current_total = current * horizon
    base_total = sum(prices) + one_time
    offer_total = base_total - counted_bonus
    savings = current_total - offer_total
    savings_year = savings / horizon * 12
    savings_without_bonus = current_total - base_total
    savings_year_without_bonus = savings_without_bonus / horizon * 12

    first_year_offer = sum(offer_price_in_month(offer, contract, i) for i in range(12)) + one_time
    if include_bonus:
        first_year_offer -= sum(v for k, v in bonus_by_month.items() if k < 12)

    # Month-by-month cumulative advantage (positive = offer cheaper so far).
    break_even = None
    advantage_ends = None
    cumulative = -one_time
    was_ahead = False
    for i in range(max(horizon * 3, 36)):
        cumulative += current - offer_price_in_month(offer, contract, i)
        if include_bonus:
            cumulative += bonus_by_month.get(i, 0.0)
        ahead = cumulative > 0
        if ahead and break_even is None and current >= monthly:
            break_even = i + 1
        if was_ahead and not ahead:
            # Bonus/promo is used up - the offer is now more expensive overall. A later
            # bonus may put it ahead again, so the last such month counts.
            advantage_ends = i + 1
        elif ahead:
            advantage_ends = None
        was_ahead = ahead

    verdict = _verdict(savings_year, min_saving_year)
    verdict_without_bonus = _verdict(savings_year_without_bonus, min_saving_year)

    return {
        "offer_id": offer.id,
        "monthly": round(monthly, 2),
        "monthly_diff": round(current - monthly, 2),
        "current_monthly": round(current, 2),
        "promo_price": offer.promo_price,
        "promo_months": offer.promo_months,
        "horizon_months": horizon_months,
        "current_total": round(current_total, 2),
        "offer_total": round(offer_total, 2),
        "savings_total": round(savings, 2),
        "savings_year": round(savings_year, 2),
        "savings_total_without_bonus": round(savings_without_bonus, 2),
        "bonus_total": round(sum(bonus_by_month.values()), 2),
        "bonus_in_horizon": round(bonus_in_horizon, 2),
        "bonus_outside_horizon": round(bonus_outside, 2),
        "bonus_counted": include_bonus,
        "bonus_dependent": include_bonus and verdict == "worth_it" and verdict_without_bonus != "worth_it",
        "first_year_current": round(current * 12, 2),
        "first_year_offer": round(first_year_offer, 2),
        "effective_monthly": round(offer_total / horizon, 2),
        "break_even_month": break_even,
        "advantage_ends_month": advantage_ends,
        "verdict": verdict,
        "verdict_without_bonus": verdict_without_bonus,
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
    old_monthly = own_monthly(pred, monthly_equivalent(old_price.amount, old_price.interval))
    until = min(contract.end_date or today, today)
    if until < contract.start_date:
        return None
    paid = sum(monthly_costs(contract, contract.start_date, until, clip=True).values())
    months = ((until - contract.start_date).days + 1) / AVG_MONTH_DAYS
    return round(old_monthly * months - paid, 2)


def billing_year(contract: Contract, today: date) -> tuple[date, date]:
    """Current settlement period: yearly from the contract start (most suppliers bill this way)."""
    start = contract.start_date
    years = max(0, today.year - start.year - (1 if (today.month, today.day) < (start.month, start.day) else 0))
    begin = add_months(start, 12 * years)
    return begin, add_months(begin, 12) - timedelta(days=1)


def energy_analysis(contract: Contract, today: date) -> dict | None:
    """Consumption forecast from meter readings and the expected annual settlement."""
    attrs = contract.attributes or {}
    readings = [(r.reading_date, r.value) for r in contract.meter_readings]
    result: dict = {"readings": len(readings)}
    fc = forecast(readings, contract.category, attrs) if len(readings) >= 2 else None
    if fc:
        result["forecast"] = fc
        result["consumption_per_year"] = fc["annual_kwh"]
    consumption = result.get("consumption_per_year") or attrs.get("consumption_kwh")
    if consumption:
        result["consumption_used"] = consumption
        result["consumption_source"] = "readings" if fc else "contract"
    current = price_at(contract, today)
    base = attrs.get("base_price_month")
    unit = attrs.get("unit_price_ct")
    if current is not None and current.details:
        base = current.details.get("base_price_month", base)
        unit = current.details.get("unit_price_ct", unit)
    if not consumption or (base is None and unit is None):
        return result

    def cost(kwh: float) -> float:
        return float(base or 0) * 12 + float(unit or 0) * float(kwh) / 100

    expected = cost(consumption)
    result["expected_yearly_cost"] = round(expected, 2)
    result["suggested_installment"] = round(expected / 12, 2)
    if fc:
        result["cost_low"] = round(cost(fc["low_kwh"]), 2)
        result["cost_high"] = round(cost(fc["high_kwh"]), 2)
    installment = attrs.get("installment")
    if installment is None and current is not None:
        installment = monthly_equivalent(current.amount, current.interval)
    if not installment:
        return result
    installment = float(installment)
    result["installment"] = round(installment, 2)
    result["yearly_installments"] = round(installment * 12, 2)
    # positive: expected credit (Guthaben), negative: expected additional payment
    result["settlement_estimate"] = round(installment * 12 - expected, 2)
    if fc:  # best case within the forecast range
        result["settlement_best_case"] = round(installment * 12 - result["cost_low"], 2)
    begin, end = billing_year(contract, today)
    result["billing_year_end"] = end
    elapsed = (today.year - begin.year) * 12 + today.month - begin.month
    remaining = 12 - elapsed
    if result["settlement_estimate"] < 0 and remaining > 0:
        # Installment from now on that avoids the additional payment at the end of the period.
        result["needed_installment"] = round((expected - installment * elapsed) / remaining, 2)
    return result
