"""Helpers that turn ORM objects into API payloads."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from . import calc
from .categories import is_energy
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


def price_out(p: PriceEntry) -> PriceOut:
    out = PriceOut.model_validate(p)
    out.monthly_equivalent = round(calc.monthly_equivalent(p.amount, p.interval), 2)
    return out


def document_out(d) -> DocumentOut:
    out = DocumentOut.model_validate(d)
    out.has_text = bool(d.extracted_text)
    return out


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
        "document_count": len(c.documents),
        "offer_count": len(c.offers),
        "attributes": c.attributes or {},
    }


def contract_summary(c: Contract, ref: date | None = None) -> ContractSummary:
    return ContractSummary(**_summary_fields(c, ref or today()))


def total_paid(c: Contract, ref: date) -> float:
    last = min(c.end_date or ref, ref)
    if last < c.start_date:
        return 0.0
    return round(sum(calc.monthly_costs(c, c.start_date, last, clip=True).values()), 2)


def _extras_fields(c: Contract, ref: date) -> dict:
    first = calc.month_start(calc.add_months(ref, -11))
    extras = calc.extras_by_month(c, first, ref)
    return {"extras_12m": round(sum(extras.values()), 2), "extras_months_12m": sum(1 for v in extras.values() if v)}


def contract_detail(c: Contract, ref: date | None = None) -> ContractOut:
    ref = ref or today()
    return ContractOut(
        **_summary_fields(c, ref),
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
        **_extras_fields(c, ref),
        switch_savings=calc.switch_savings(c, ref),
        energy=calc.energy_analysis(c, ref) if is_energy(c.category) else None,
    )
