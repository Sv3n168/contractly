"""Loans: refinancing comparison and special repayments."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import loans
from ..db import get_db
from ..schemas import ContractOut
from ..services import contract_detail, today
from .contracts import get_contract

router = APIRouter(prefix="/api/contracts/{contract_id}/loan", tags=["loans"])


def _loan(db: Session, contract_id: int):
    c = get_contract(db, contract_id)
    if not loans.is_loan(c.category):
        raise HTTPException(400, "Kein Kredit")
    return c


class CompareIn(BaseModel):
    new_rate: float = Field(ge=0, le=30)
    fees: float | None = Field(None, ge=0, le=1_000_000)
    from_date: date | None = None
    new_payment: float | None = Field(None, gt=0, le=1_000_000)


@router.post("/compare")
def compare(contract_id: int, data: CompareIn, db: Session = Depends(get_db)):
    """Refinancing now, or follow-up financing when the fixed rate ends."""
    c = _loan(db, contract_id)
    ref = today()
    day = data.from_date or ref
    fee_hint = None
    fees = data.fees
    if fees is None:
        balance = loans.analysis(c, day) or {}
        fee_hint = loans.early_repayment_fee(c, day, balance.get("balance") or 0)
        fixed_until = (c.attributes or {}).get("fixed_until")
        if fixed_until and str(day) >= str(fixed_until)[:10]:
            fee_hint = 0.0  # no compensation once the fixed-rate period is over
        fees = fee_hint or 0.0
    try:
        result = loans.compare(c, ref, data.new_rate, fees, day, data.new_payment)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    result["fee_estimated"] = fee_hint is not None and data.fees is None
    return result


class RepaymentIn(BaseModel):
    on: date
    amount: float = Field(gt=0, le=10_000_000)


@router.post("/repayments", response_model=ContractOut)
def add_repayment(contract_id: int, data: RepaymentIn, db: Session = Depends(get_db)):
    c = _loan(db, contract_id)
    attrs = dict(c.attributes or {})
    items = list(attrs.get("special_repayments") or [])
    items.append({"date": data.on.isoformat(), "amount": round(data.amount, 2)})
    attrs["special_repayments"] = sorted(items, key=lambda x: x["date"])
    c.attributes = attrs
    db.commit()
    return contract_detail(c)


@router.delete("/repayments/{index}", response_model=ContractOut)
def delete_repayment(contract_id: int, index: int, db: Session = Depends(get_db)):
    c = _loan(db, contract_id)
    attrs = dict(c.attributes or {})
    items = list(attrs.get("special_repayments") or [])
    if not 0 <= index < len(items):
        raise HTTPException(404, "Sondertilgung nicht gefunden")
    items.pop(index)
    attrs["special_repayments"] = items
    c.attributes = attrs
    db.commit()
    return contract_detail(c)
