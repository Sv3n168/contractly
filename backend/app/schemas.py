from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .categories import CATEGORY_KEYS, INTERVALS

NoticeUnit = Literal["days", "weeks", "months"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- prices


class PriceIn(BaseModel):
    valid_from: date
    amount: float
    interval: str = "monthly"
    note: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)

    @field_validator("interval")
    @classmethod
    def _interval(cls, v: str) -> str:
        if v not in INTERVALS:
            raise ValueError(f"unknown interval {v!r}")
        return v


class PriceOut(PriceIn, ORM):
    id: int
    contract_id: int
    monthly_equivalent: float = 0


# --------------------------------------------------------------------------- documents


class DocumentOut(ORM):
    id: int
    contract_id: int | None
    original_name: str
    content_type: str | None
    size: int
    description: str | None
    uploaded_at: datetime
    has_text: bool = False


# --------------------------------------------------------------------------- contracts


class ContractBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str
    icon: str | None = None
    provider: str | None = None
    provider_address: str | None = None
    customer_number: str | None = None
    contract_number: str | None = None
    start_date: date
    end_date: date | None = None
    cancelled_on: date | None = None
    min_term_months: int | None = Field(default=None, ge=0)
    renewal_months: int | None = Field(default=None, ge=0)
    notice_value: int | None = Field(default=None, ge=0)
    notice_unit: NoticeUnit = "months"
    attributes: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None
    reminder_days: int | None = Field(default=30, ge=0, le=365)
    share_percent: int | None = Field(default=None, ge=0, le=100)
    cancellation_confirmed_on: date | None = None
    tax_relevant: bool | None = None
    withdrawal_until: date | None = None
    last_checked_on: date | None = None

    @field_validator("category")
    @classmethod
    def _category(cls, v: str) -> str:
        if v not in CATEGORY_KEYS:
            raise ValueError(f"unknown category {v!r}")
        return v

    @field_validator("icon")
    @classmethod
    def _icon(cls, v: str | None) -> str | None:
        return clean_icon(v)


class ContractCreate(ContractBase):
    predecessor_id: int | None = None
    # When a predecessor is given, end it the day before this contract starts.
    end_predecessor: bool = True
    initial_price: PriceIn | None = None
    # Documents uploaded via /api/documents/analyze to attach to the new contract.
    document_ids: list[int] = Field(default_factory=list)


class ContractUpdate(ContractBase):
    predecessor_id: int | None = None


def clean_icon(value: str | None) -> str | None:
    """An own emoji: short, no letters or digits (one emoji can be several code points)."""
    v = (value or "").strip()
    if not v:
        return None
    if len(v) > 16 or any(ch.isascii() and (ch.isalnum() or ch in "<>&\"'") for ch in v):
        raise ValueError("Bitte ein einzelnes Emoji wählen")
    return v


class ContractSummary(ORM):
    id: int
    name: str
    category: str
    icon: str | None = None
    provider: str | None
    start_date: date
    end_date: date | None
    cancelled_on: date | None
    predecessor_id: int | None
    successor_ids: list[int] = []
    state: str
    current_price: PriceOut | None = None
    monthly_cost: float
    yearly_cost: float
    next_term_end: date | None
    cancellation_deadline: date | None
    monthly_cancellable: bool = False
    share_percent: int | None = None
    full_monthly_cost: float = 0
    tax_relevant: bool = False
    cancellation_confirmed_on: date | None = None
    document_count: int = 0
    offer_count: int = 0
    attributes: dict[str, Any] = {}


class ContractOut(ContractSummary):
    withdrawal_until: date | None = None
    last_checked_on: date | None = None
    provider_address: str | None
    customer_number: str | None
    contract_number: str | None
    min_term_months: int | None
    renewal_months: int | None
    notice_value: int | None
    notice_unit: str
    notes: str | None
    reminder_days: int | None
    created_at: datetime
    updated_at: datetime
    prices: list[PriceOut] = []
    documents: list[DocumentOut] = []
    meter_readings: list["MeterReadingOut"] = []
    reminders: list["ReminderOut"] = []
    total_paid: float = 0
    extras_12m: float = 0
    extras_months_12m: int = 0
    switch_savings: float | None = None
    energy: dict[str, Any] | None = None
    loan: dict[str, Any] | None = None


class CancelIn(BaseModel):
    cancelled_on: date | None = None
    end_date: date | None = None


# --------------------------------------------------------------------------- offers


BonusType = Literal["instant", "new_customer", "switch", "number_porting", "cashback"]


class BonusIn(BaseModel):
    type: BonusType = "switch"
    amount: float = Field(ge=0)
    # Months after the switch until the bonus is paid out (0 = immediately)
    paid_after_months: int = Field(default=0, ge=0, le=60)
    note: str | None = None


class OfferIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    provider: str | None = None
    monthly_price: float | None = None
    base_price_month: float | None = None
    unit_price_ct: float | None = None
    one_time_costs: float = 0
    bonus: float = 0
    bonuses: list[BonusIn] = Field(default_factory=list)
    promo_price: float | None = Field(default=None, ge=0)
    promo_months: int | None = Field(default=None, ge=0, le=60)
    min_term_months: int | None = Field(default=None, ge=0)
    attributes: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None

    @field_validator("bonuses", mode="before")
    @classmethod
    def _bonuses(cls, v):
        return v or []


class OfferOut(OfferIn, ORM):
    id: int
    contract_id: int
    created_at: datetime


class SwitchIn(BaseModel):
    switch_date: date
    name: str | None = None


# --------------------------------------------------------------------------- reminders

Repeat = Literal["none", "monthly", "quarterly", "half_yearly", "yearly"]


class ReminderIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due_date: date
    repeat: Repeat = "none"
    lead_days: int = Field(default=0, ge=0, le=365)
    note: str | None = None
    contract_id: int | None = None


class ReminderOut(ReminderIn, ORM):
    id: int
    done_at: date | None
    created_at: datetime


# --------------------------------------------------------------------------- meter readings


class MeterReadingIn(BaseModel):
    reading_date: date
    value: float = Field(ge=0)
    note: str | None = None


class MeterReadingOut(MeterReadingIn, ORM):
    id: int
    contract_id: int


ContractOut.model_rebuild()


class ProfileIn(BaseModel):
    name: str | None = None
    street: str | None = None
    zip_city: str | None = None
    email: str | None = None
    phone: str | None = None
    city_for_letters: str | None = None


class PauseIn(BaseModel):
    from_date: date
    until: date | None = None
    extend_term: bool = True
    note: str | None = None


class ConfirmIn(BaseModel):
    confirmed_on: date | None = None
