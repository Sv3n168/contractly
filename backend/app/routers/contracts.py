from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import calc
from ..db import documents_dir, get_db
from ..models import Contract, Document, MeterReading, PriceEntry
from ..reminders import NO_CONFIRMATION
from ..schemas import (
    CancelIn,
    ConfirmIn,
    ContractCreate,
    ContractOut,
    ContractSummary,
    ContractUpdate,
    MeterReadingIn,
    MeterReadingOut,
    PauseIn,
    PriceIn,
    PriceOut,
)
from ..services import contract_detail, contract_summary, load_contracts, price_out, today
from ..smart import IGNORED_GAPS

router = APIRouter(prefix="/api/contracts", tags=["contracts"])


class CheckedIn(BaseModel):
    last_checked_on: date | None = None


def get_contract(db: Session, contract_id: int) -> Contract:
    c = db.get(Contract, contract_id)
    if c is None:
        raise HTTPException(404, "Vertrag nicht gefunden")
    return c


def _check_predecessor(db: Session, contract: Contract | None, predecessor_id: int | None) -> Contract | None:
    if predecessor_id is None:
        return None
    pred = get_contract(db, predecessor_id)
    if contract is not None and _is_descendant(pred, contract):
        raise HTTPException(400, "Ungültiger Vorgängervertrag (Zyklus)")
    return pred


def _is_descendant(candidate: Contract, ancestor: Contract) -> bool:
    node = candidate
    seen = set()
    while node is not None and node.id not in seen:
        if node.id == ancestor.id:
            return True
        seen.add(node.id)
        node = node.predecessor
    return False


@router.get("", response_model=list[ContractSummary])
def list_contracts(
    include_ended: bool = Query(True),
    category: str | None = None,
    db: Session = Depends(get_db),
):
    ref = today()
    items = [contract_summary(c, ref) for c in load_contracts(db)]
    if not include_ended:
        items = [i for i in items if i.state != "ended"]
    if category:
        items = [i for i in items if i.category == category]
    return sorted(items, key=lambda i: (i.category, i.name.lower()))


@router.post("", response_model=ContractOut, status_code=201)
def create_contract(data: ContractCreate, db: Session = Depends(get_db)):
    pred = _check_predecessor(db, None, data.predecessor_id)
    payload = data.model_dump(exclude={"end_predecessor", "initial_price", "document_ids"})
    c = Contract(**payload)
    db.add(c)
    if pred is not None and data.end_predecessor:
        new_end = data.start_date - timedelta(days=1)
        if pred.end_date is None or pred.end_date > new_end:
            pred.end_date = max(new_end, pred.start_date)
    if data.initial_price is not None:
        c.prices.append(PriceEntry(**data.initial_price.model_dump()))
    for doc_id in data.document_ids:
        doc = db.get(Document, doc_id)
        if doc is not None and doc.contract_id is None:
            c.documents.append(doc)
    db.commit()
    db.refresh(c)
    return contract_detail(c)


@router.get("/{contract_id}", response_model=ContractOut)
def read_contract(contract_id: int, db: Session = Depends(get_db)):
    return contract_detail(get_contract(db, contract_id))


@router.put("/{contract_id}", response_model=ContractOut)
def update_contract(contract_id: int, data: ContractUpdate, db: Session = Depends(get_db)):
    c = get_contract(db, contract_id)
    _check_predecessor(db, c, data.predecessor_id)
    for key, value in data.model_dump().items():
        setattr(c, key, value)
    db.commit()
    db.refresh(c)
    return contract_detail(c)


@router.delete("/{contract_id}", status_code=204)
def delete_contract(contract_id: int, db: Session = Depends(get_db)):
    c = get_contract(db, contract_id)
    files = [documents_dir() / d.stored_name for d in c.documents]
    # Keep the chain connected: successors inherit this contract's predecessor.
    for s in list(c.successors):
        s.predecessor_id = c.predecessor_id
    db.delete(c)
    db.commit()
    for f in files:
        f.unlink(missing_ok=True)
    return Response(status_code=204)


@router.post("/{contract_id}/cancel", response_model=ContractOut)
def cancel_contract(contract_id: int, data: CancelIn, db: Session = Depends(get_db)):
    c = get_contract(db, contract_id)
    ref = data.cancelled_on or today()
    end = data.end_date
    if end is None:
        terms = calc.term_info(c, ref)
        if terms.next_term_end is None:
            raise HTTPException(400, "Vertragsende konnte nicht berechnet werden")
        end = terms.next_term_end
    c.cancelled_on = ref
    c.end_date = end
    db.commit()
    db.refresh(c)
    return contract_detail(c)


