"""Contract categories and the category-specific fields ("Eckdaten") they carry.

Field definitions are served to the frontend, which renders forms and
comparison tables from them. Values are stored in ``Contract.attributes``.
"""

from typing import Any


def _f(key: str, label: str, type_: str = "text", unit: str | None = None, **extra: Any) -> dict:
    field = {"key": key, "label": label, "type": type_}
    if unit:
        field["unit"] = unit
    field.update(extra)
    return field


ENERGY_FIELDS = [
    _f("base_price_month", "Grundpreis", "number", "€/Monat"),
    _f("unit_price_ct", "Arbeitspreis", "number", "ct/kWh"),
    _f("consumption_kwh", "Jahresverbrauch", "number", "kWh"),
    _f("installment", "Abschlag", "number", "€/Monat"),
    _f("price_guarantee_until", "Preisgarantie bis", "date"),
    _f("meter_number", "Zählernummer"),
    _f("market_location", "Marktlokation (MaLo)"),
]

CATEGORIES: list[dict] = [
    {
        "key": "mobile",
        "label": "Mobilfunk",
        "icon": "📱",
        "defaults": {"min_term_months": 24, "renewal_months": 1, "notice_value": 1, "notice_unit": "months"},
        "fields": [
            _f("data_volume_gb", "Datenvolumen", "number", "GB"),
            _f("network", "Netz", "select", options=["Telekom", "Vodafone", "O2", "1&1", "Sonstiges"]),
            _f("max_speed_mbit", "Max. Geschwindigkeit", "number", "Mbit/s"),
            _f("five_g", "5G", "bool"),
            _f("minutes", "Minuten/SMS", "text", placeholder="z. B. Allnet-Flat"),
            _f("eu_roaming", "EU-Roaming", "bool"),
            _f("phone_number", "Rufnummer"),
            _f("device", "Endgerät"),
        ],
    },
    {
        "key": "internet",
        "label": "Festnetz & Internet",
        "icon": "🌐",
        "defaults": {"min_term_months": 24, "renewal_months": 1, "notice_value": 1, "notice_unit": "months"},
        "fields": [
            _f("download_mbit", "Download", "number", "Mbit/s"),
            _f("upload_mbit", "Upload", "number", "Mbit/s"),
            _f("technology", "Technologie", "select", options=["DSL/VDSL", "Kabel", "Glasfaser", "LTE/5G", "Satellit"]),
            _f("phone_flat", "Telefon-Flat", "bool"),
            _f("tv_included", "TV inklusive", "bool"),
            _f("router", "Router"),
            _f("phone_number", "Rufnummer"),
        ],
    },
    {
        "key": "electricity",
        "label": "Strom",
        "icon": "⚡",
        "energy": True,
        "defaults": {"min_term_months": 12, "renewal_months": 1, "notice_value": 1, "notice_unit": "months"},
        "fields": ENERGY_FIELDS + [_f("green", "Ökostrom", "bool")],
    },
    {
        "key": "gas",
        "label": "Gas",
        "icon": "🔥",
        "energy": True,
        "defaults": {"min_term_months": 12, "renewal_months": 1, "notice_value": 1, "notice_unit": "months"},
        "fields": ENERGY_FIELDS + [_f("climate_neutral", "Klimaneutral", "bool")],
    },
    {
        "key": "car_insurance",
        "label": "Kfz-Versicherung",
        "icon": "🚗",
        "defaults": {"min_term_months": 12, "renewal_months": 12, "notice_value": 1, "notice_unit": "months"},
        "fields": [
            _f("vehicle", "Fahrzeug"),
            _f("license_plate", "Kennzeichen"),
            _f("coverage", "Deckung", "select", options=["Haftpflicht", "Teilkasko", "Vollkasko"]),
            _f("sf_liability", "SF-Klasse Haftpflicht"),
            _f("sf_comprehensive", "SF-Klasse Vollkasko"),
            _f("deductible_partial", "SB Teilkasko", "number", "€"),
            _f("deductible_full", "SB Vollkasko", "number", "€"),
            _f("annual_mileage", "Fahrleistung", "number", "km/Jahr"),
            _f("workshop_binding", "Werkstattbindung", "bool"),
        ],
    },
    {
        "key": "legal_protection",
        "label": "Rechtsschutz",
        "icon": "⚖️",
        "defaults": {"min_term_months": 12, "renewal_months": 12, "notice_value": 3, "notice_unit": "months"},
        "fields": [
            _f("modules", "Bausteine", placeholder="Privat, Beruf, Verkehr, Wohnen"),
            _f("coverage_sum", "Deckungssumme", "number", "€"),
            _f("deductible", "Selbstbeteiligung", "number", "€"),
            _f("waiting_period_months", "Wartezeit", "number", "Monate"),
        ],
    },
    {
        "key": "liability",
        "label": "Haftpflicht",
        "icon": "🛡️",
        "defaults": {"min_term_months": 12, "renewal_months": 12, "notice_value": 3, "notice_unit": "months"},
        "fields": [
            _f("coverage_sum", "Deckungssumme", "number", "Mio. €"),
            _f("deductible", "Selbstbeteiligung", "number", "€"),
            _f("family", "Familientarif", "bool"),
        ],
    },
    {
        "key": "household",
        "label": "Hausrat",
        "icon": "🏠",
        "defaults": {"min_term_months": 12, "renewal_months": 12, "notice_value": 3, "notice_unit": "months"},
        "fields": [
            _f("insured_sum", "Versicherungssumme", "number", "€"),
            _f("living_area", "Wohnfläche", "number", "m²"),
            _f("deductible", "Selbstbeteiligung", "number", "€"),
            _f("bike_theft", "Fahrraddiebstahl", "bool"),
            _f("elementary", "Elementarschäden", "bool"),
        ],
    },
    {
        "key": "insurance",
        "label": "Sonstige Versicherung",
        "icon": "📋",
        "defaults": {"min_term_months": 12, "renewal_months": 12, "notice_value": 3, "notice_unit": "months"},
        "fields": [
            _f("insurance_type", "Art", placeholder="z. B. Berufsunfähigkeit, Zahnzusatz"),
            _f("insured_sum", "Versicherungssumme", "number", "€"),
            _f("deductible", "Selbstbeteiligung", "number", "€"),
        ],
    },
    {
        "key": "streaming",
        "label": "Streaming & Abos",
        "icon": "🎬",
        "defaults": {"min_term_months": 1, "renewal_months": 1, "notice_value": 0, "notice_unit": "days"},
        "fields": [
            _f("plan", "Tarif/Paket"),
            _f("screens", "Gleichzeitige Streams", "number"),
            _f("quality", "Qualität", "select", options=["SD", "HD", "4K"]),
            _f("ads", "Mit Werbung", "bool"),
        ],
    },
    {
        "key": "fitness",
        "label": "Fitness & Vereine",
        "icon": "🏋️",
        "defaults": {"min_term_months": 12, "renewal_months": 1, "notice_value": 1, "notice_unit": "months"},
        "fields": [
            _f("location", "Standort"),
            _f("plan", "Tarif"),
        ],
    },
    {
        "key": "other",
        "label": "Sonstiges",
        "icon": "📄",
        "defaults": {"min_term_months": None, "renewal_months": 1, "notice_value": 1, "notice_unit": "months"},
        "fields": [],
    },
]

CATEGORY_MAP = {c["key"]: c for c in CATEGORIES}
CATEGORY_KEYS = list(CATEGORY_MAP)

INTERVALS = {
    "monthly": {"label": "monatlich", "months": 1},
    "quarterly": {"label": "vierteljährlich", "months": 3},
    "half_yearly": {"label": "halbjährlich", "months": 6},
    "yearly": {"label": "jährlich", "months": 12},
    "once": {"label": "einmalig", "months": None},
}


def is_energy(category: str) -> bool:
    return bool(CATEGORY_MAP.get(category, {}).get("energy"))


# Typically deductible in a German tax return (Vorsorgeaufwendungen etc.); adjustable per contract.
TAX_RELEVANT_DEFAULT = {"liability", "legal_protection", "car_insurance", "insurance"}
# Subscriptions worth a yearly "do I still use this?" check.
SUBSCRIPTION_CATEGORIES = {"streaming", "fitness"}


def tax_relevant(category: str, explicit: bool | None) -> bool:
    return explicit if explicit is not None else category in TAX_RELEVANT_DEFAULT
