"""Example data so a fresh installation can be explored right away."""

from datetime import date, timedelta

from sqlalchemy.orm import Session

from .calc import add_months
from .models import Contract, MeterReading, Offer, PriceEntry, Reminder


def _m(ref: date, months: int) -> date:
    return add_months(ref, months).replace(day=1)


def seed(db: Session, ref: date | None = None) -> int:
    ref = ref or date.today()
    created: list[Contract] = []

    def contract(**kw) -> Contract:
        prices = kw.pop("prices", [])
        c = Contract(**kw)
        for valid_from, amount, interval, *rest in prices:
            c.prices.append(
                PriceEntry(
                    valid_from=valid_from,
                    amount=amount,
                    interval=interval,
                    note=rest[0] if rest else None,
                    details=rest[1] if len(rest) > 1 else {},
                )
            )
        db.add(c)
        created.append(c)
        return c

    mobile = contract(
        name="MagentaMobil M",
        category="mobile",
        provider="Telekom",
        start_date=_m(ref, -30),
        min_term_months=24,
        renewal_months=1,
        notice_value=1,
        notice_unit="months",
        attributes={
            "data_volume_gb": 40,
            "network": "Telekom",
            "five_g": True,
            "minutes": "Allnet-Flat",
            "eu_roaming": True,
        },
        prices=[
            (_m(ref, -30), 39.95, "monthly"),
            (_m(ref, -8), 42.95, "monthly", "Preisanpassung"),
            (_m(ref, -14) + timedelta(days=14), 18.40, "once", "Auslandstelefonate", {"kind": "extra"}),
            (_m(ref, -3) + timedelta(days=9), 12.99, "once", "Roaming (Schweiz)", {"kind": "extra"}),
        ],
    )
    db.flush()
    mobile.offers.append(
        Offer(
            name="Allnet 50 GB",
            provider="Freenet",
            monthly_price=24.99,
            one_time_costs=39.99,
            bonus=0,
            min_term_months=24,
            attributes={"data_volume_gb": 50, "network": "Vodafone", "five_g": True},
        )
    )
    mobile.offers.append(
        Offer(
            name="Prepaid 30 GB",
            provider="Aldi Talk",
            monthly_price=17.99,
            min_term_months=0,
            attributes={"data_volume_gb": 30, "network": "O2", "five_g": True},
        )
    )

    contract(
        name="Kabel 1000",
        category="internet",
        provider="Vodafone",
        start_date=_m(ref, -26),
        min_term_months=24,
        renewal_months=1,
        notice_value=1,
        notice_unit="months",
        attributes={"download_mbit": 1000, "upload_mbit": 50, "technology": "Kabel", "phone_flat": True},
        prices=[
            (_m(ref, -26), 19.99, "monthly", "Aktionspreis 6 Monate"),
            (_m(ref, -20), 49.99, "monthly"),
            (_m(ref, -4), 54.99, "monthly", "Preiserhöhung"),
        ],
    )

    old_power = contract(
        name="Grundversorgung Strom",
        category="electricity",
        provider="Stadtwerke",
        start_date=_m(ref, -40),
        end_date=_m(ref, -14) - timedelta(days=1),
        cancelled_on=_m(ref, -15),
        min_term_months=0,
        renewal_months=1,
        notice_value=14,
        notice_unit="days",
        attributes={"base_price_month": 14.5, "unit_price_ct": 41.2, "consumption_kwh": 2600, "installment": 104},
        prices=[
            (_m(ref, -40), 89, "monthly", None, {"base_price_month": 13.0, "unit_price_ct": 35.1}),
            (_m(ref, -26), 104, "monthly", "Preiserhöhung", {"base_price_month": 14.5, "unit_price_ct": 41.2}),
        ],
    )
    db.flush()
    power = contract(
        name="Ökostrom Flex",
        category="electricity",
        provider="Naturstrom Nord",
        start_date=_m(ref, -14),
        min_term_months=12,
        renewal_months=1,
        notice_value=1,
        notice_unit="months",
        predecessor_id=old_power.id,
        attributes={
            "base_price_month": 11.9,
            "unit_price_ct": 28.4,
            "consumption_kwh": 2600,
            "installment": 74,
            "green": True,
            "price_guarantee_until": _m(ref, 4).isoformat(),
        },
        prices=[
            (_m(ref, -14), 74, "monthly", "Abschlag", {"base_price_month": 11.9, "unit_price_ct": 28.4}),
            (_m(ref, -14), -60, "once", "Neukundenbonus"),
        ],
    )
    for months, value in ((-14, 10250), (-8, 11610), (-2, 12890)):
        power.meter_readings.append(MeterReading(reading_date=_m(ref, months) + timedelta(days=3), value=value))

    contract(
        name="Erdgas Komfort",
        category="gas",
        provider="E.ON",
        start_date=_m(ref, -20),
        min_term_months=12,
        renewal_months=1,
        notice_value=1,
        notice_unit="months",
        attributes={"base_price_month": 15.9, "unit_price_ct": 10.8, "consumption_kwh": 9000, "installment": 95},
        prices=[(_m(ref, -20), 95, "monthly", "Abschlag")],
    )

    year_start = date(ref.year - 2, 1, 1)
    contract(
        name="Kfz-Versicherung Golf",
        category="car_insurance",
        provider="HUK-COBURG",
        start_date=year_start,
        min_term_months=12,
        renewal_months=12,
        notice_value=1,
        notice_unit="months",
        attributes={
            "vehicle": "VW Golf 8",
            "license_plate": "HH-AB 123",
            "coverage": "Teilkasko",
            "sf_liability": "SF 12",
            "deductible_partial": 150,
            "annual_mileage": 12000,
        },
        prices=[(year_start, 486, "yearly"), (date(ref.year, 1, 1), 534, "yearly", "Beitragsanpassung")],
    )
    contract(
        name="Privat- & Verkehrsrechtsschutz",
        category="legal_protection",
        provider="ARAG",
        start_date=_m(ref, -50),
        min_term_months=36,
        renewal_months=12,
        notice_value=3,
        notice_unit="months",
        attributes={"modules": "Privat, Beruf, Verkehr", "deductible": 150, "coverage_sum": 1000000},
        prices=[(_m(ref, -50), 26.0, "monthly")],
    )

    gym = contract(
        name="FitX Studio",
        category="fitness",
        provider="FitX",
        start_date=_m(ref, -30),
        end_date=_m(ref, -7) - timedelta(days=1),
        cancelled_on=_m(ref, -9),
        min_term_months=12,
        renewal_months=1,
        notice_value=1,
        notice_unit="months",
        attributes={"location": "Innenstadt"},
        prices=[(_m(ref, -30), 35, "monthly"), (_m(ref, -30), 29, "once", "Startpaket")],
    )
    db.flush()
    contract(
        name="Sportnavi M",
        category="fitness",
        provider="Sportnavi",
        start_date=_m(ref, -7),
        min_term_months=1,
        renewal_months=1,
        notice_value=0,
        notice_unit="days",
        predecessor_id=gym.id,
        attributes={"plan": "M – 8 Besuche/Monat"},
        prices=[(_m(ref, -7), 45, "monthly")],
    )
    contract(
        name="Netflix Standard",
        category="streaming",
        provider="Netflix",
        start_date=_m(ref, -45),
        min_term_months=1,
        renewal_months=1,
        notice_value=0,
        notice_unit="days",
        attributes={"screens": 2, "quality": "HD", "ads": False},
        prices=[(_m(ref, -45), 11.99, "monthly"), (_m(ref, -18), 13.99, "monthly")],
    )
    db.flush()
    db.add(
        Reminder(
            title="Zählerstand Strom ablesen",
            due_date=_m(ref, 1) + timedelta(days=2),
            repeat="quarterly",
            lead_days=2,
            contract_id=power.id,
        )
    )
    db.add(
        Reminder(
            title="SF-Klasse prüfen & Kfz-Angebote vergleichen",
            due_date=date(ref.year, 11, 1) if ref < date(ref.year, 11, 1) else date(ref.year + 1, 11, 1),
            repeat="yearly",
            lead_days=7,
        )
    )
    db.commit()
    return len(created)
