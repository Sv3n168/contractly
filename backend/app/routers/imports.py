"""Import of contract lists (analyse first, then apply)."""

import asyncio
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import importer
from ..categories import CATEGORY_KEYS, INTERVALS
from ..db import get_db
from ..models import Contract, PriceEntry

router = APIRouter(prefix="/api/import", tags=["import"])

MAX_BYTES = 10 * 1024 * 1024


async def _read(file: UploadFile) -> bytes:
    blob = await file.read(MAX_BYTES + 1)
    if len(blob) > MAX_BYTES:
        raise HTTPException(413, "Datei zu groß (max. 10 MB)")
    return blob


@router.post("/contracts")
async def analyse_contract_list(file: UploadFile = File(...)):
    try:
        rows = await asyncio.to_thread(importer.read_contract_list, await _read(file), file.filename or "")
    except importer.ImportError_ as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"rows": rows}


@router.get("/template.csv")
def template():
    return Response(
        "﻿" + importer.TEMPLATE,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="contractly-vorlage.csv"'},
    )


class NewContract(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    provider: str | None = None
    category: str = "other"
    amount: float = Field(ge=0)
    interval: str = "monthly"
    start_date: date
    customer_number: str | None = None
    contract_number: str | None = None
    min_term_months: int | None = None
    notice_value: int | None = None
    notice_unit: str = "months"
    notes: str | None = None


class ApplyIn(BaseModel):
    create: list[NewContract] = Field(default_factory=list)


@router.post("/apply")
def apply_import(data: ApplyIn, db: Session = Depends(get_db)):
    created = 0
    for n in data.create:
        category = n.category if n.category in CATEGORY_KEYS else "other"
        interval = n.interval if n.interval in INTERVALS and n.interval != "once" else "monthly"
        c = Contract(
            name=n.name,
            category=category,
            provider=n.provider,
            start_date=n.start_date,
            customer_number=n.customer_number,
            contract_number=n.contract_number,
            min_term_months=n.min_term_months,
            renewal_months=1,
            notice_value=n.notice_value if n.notice_value is not None else 1,
            notice_unit=n.notice_unit if n.notice_unit in ("days", "weeks", "months") else "months",
            notes=n.notes,
            attributes={},
        )
        c.prices.append(PriceEntry(valid_from=n.start_date, amount=n.amount, interval=interval, details={}))
        db.add(c)
        created += 1
    db.commit()
    return {"created": created}
