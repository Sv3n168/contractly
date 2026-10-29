"""Helpers that turn ORM objects into API payloads."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from . import calc, loans, smart
from .categories import is_energy, tax_relevant
from .models import Contract, PriceEntry
from .schemas import (
    ContractOut,
    ContractSummary,
    DocumentOut,
    MeterReadingOut,
    PriceOut,
    ReminderOut,
)


def today() -> date:
    return date.today()


def load_contracts(db: Session) -> list[Contract]:
    stmt = select(Contract).options(
        selectinload(Contract.prices),
        selectinload(Contract.documents),
        selectinload(Contract.offers),
        selectinload(Contract.successors),
        selectinload(Contract.predecessor),
        selectinload(Contract.meter_readings),
    )
    return list(db.scalars(stmt).unique())


OWN_ACCOUNT = "own"
ALL_ACCOUNTS = "all"


def on_account(contracts: list[Contract], account: str | None = OWN_ACCOUNT) -> list[Contract]:
    """Contracts paid from ``account``: "own" (no other account set), "all", or an account name."""
    if account == ALL_ACCOUNTS:
        return contracts
    if not account or account == OWN_ACCOUNT:
        return [c for c in contracts if not c.account]
    return [c for c in contracts if (c.account or "").lower() == account.lower()]


def price_out(p: PriceEntry) -> PriceOut:
    out = PriceOut.model_validate(p)
    out.monthly_equivalent = round(calc.monthly_equivalent(p.amount, p.interval), 2)
    return out


def document_out(d) -> DocumentOut:
    out = DocumentOut.model_validate(d)
    out.has_text = bool(d.extracted_text)
    return out


def _full_monthly(c: Contract, ref: date) -> float:
    """Monthly price of the whole contract, regardless of the own share."""
    if not calc.is_active_on(c, ref):
        return 0.0
    p = calc.price_at(c, ref) or (calc.recurring_prices(c) or [None])[0]
    return calc.monthly_equivalent(p.amount, p.interval) if p else 0.0


def _summary_fields(c: Contract, ref: date) -> dict:
    monthly = calc.current_monthly_cost(c, ref)
    terms = calc.term_info(c, ref)
    current = calc.price_at(c, ref)
    if current is None:
        recurring = calc.recurring_prices(c)
        current = recurring[0] if recurring else None
    return {
        "id": c.id,
        "name": c.name,
        "category": c.category,
        "icon": c.icon,
        "provider": c.provider,
        "start_date": c.start_date,
        "end_date": c.end_date,
        "cancelled_on": c.cancelled_on,
        "predecessor_id": c.predecessor_id,
        "successor_ids": sorted(s.id for s in c.successors),
        "state": calc.contract_state(c, ref),
        "current_price": price_out(current) if current else None,
        "monthly_cost": round(monthly, 2),
        "yearly_cost": round(monthly * 12, 2),
        "next_term_end": terms.next_term_end,
        "cancellation_deadline": terms.cancellation_deadline,
        "monthly_cancellable": terms.flexible,
        "share_percent": c.share_percent,
        "partner_amount": c.partner_amount,
        "account": c.account,
        "max_total": c.max_total,
        # paid once (no recurring price): what it cost – shown instead of 0,00 € a month
        "one_off_total": round(
            sum(p.amount for p in c.prices if p.interval == "once" and p.amount > 0 and not calc.is_extra(p)), 2
        ),
        "full_monthly_cost": round(_full_monthly(c, ref), 2),
        "tax_relevant": tax_relevant(c.category, c.tax_relevant),
        "cancellation_confirmed_on": c.cancellation_confirmed_on,
        "document_count": len(c.documents),
        "offer_count": len(c.offers),
        "attributes": c.attributes or {},
    }


def contract_summary(c: Contract, ref: date | None = None) -> ContractSummary:
    return ContractSummary(**_summary_fields(c, ref or today()))


def total_paid(c: Contract, ref: date, full: bool = False) -> float:
    """Paid so far – the own part, or with ``full`` the whole contract (incl. a partner's part).

    Counts the payments actually due by today (a monthly price from 01.09. paid on the 1st of each
    month), not the costs spread over the days – that is what left the account."""
    regular = sum(amount for _, amount in calc.payment_dates(c, ref, full=full))
    once = sum(p.amount for p in c.prices if p.interval == "once" and p.valid_from <= ref)
    return round(regular + once * (1.0 if full else calc.share(c)), 2)


def _extras_fields(c: Contract, ref: date) -> dict:
    first = calc.month_start(calc.add_months(ref, -11))
    extras = calc.extras_by_month(c, first, ref)
    return {"extras_12m": round(sum(extras.values()), 2), "extras_months_12m": sum(1 for v in extras.values() if v)}


def contract_detail(c: Contract, ref: date | None = None) -> ContractOut:
    ref = ref or today()
    return ContractOut(
        **_summary_fields(c, ref),
        withdrawal_until=c.withdrawal_until,
        last_checked_on=c.last_checked_on,
        provider_address=c.provider_address,
        customer_number=c.customer_number,
        contract_number=c.contract_number,
        min_term_months=c.min_term_months,
        renewal_months=c.renewal_months,
        notice_value=c.notice_value,
        notice_unit=c.notice_unit,
        notes=c.notes,
        reminder_days=c.reminder_days,
        created_at=c.created_at,
        updated_at=c.updated_at,
        prices=[price_out(p) for p in c.prices],
        documents=[document_out(d) for d in c.documents],
        meter_readings=[MeterReadingOut.model_validate(m) for m in c.meter_readings],
        reminders=[ReminderOut.model_validate(r) for r in c.reminders if r.done_at is None],
        total_paid=total_paid(c, ref),
        full_total_paid=total_paid(c, ref, full=True),
        payments=calc.payments_made(c, ref),
        budget=calc.total_budget(c, ref),
        **_extras_fields(c, ref),
        switch_savings=calc.switch_savings(c, ref),
        energy=calc.energy_analysis(c, ref) if is_energy(c.category) else None,
        loan=loans.analysis(c, ref) if loans.is_loan(c.category) else None,
        gaps=smart.gaps(c, ref),
    )
