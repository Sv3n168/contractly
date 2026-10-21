from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


class Contract(Base):
    __tablename__ = "contracts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(50), index=True)
    provider: Mapped[str | None] = mapped_column(String(200))
    provider_address: Mapped[str | None] = mapped_column(Text)
    customer_number: Mapped[str | None] = mapped_column(String(100))
    contract_number: Mapped[str | None] = mapped_column(String(100))
    start_date: Mapped[date] = mapped_column(Date)
    # Set once the contract is cancelled or replaced; last day of the contract.
    end_date: Mapped[date | None] = mapped_column(Date)
    cancelled_on: Mapped[date | None] = mapped_column(Date)
    min_term_months: Mapped[int | None] = mapped_column(Integer)
    renewal_months: Mapped[int | None] = mapped_column(Integer)
    notice_value: Mapped[int | None] = mapped_column(Integer)
    notice_unit: Mapped[str] = mapped_column(String(10), default="months")
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    # Days before the cancellation deadline to remind; None disables the reminder.
    reminder_days: Mapped[int | None] = mapped_column(Integer, default=30)
    predecessor_id: Mapped[int | None] = mapped_column(ForeignKey("contracts.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    prices: Mapped[list["PriceEntry"]] = relationship(
        back_populates="contract",
        cascade="all, delete-orphan",
        order_by="PriceEntry.valid_from",
    )
    documents: Mapped[list["Document"]] = relationship(
        back_populates="contract", cascade="all, delete-orphan", order_by="Document.uploaded_at"
    )
    offers: Mapped[list["Offer"]] = relationship(
        back_populates="contract", cascade="all, delete-orphan", order_by="Offer.created_at"
    )
    meter_readings: Mapped[list["MeterReading"]] = relationship(
        back_populates="contract", cascade="all, delete-orphan", order_by="MeterReading.reading_date"
    )
    reminders: Mapped[list["Reminder"]] = relationship(
        back_populates="contract", cascade="all, delete-orphan", order_by="Reminder.due_date"
    )
    predecessor: Mapped["Contract | None"] = relationship(remote_side="Contract.id", back_populates="successors")
    successors: Mapped[list["Contract"]] = relationship(back_populates="predecessor")


class PriceEntry(Base):
    """A price valid from a given date until the next entry (or a one-time charge/credit)."""

    __tablename__ = "price_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    valid_from: Mapped[date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Float)
    interval: Mapped[str] = mapped_column(String(20), default="monthly")
    note: Mapped[str | None] = mapped_column(String(300))
    # Optional tariff breakdown, e.g. {"base_price_month": 12.5, "unit_price_ct": 31.2}
    details: Mapped[dict] = mapped_column(JSON, default=dict)

    contract: Mapped[Contract] = relationship(back_populates="prices")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    # None while a document was uploaded for a contract that is not created yet.
    contract_id: Mapped[int | None] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    original_name: Mapped[str] = mapped_column(String(300))
    stored_name: Mapped[str] = mapped_column(String(100), unique=True)
    content_type: Mapped[str | None] = mapped_column(String(150))
    size: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(String(300))
    # Cached result of text extraction / OCR
    extracted_text: Mapped[str | None] = mapped_column(Text)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    contract: Mapped[Contract | None] = relationship(back_populates="documents")


class Offer(Base):
    """An alternative offer entered in the comparison module of a contract."""

    __tablename__ = "offers"

    id: Mapped[int] = mapped_column(primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str | None] = mapped_column(String(200))
    monthly_price: Mapped[float | None] = mapped_column(Float)
    base_price_month: Mapped[float | None] = mapped_column(Float)
    unit_price_ct: Mapped[float | None] = mapped_column(Float)
    one_time_costs: Mapped[float] = mapped_column(Float, default=0)
    # Legacy single bonus (paid immediately); superseded by ``bonuses``.
    bonus: Mapped[float] = mapped_column(Float, default=0)
    # [{"type": "switch", "amount": 50, "paid_after_months": 2, "note": "..."}]
    bonuses: Mapped[list | None] = mapped_column(JSON, default=list)
    # Introductory price for the first ``promo_months`` months
    promo_price: Mapped[float | None] = mapped_column(Float)
    promo_months: Mapped[int | None] = mapped_column(Integer)
    min_term_months: Mapped[int | None] = mapped_column(Integer)
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    contract: Mapped[Contract] = relationship(back_populates="offers")


class Reminder(Base):
    """A user-defined reminder, optionally attached to a contract and optionally repeating."""

    __tablename__ = "reminders"

    id: Mapped[int] = mapped_column(primary_key=True)
    contract_id: Mapped[int | None] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    due_date: Mapped[date] = mapped_column(Date)
    repeat: Mapped[str] = mapped_column(String(20), default="none")
    lead_days: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(Text)
    done_at: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    contract: Mapped[Contract | None] = relationship(back_populates="reminders")


class NotificationLog(Base):
    """Remembers sent notifications and dismissed automatic reminders (by key)."""

    __tablename__ = "notification_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(200), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class MeterReading(Base):
    """Meter reading (kWh) of an energy contract, used to estimate consumption and settlement."""

    __tablename__ = "meter_readings"

    id: Mapped[int] = mapped_column(primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    reading_date: Mapped[date] = mapped_column(Date)
    value: Mapped[float] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(String(300))

    contract: Mapped[Contract] = relationship(back_populates="meter_readings")


class AppSetting(Base):
    """Simple key/value store, e.g. the user's profile used as letter sender."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
