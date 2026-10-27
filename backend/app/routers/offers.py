from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from .. import calc
from ..categories import is_energy
from ..db import get_db
from ..models import Contract, Offer, PriceEntry, Reminder
from ..schemas import ContractOut, OfferIn, OfferOut, SwitchIn
from ..services import contract_detail, today
from .contracts import get_contract

router = APIRouter(prefix="/api/contracts/{contract_id}/offers", tags=["offers"])


def _get_offer(db: Session, contract_id: int, offer_id: int) -> Offer:
    o = db.get(Offer, offer_id)
    if o is None or o.contract_id != contract_id:
        raise HTTPException(404, "Angebot nicht gefunden")
    return o


@router.get("", response_model=list[OfferOut])
def list_offers(contract_id: int, db: Session = Depends(get_db)):
    return get_contract(db, contract_id).offers


@router.post("", response_model=OfferOut, status_code=201)
def create_offer(contract_id: int, data: OfferIn, db: Session = Depends(get_db)):
    c = get_contract(db, contract_id)
    o = Offer(**data.model_dump())
    c.offers.append(o)
    db.commit()
    db.refresh(o)
    return o


@router.put("/{offer_id}", response_model=OfferOut)
def update_offer(contract_id: int, offer_id: int, data: OfferIn, db: Session = Depends(get_db)):
    o = _get_offer(db, contract_id, offer_id)
    for key, value in data.model_dump().items():
        setattr(o, key, value)
    db.commit()
    db.refresh(o)
    return o


@router.delete("/{offer_id}", status_code=204)
def delete_offer(contract_id: int, offer_id: int, db: Session = Depends(get_db)):
    db.delete(_get_offer(db, contract_id, offer_id))
    db.commit()
    return Response(status_code=204)


@router.get("/evaluate")
def evaluate_offers(
    contract_id: int,
    horizon_months: int = Query(24, ge=1, le=120),
    min_saving_year: float = Query(20, ge=0),
    include_bonus: bool = Query(True, description="Count bonuses paid out within the horizon"),
    db: Session = Depends(get_db),
):
    c = get_contract(db, contract_id)
    ref = today()
    terms = calc.term_info(c, ref)
    results = [calc.evaluate_offer(o, c, ref, horizon_months, min_saving_year, include_bonus) for o in c.offers]
    results.sort(key=lambda r: r["savings_total"], reverse=True)
    return {
        "current_monthly": round(calc.contract_reference_monthly(c, ref), 2),
        "horizon_months": horizon_months,
        "min_saving_year": min_saving_year,
        "include_bonus": include_bonus,
        "earliest_switch": (terms.next_term_end + timedelta(days=1)) if terms.next_term_end else None,
        "cancellation_deadline": terms.cancellation_deadline,
        "results": results,
    }


@router.post("/{offer_id}/switch", response_model=ContractOut, status_code=201)
def switch_to_offer(contract_id: int, offer_id: int, data: SwitchIn, db: Session = Depends(get_db)):
    """Replace the contract by the offer: ends the old one and creates a linked successor."""
    old = get_contract(db, contract_id)
    offer = _get_offer(db, contract_id, offer_id)
    if data.switch_date <= old.start_date:
        raise HTTPException(400, "Wechseldatum muss nach Vertragsbeginn liegen")

    attributes = dict(old.attributes or {})
    attributes.update({k: v for k, v in (offer.attributes or {}).items() if v not in (None, "")})
    details: dict = {}
    if is_energy(old.category):
        for key in ("base_price_month", "unit_price_ct"):
            value = getattr(offer, key)
            if value is not None:
                attributes[key] = value
                details[key] = value
    monthly = calc.offer_monthly(offer, old)

    new = Contract(
        name=data.name or offer.name,
        category=old.category,
        provider=offer.provider or None,
        start_date=data.switch_date,
        min_term_months=offer.min_term_months,
        renewal_months=old.renewal_months,
        notice_value=old.notice_value,
        notice_unit=old.notice_unit,
        reminder_days=old.reminder_days,
        attributes=attributes,
        notes=offer.notes,
        predecessor_id=old.id,
        # A shared contract usually stays shared; the tax setting is a property of the kind of contract.
        share_percent=old.share_percent,
        partner_amount=old.partner_amount,
        account=old.account,
        tax_relevant=old.tax_relevant,
    )
    regular_from = data.switch_date
    if offer.promo_price is not None and offer.promo_months:
        regular_from = calc.add_months(data.switch_date, offer.promo_months)
        new.prices.append(
            PriceEntry(valid_from=data.switch_date, amount=offer.promo_price, interval="monthly", note="Aktionspreis")
        )
        new.reminders.append(
            Reminder(
                title=f"Aktionspreis {new.name} endet – Tarif prüfen",
                due_date=regular_from,
                lead_days=30,
                note=f"Ab {regular_from:%d.%m.%Y} gilt der reguläre Preis von {monthly:.2f} €".replace(
                    f"{monthly:.2f}", f"{monthly:.2f}".replace(".", ",")
                ),
            )
        )
    new.prices.append(
        PriceEntry(valid_from=regular_from, amount=round(monthly, 2), interval="monthly", details=details)
    )
    if offer.one_time_costs:
        new.prices.append(
            PriceEntry(valid_from=data.switch_date, amount=offer.one_time_costs, interval="once", note="Einmalkosten")
        )
    # Bonuses become credits in their payout month plus a reminder to check they actually arrive.
    for b in calc.offer_bonuses(offer):
        paid = calc.add_months(data.switch_date, int(b.get("paid_after_months") or 0))
        label = calc.BONUS_LABELS.get(b.get("type"), "Bonus")
        new.prices.append(
            PriceEntry(
                valid_from=paid,
                amount=-float(b["amount"]),
                interval="once",
                note=b.get("note") or label,
                details={"kind": "bonus", "bonus_type": b.get("type")},
            )
        )
        new.reminders.append(
            Reminder(
                title=f"{label} ({float(b['amount']):.0f} €) von {offer.provider or new.name} erhalten?",
                due_date=paid + timedelta(days=14),
                note="Falls nicht gutgeschrieben: beim Anbieter nachfragen.",
            )
        )
    db.add(new)

    new_end = data.switch_date - timedelta(days=1)
    if old.end_date is None or old.end_date > new_end:
        old.end_date = new_end
    if old.cancelled_on is None:
        old.cancelled_on = today()
    db.delete(offer)
    db.commit()
    db.refresh(new)
    return contract_detail(new)