@router.post("/{contract_id}/reactivate", response_model=ContractOut)
def reactivate_contract(contract_id: int, db: Session = Depends(get_db)):
    c = get_contract(db, contract_id)
    c.cancelled_on = None
    c.end_date = None
    db.commit()
    db.refresh(c)
    return contract_detail(c)


@router.get("/{contract_id}/history")
def contract_history(
    contract_id: int,
    months_ahead: int = Query(12, ge=0, le=120),
    db: Session = Depends(get_db),
):
    """Monthly costs of the whole contract chain (predecessors and successors).

    Switching providers does not restart the series: every contract of the chain
    contributes its own dataset on a shared month axis.
    """
    c = get_contract(db, contract_id)
    chain = calc.contract_chain(c)
    ref = today()
    first = min(x.start_date for x in chain)
    if any(x.end_date is None for x in chain):
        last = calc.add_months(ref, months_ahead)
    else:
        last = max(x.end_date for x in chain)
    last = max(last, first)
    months = [calc.month_key(m) for m in calc.iter_months(first, last)]
    series = []
    for x in chain:
        costs = calc.monthly_costs(x, first, last)
        series.append(
            {
                "contract_id": x.id,
                "name": x.name,
                "provider": x.provider,
                "category": x.category,
                "start_date": x.start_date,
                "end_date": x.end_date,
                "values": [costs[m] if costs[m] else None for m in months],
            }
        )
    totals = [round(sum((s["values"][i] or 0) for s in series), 2) for i in range(len(months))]
    extras: dict[str, float] = {}
    for x in chain:
        for m, v in calc.extras_by_month(x, first, calc.month_end(last)).items():
            extras[m] = round(extras.get(m, 0.0) + v, 2)
    # one-off credits (switching bonus): shown as a marker instead of a dip of the price line
    credits: dict[str, float] = {}
    for x in chain:
        for p in x.prices:
            if p.interval == "once" and p.amount < 0 and first <= p.valid_from <= calc.month_end(last):
                m = calc.month_key(p.valid_from)
                credits[m] = round(credits.get(m, 0.0) - p.amount * calc.share(x), 2)
    events = []
    for x in chain:
        for p in x.prices:
            events.append(
                {
                    "date": p.valid_from,
                    "contract_id": x.id,
                    "type": "extra" if calc.is_extra(p) else "once" if p.interval == "once" else "price",
                    "amount": p.amount,
                    "interval": p.interval,
                    "monthly_equivalent": round(calc.monthly_equivalent(p.amount, p.interval), 2),
                    "note": p.note,
                }
            )
    events.sort(key=lambda e: e["date"])
    return {
        "months": months,
        "current_month": calc.month_key(ref),
        "series": series,
        "totals": totals,
        "extras": [extras.get(m, 0.0) for m in months],
        "credits": [credits.get(m, 0.0) for m in months],
        "events": events,
        "chain": [contract_summary(x, ref) for x in chain],
    }


# --------------------------------------------------------------------------- prices


@router.post("/{contract_id}/prices", response_model=PriceOut, status_code=201)
def add_price(contract_id: int, data: PriceIn, db: Session = Depends(get_db)):
    c = get_contract(db, contract_id)
    p = PriceEntry(**data.model_dump())
    c.prices.append(p)
    db.commit()
    db.refresh(p)
    return price_out(p)


@router.put("/{contract_id}/prices/{price_id}", response_model=PriceOut)
def update_price(contract_id: int, price_id: int, data: PriceIn, db: Session = Depends(get_db)):
    p = db.get(PriceEntry, price_id)
    if p is None or p.contract_id != contract_id:
        raise HTTPException(404, "Preis nicht gefunden")
    for key, value in data.model_dump().items():
        setattr(p, key, value)
    db.commit()
    db.refresh(p)
    return price_out(p)


@router.delete("/{contract_id}/prices/{price_id}", status_code=204)
def delete_price(contract_id: int, price_id: int, db: Session = Depends(get_db)):
    p = db.get(PriceEntry, price_id)
    if p is None or p.contract_id != contract_id:
        raise HTTPException(404, "Preis nicht gefunden")
    db.delete(p)
    db.commit()
    return Response(status_code=204)


# --------------------------------------------------------------------------- meter readings


@router.post("/{contract_id}/readings", response_model=MeterReadingOut, status_code=201)
def add_reading(contract_id: int, data: MeterReadingIn, db: Session = Depends(get_db)):
    c = get_contract(db, contract_id)
    r = MeterReading(**data.model_dump())
    c.meter_readings.append(r)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/{contract_id}/readings/{reading_id}", status_code=204)
