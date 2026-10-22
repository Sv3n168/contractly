"""Loans: amortisation from the monthly payment, interest rate and special repayments.

The payment is the contract's recurring price (so it counts as a monthly cost like any other
contract). The rate comes from the price entry's details (``interest_rate``, e.g. after the
fixed-rate period) or the contract's attributes. Everything else – balance today, interest
vs. repayment, debt-free date, balance when the fixed rate ends – is calculated here.
"""

from dataclasses import dataclass
from datetime import date, timedelta

MAX_MONTHS = 12 * 50
LOAN_CATEGORY = "loan"


def is_loan(category: str) -> bool:
    return category == LOAN_CATEGORY


def _num(value) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _date(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def _add_months(d: date, n: int) -> date:
    from .calc import add_months

    return add_months(d, n)


def fixed_until(contract) -> date | None:
    return _date((contract.attributes or {}).get("fixed_until")) if is_loan(contract.category) else None


@dataclass
class Row:
    day: date  # payment date
    payment: float
    interest: float
    principal: float
    extra: float  # special repayment in this month
    balance: float  # after this month


def _start(contract) -> tuple[date, float] | None:
    """Where the schedule starts: a balance confirmed by the bank, else the loan amount at the start."""
    attrs = contract.attributes or {}
    anchor_balance, anchor_date = _num(attrs.get("balance")), _date(attrs.get("balance_date"))
    if anchor_balance is not None and anchor_date:
        return anchor_date, anchor_balance
    principal = _num(attrs.get("principal"))
    if principal:
        return contract.start_date, principal
    return None


def _rate_and_payment(contract, day: date) -> tuple[float | None, float]:
    from .calc import monthly_equivalent, price_at, recurring_prices

    p = price_at(contract, day) or next(iter(recurring_prices(contract)), None)
    if p is None:
        return None, 0.0
    rate = _num((p.details or {}).get("interest_rate"))
    if rate is None:
        rate = _num((contract.attributes or {}).get("interest_rate"))
    return rate, monthly_equivalent(p.amount, p.interval)


def special_repayments(contract) -> list[tuple[date, float]]:
    out = []
    for item in (contract.attributes or {}).get("special_repayments") or []:
        d, amount = _date(item.get("date")), _num(item.get("amount"))
        if d and amount and amount > 0:
            out.append((d, amount))
    return sorted(out)


def schedule(
    contract,
    *,
    rate_override: float | None = None,
    payment_override: float | None = None,
    from_day: date | None = None,
    from_balance: float | None = None,
    include_planned_extras: bool = True,
) -> list[Row]:
    """Monthly rows until the loan is paid off (or MAX_MONTHS)."""
    start = (from_day, from_balance) if from_day and from_balance is not None else _start(contract)
    if start is None:
        return []
    day, balance = start
    extras = special_repayments(contract) if include_planned_extras else []
    rows: list[Row] = []
    n = 0
    while balance > 0.005 and n < MAX_MONTHS:
        n += 1
        day = _add_months(start[0], n)
        rate, payment = _rate_and_payment(contract, day)
        if rate_override is not None:
            rate = rate_override
        if payment_override is not None:
            payment = payment_override
        if rate is None or payment <= 0:
            return rows
        interest = round(balance * rate / 100 / 12, 2)
        if payment <= interest:
            return []  # the payment doesn't even cover the interest: never paid off
        principal = min(payment - interest, balance)
        if balance - principal < 1:  # rounding residue goes into the last payment
            principal = balance
        balance = round(balance - principal, 2)
        extra = 0.0
        prev = _add_months(start[0], n - 1)
        for d, amount in extras:
            if prev < d <= day and balance > 0:
                extra += min(amount, balance)
                balance = round(balance - min(amount, balance), 2)
        rows.append(Row(day, round(interest + principal, 2), interest, round(principal, 2), round(extra, 2), balance))
    return rows


def payoff_date(contract) -> date | None:
    rows = schedule(contract)
    return rows[-1].day if rows and rows[-1].balance <= 0.005 else None


def _balance_at(rows: list[Row], start_balance: float, day: date) -> float:
    balance = start_balance
    for r in rows:
        if r.day > day:
            break
        balance = r.balance
    return balance


def analysis(contract, today: date) -> dict | None:
    """Everything the loan card shows; None when amount/rate/payment are missing."""
    start = _start(contract)
    attrs = contract.attributes or {}
    rate, payment = _rate_and_payment(contract, today)
    out: dict = {"interest_rate": rate, "payment": round(payment, 2) if payment else None}
    if start is None or rate is None or not payment:
        out["missing"] = [
            label
            for label, ok in (
                ("Kreditbetrag", bool(start)),
                ("Sollzins", rate is not None),
                ("monatliche Rate", bool(payment)),
            )
            if not ok
        ]
        return out
    rows = schedule(contract)
    if not rows:
        out["payment_too_low"] = True
        out["monthly_interest"] = round(start[1] * rate / 100 / 12, 2)
        return out
    past = [r for r in rows if r.day <= today]
    future = [r for r in rows if r.day > today]
    balance = past[-1].balance if past else start[1]
    # A special repayment counts right away, not only with the next regular payment.
    since = past[-1].day if past else start[0]
    balance = max(0.0, balance - sum(a for d, a in special_repayments(contract) if since < d <= today))
    paid_off = rows[-1].balance <= 0.005
    principal = _num(attrs.get("principal")) or start[1]
    fixed = fixed_until(contract)
    current = future[0] if future else None
    out.update(
        {
            "start_balance": round(start[1], 2),
            "anchored": start[0] != contract.start_date,
            "principal": round(principal, 2),
            "balance": round(balance, 2),
            "repaid_share": round(1 - balance / principal, 4) if principal else None,
            "interest_paid": round(sum(r.interest for r in past), 2),
            "interest_remaining": round(sum(r.interest for r in future), 2),
            "special_repaid": round(sum(r.extra for r in past), 2),
            "payoff_date": rows[-1].day if paid_off else None,
            "months_left": len(future),
            "current_interest": current.interest if current else 0,
            "current_principal": current.principal if current else 0,
            "fixed_until": fixed,
            "balance_at_fixed_until": round(_balance_at(rows, start[1], fixed), 2) if fixed and fixed > today else None,
            # one point per year for the chart (plus today)
            "curve": _curve(rows, start, today),
        }
    )
    pct = _num(attrs.get("special_repayment_pct"))
    if pct:
        out["special_repayment_allowed"] = round(principal * pct / 100, 2)
    return out


def _curve(rows: list[Row], start: tuple[date, float], today: date) -> list[dict]:
    points = [{"date": start[0], "balance": round(start[1], 2)}]
    for r in rows:
        if r.day.month == start[0].month or r is rows[-1]:
            points.append({"date": r.day, "balance": r.balance})
    return points


def compare(
    contract,
    today: date,
    new_rate: float,
    fees: float = 0.0,
    from_day: date | None = None,
    new_payment: float | None = None,
) -> dict:
    """Refinancing / follow-up financing: the same balance with another rate.

    By default the payment stays the same, so a lower rate pays off earlier; the result is the
    interest saved minus the costs of switching (fees, early repayment compensation).
    """
    rows = schedule(contract)
    start = _start(contract)
    if not rows or start is None:
        raise ValueError("Für den Vergleich fehlen Kreditbetrag, Zins oder Rate")
    day = from_day or today
    balance = _balance_at(rows, start[1], day)
    if balance <= 0:
        raise ValueError("Zu diesem Zeitpunkt ist der Kredit schon abbezahlt")
    current = [r for r in rows if r.day > day]
    _rate, payment = _rate_and_payment(contract, day)
    alt = schedule(
        contract,
        rate_override=new_rate,
        payment_override=new_payment or payment,
        from_day=day,
        from_balance=balance,
    )
    if not alt:
        raise ValueError("Mit dieser Rate wird der Kredit nie abbezahlt – die Rate muss höher sein als die Zinsen")
    interest_now = sum(r.interest for r in current)
    interest_new = sum(r.interest for r in alt)
    saving = interest_now - interest_new - fees
    return {
        "from": day,
        "balance": round(balance, 2),
        "payment": round(new_payment or payment, 2),
        "interest_current": round(interest_now, 2),
        "interest_new": round(interest_new, 2),
        "fees": round(fees, 2),
        "saving": round(saving, 2),
        "payoff_current": current[-1].day if current else None,
        "payoff_new": alt[-1].day,
        "months_saved": len(current) - len(alt),
        "worth_it": saving > 0,
    }


def early_repayment_fee(contract, day: date, balance: float) -> float | None:
    """Statutory cap for consumer loans (§ 502 BGB): 1 %, 0.5 % if less than a year remains.

    Mortgages are calculated individually by the bank – no estimate here.
    """
    if (contract.attributes or {}).get("loan_type") == "Baufinanzierung":
        return None
    payoff = payoff_date(contract)
    if payoff is None:
        return None
    pct = 0.5 if payoff - day <= timedelta(days=365) else 1.0
    return round(balance * pct / 100, 2)
