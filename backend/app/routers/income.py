"""Income ("Einnahmen"): salary history, bonuses and other income."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import income
from ..db import get_db
from ..models import IncomeEntry, IncomeSource
from ..schemas import clean_icon
from ..services import load_contracts, on_account, today

router = APIRouter(prefix="/api/income", tags=["income"])

INTERVALS = ("monthly", "quarterly", "half_yearly", "yearly", "once")


class EntryIn(BaseModel):
    valid_from: date
    net: float = Field(ge=0, le=10_000_000)
    gross: float | None = Field(None, ge=0, le=10_000_000)
    interval: str = "monthly"
    note: str | None = Field(None, max_length=300)

    @field_validator("interval")
    @classmethod
    def _interval(cls, v: str) -> str:
        if v not in INTERVALS:
            raise ValueError("Unbekannte Zahlweise")
        return v


class SourceIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: str = "salary"
    icon: str | None = None
    payer: str | None = Field(None, max_length=200)
    start_date: date
    end_date: date | None = None
    note: str | None = Field(None, max_length=2000)

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        if v not in income.KINDS:
            raise ValueError("Unbekannte Art")
        return v

    @field_validator("icon")
    @classmethod
    def _icon(cls, v: str | None) -> str | None:
        return clean_icon(v)


class NewSourceIn(SourceIn):
    first: EntryIn


def _sources(db: Session) -> list[IncomeSource]:
    return list(db.scalars(select(IncomeSource).options(selectinload(IncomeSource.entries))).unique())


def _source(db: Session, source_id: int) -> IncomeSource:
    s = db.get(IncomeSource, source_id)
    if s is None:
        raise HTTPException(404, "Einnahme nicht gefunden")
    return s


@router.get("")
def get_income(db: Session = Depends(get_db)):
    ref = today()
    sources = _sources(db)
    # the chart covers the whole recorded history (at least two years, at most twenty)
    first = min((s.start_date for s in sources), default=ref)
    months = (ref.year - first.year) * 12 + ref.month - first.month + 1
    return {
        **income.overview(sources, on_account(load_contracts(db)), ref, months_back=min(max(months, 24), 240)),
        "sources": [income.source_out(s, ref) for s in sorted(sources, key=lambda s: (s.end_date is not None, s.name))],
    }


@router.post("/sources", status_code=201)
def create_source(data: NewSourceIn, db: Session = Depends(get_db)):
    s = IncomeSource(**data.model_dump(exclude={"first"}))
    s.entries.append(IncomeEntry(**data.first.model_dump()))
    db.add(s)
    db.commit()
    return income.source_out(s, today())


@router.put("/sources/{source_id}")
def update_source(source_id: int, data: SourceIn, db: Session = Depends(get_db)):
    s = _source(db, source_id)
    for k, v in data.model_dump().items():
        setattr(s, k, v)
    db.commit()
    return income.source_out(s, today())


@router.delete("/sources/{source_id}", status_code=204)
def delete_source(source_id: int, db: Session = Depends(get_db)):
    db.delete(_source(db, source_id))
    db.commit()
    return Response(status_code=204)


@router.post("/sources/{source_id}/entries", status_code=201)
def add_entry(source_id: int, data: EntryIn, db: Session = Depends(get_db)):
    """A raise (new regular amount from a date) or a one-off payment such as a bonus (interval "once")."""
    s = _source(db, source_id)
    s.entries.append(IncomeEntry(**data.model_dump()))
    db.commit()
    return income.source_out(s, today())


def _entry(db: Session, source_id: int, entry_id: int) -> IncomeEntry:
    e = db.get(IncomeEntry, entry_id)
    if e is None or e.source_id != source_id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    return e


@router.put("/sources/{source_id}/entries/{entry_id}")
def update_entry(source_id: int, entry_id: int, data: EntryIn, db: Session = Depends(get_db)):
    e = _entry(db, source_id, entry_id)
    for k, v in data.model_dump().items():
        setattr(e, k, v)
    db.commit()
    return income.source_out(_source(db, source_id), today())


@router.delete("/sources/{source_id}/entries/{entry_id}", status_code=204)
def delete_entry(source_id: int, entry_id: int, db: Session = Depends(get_db)):
    s = _source(db, source_id)
    if len([e for e in s.entries if e.interval != "once"]) <= 1 and _entry(db, source_id, entry_id).interval != "once":
        raise HTTPException(
            400, "Der letzte reguläre Betrag kann nicht gelöscht werden – lösche stattdessen die Einnahme"
        )
    db.delete(_entry(db, source_id, entry_id))
    db.commit()
    return Response(status_code=204)