def delete_reading(contract_id: int, reading_id: int, db: Session = Depends(get_db)):
    r = db.get(MeterReading, reading_id)
    if r is None or r.contract_id != contract_id:
        raise HTTPException(404, "Zählerstand nicht gefunden")
    db.delete(r)
    db.commit()
    return Response(status_code=204)


# --------------------------------------------------------------------------- everyday actions


@router.post("/{contract_id}/pause", response_model=ContractOut)
def pause_contract(contract_id: int, data: PauseIn, db: Session = Depends(get_db)):
    """Pause (e.g. gym during illness): costs 0 for the period, then the previous price again."""
    c = get_contract(db, contract_id)
    if data.until and data.until < data.from_date:
        raise HTTPException(400, "Das Ende der Pause liegt vor dem Beginn")
    before = calc.price_at(c, data.from_date - timedelta(days=1)) or calc.price_at(c, data.from_date)
    c.prices.append(
        PriceEntry(
            valid_from=data.from_date,
            amount=0,
            interval="monthly",
            note=data.note or "Pausiert",
            details={"kind": "pause"},
        )
    )
    if data.until and before is not None:
        c.prices.append(
            PriceEntry(
                valid_from=data.until + timedelta(days=1),
                amount=before.amount,
                interval=before.interval,
                note="Pause beendet",
                details=dict(before.details or {}),
            )
        )
        if data.extend_term and c.min_term_months:
            # Many contracts (e.g. gyms) extend the minimum term by the pause.
            months = max(1, round((data.until - data.from_date).days / 30.44))
            c.min_term_months += months
    db.commit()
    db.refresh(c)
    return contract_detail(c)


@router.post("/{contract_id}/cancellation-confirmed", response_model=ContractOut)
def confirm_cancellation(contract_id: int, data: ConfirmIn, db: Session = Depends(get_db)):
    c = get_contract(db, contract_id)
    if not c.cancelled_on:
        raise HTTPException(400, "Der Vertrag ist nicht gekündigt")
    c.cancellation_confirmed_on = data.confirmed_on or today()
    db.commit()
    db.refresh(c)
    return contract_detail(c)


@router.post("/{contract_id}/no-confirmation", response_model=ContractOut)
def no_confirmation(contract_id: int, db: Session = Depends(get_db)):
    """Not every provider confirms a cancellation: stop asking for it."""
    c = get_contract(db, contract_id)
    c.attributes = {**(c.attributes or {}), NO_CONFIRMATION: True}
    db.commit()
    db.refresh(c)
    return contract_detail(c)


@router.delete("/{contract_id}/cancellation-confirmed", response_model=ContractOut)
def unconfirm_cancellation(contract_id: int, db: Session = Depends(get_db)):
    """Undo "confirmation received"."""
    c = get_contract(db, contract_id)
    c.cancellation_confirmed_on = None
    db.commit()
    db.refresh(c)
    return contract_detail(c)


@router.post("/{contract_id}/still-used", response_model=ContractOut)
def still_used(contract_id: int, data: CheckedIn | None = None, db: Session = Depends(get_db)):
    """Answer to the subscription check: keep it, ask again in a year. With a body it sets the
    date of the last check directly (undo: back to the previous one)."""
    c = get_contract(db, contract_id)
    c.last_checked_on = data.last_checked_on if data else today()
    db.commit()
    db.refresh(c)
    return contract_detail(c)


@router.post("/{contract_id}/gaps/{key}/ignore", response_model=ContractOut)
def ignore_gap(contract_id: int, key: str, db: Session = Depends(get_db)):
    """ "Brauche ich nicht": stop asking for this piece of data on this contract."""
    c = get_contract(db, contract_id)
    ignored = [k for k in (c.attributes or {}).get(IGNORED_GAPS, []) if k != key]
    c.attributes = {**(c.attributes or {}), IGNORED_GAPS: [*ignored, key[:40]]}
    db.commit()
    db.refresh(c)
    return contract_detail(c)


@router.delete("/{contract_id}/gaps/{key}/ignore", response_model=ContractOut)
def unignore_gap(contract_id: int, key: str, db: Session = Depends(get_db)):
    c = get_contract(db, contract_id)
    attrs = dict(c.attributes or {})
    attrs[IGNORED_GAPS] = [k for k in attrs.get(IGNORED_GAPS, []) if k != key]
    if not attrs[IGNORED_GAPS]:
        del attrs[IGNORED_GAPS]
    c.attributes = attrs
    db.commit()
    db.refresh(c)
    return contract_detail(c)
