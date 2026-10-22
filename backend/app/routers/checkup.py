"""The yearly check ("Jahres-Check")."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import checkup
from ..db import get_db
from ..services import load_contracts, today
from .contracts import get_contract

router = APIRouter(prefix="/api/checkup", tags=["checkup"])


class DecisionIn(BaseModel):
    decision: str = Field(pattern="^(ok|compare|cancel)$")


@router.get("")
def overview(db: Session = Depends(get_db)):
    return checkup.overview(db, load_contracts(db), today())


@router.post("/complete")
def complete(db: Session = Depends(get_db)):
    checkup.complete(db, today())
    return checkup.overview(db, load_contracts(db), today())


@router.post("/{contract_id}")
def decide(contract_id: int, data: DecisionIn, db: Session = Depends(get_db)):
    checkup.decide(db, get_contract(db, contract_id), data.decision, today())
    return checkup.overview(db, load_contracts(db), today())
