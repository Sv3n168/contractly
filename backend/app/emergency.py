"""Emergency folder for relatives ("Notfall-Mappe").

All contracts with what relatives need to end or take them over: provider and address,
customer/contract numbers, costs, notice periods, documents, a ready-made cancellation
letter for a death and a short checklist. It exists as a printable page and as a single,
self-contained HTML file encrypted with a passphrase (AES-256-GCM, key via PBKDF2): it
opens in any browser, offline, without Contractly.
"""

import base64
import json
import os
from datetime import date
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from . import calc, loans
from .categories import CATEGORY_MAP, INTERVALS
from .models import Contract

VIEWER = Path(__file__).parent / "templates" / "emergency.html"
PBKDF2_ITERATIONS = 600_000
MAX_DOCUMENT_BYTES = 40 * 1024 * 1024

UNITS = {"days": ("Tag", "Tage"), "weeks": ("Woche", "Wochen"), "months": ("Monat", "Monate")}

# What usually happens with this kind of contract when the holder dies (general hints, no legal advice).
DEATH_HINTS = {
    "mobile": "Meist mit Sterbeurkunde vorzeitig kündbar. Rufnummer vorher "
    "übernehmen, falls sie weiter gebraucht wird.",
    "internet": "Meist mit Sterbeurkunde vorzeitig kündbar. Läuft der Anschluss für "
    "Mitbewohner weiter, auf sie umschreiben.",
    "electricity": "Geht auf die Erben über. Bei Auflösung der Wohnung kündigen und den "
    "Zählerstand am Auszugstag notieren.",
    "gas": "Geht auf die Erben über. Bei Auflösung der Wohnung kündigen und den Zählerstand am Auszugstag notieren.",
    "car_insurance": "Geht mit dem Fahrzeug auf die Erben über. Bei Verkauf oder Abmeldung endet sie; "
    "der Schadenfreiheitsrabatt lässt sich oft auf Angehörige übertragen.",
    "legal_protection": "Endet meist mit dem Tod. Versicherer mit Sterbeurkunde informieren, zu viel gezahlte Beiträge "
    "zurückfordern.",
    "liability": "Läuft für mitversicherte Angehörige oft bis zur nächsten Fälligkeit "
    "weiter – Versicherer informieren.",
    "household": "Endet spätestens mit Auflösung des Haushalts – Versicherer informieren.",
    "insurance": "Versicherer mit Sterbeurkunde informieren; bei Lebens-/Sterbegeldversicherung Auszahlung beantragen.",
    "streaming": "Mit Sterbeurkunde kündigen und die Abbuchung stoppen.",
    "fitness": "Mitgliedschaften enden meist mit dem Tod – mit Sterbeurkunde kündigen und Abbuchung stoppen.",
    "loan": "Schulden gehen auf die Erben über – das Erbe kann innerhalb von sechs Wochen ausgeschlagen werden. "
    "Prüfen, ob eine Restschuldversicherung besteht, und die Bank mit Sterbeurkunde informieren.",
}
CHECKLIST = [
    "Sterbeurkunde mehrfach beglaubigt kopieren lassen – fast jeder Anbieter verlangt eine Kopie.",
    "Bank informieren; Daueraufträge und Lastschriften prüfen (welche Verträge buchen ab?).",
    "Verträge in dieser Mappe durchgehen: übernehmen, ummelden oder kündigen. "
    "Für jeden Vertrag liegt ein vorbereitetes Kündigungsschreiben bei.",
    "Bei Versicherungen nach Beitragserstattung fragen; Lebens- und Sterbegeldversicherungen sofort melden.",
    "Strom, Gas, Internet erst kündigen, wenn die Wohnung aufgelöst wird – Zählerstände notieren.",
    "Online-Konten und Abos (Streaming, Apps) nicht vergessen; Zugangsdaten siehe Hinweise unten.",
]
HIGHLIGHT_ATTRIBUTES = {
    "phone_number": "Rufnummer",
    "meter_number": "Zählernummer",
    "market_location": "Marktlokation",
    "license_plate": "Kennzeichen",
    "iban": "IBAN (Abbuchung)",
}


def _notice(c: Contract) -> str:
    if not c.notice_value:
        return "keine"
    one, many = UNITS.get(c.notice_unit or "months", ("Monat", "Monate"))
    return f"{c.notice_value} {one if c.notice_value == 1 else many}"


def _money(v: float) -> str:
    return f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def _loan_details(c: Contract, today: date) -> list[dict]:
    if not loans.is_loan(c.category):
        return []
    a = loans.analysis(c, today) or {}
    out = []
    if a.get("balance") is not None:
        out.append({"label": "Restschuld (berechnet)", "value": f"{_money(a['balance'])} am {today:%d.%m.%Y}"})
    if a.get("payoff_date"):
        out.append({"label": "Abbezahlt am", "value": f"{a['payoff_date']:%d.%m.%Y}"})
    insured = (c.attributes or {}).get("debt_insurance")
    out.append({"label": "Restschuldversicherung", "value": "ja" if insured else "nein / unbekannt"})
    return out


def death_letter(c: Contract, owner: dict) -> str:
    refs = [
        f"{label}: {value}"
        for label, value in (
            ("Kundennummer", c.customer_number),
            ("Vertragsnummer", c.contract_number),
            *((label, (c.attributes or {}).get(key)) for key, label in HIGHLIGHT_ATTRIBUTES.items() if key != "iban"),
        )
        if value
    ]
    name = owner.get("name") or "[Name der verstorbenen Person]"
    recipient = (c.provider_address or c.provider or "[Anbieter]").strip()
    return "\n".join(
        [
            "[Dein Name]\n[Straße Nr.]\n[PLZ Ort]",
            "",
            recipient,
            "",
            "[Ort], [Datum]",
            "",
            f"Kündigung wegen Todesfall: {c.name}",
            f"Vertragsinhaber/in: {name}",
            *refs,
            "",
            "Sehr geehrte Damen und Herren,",
            "",
            f"{name} ist am [Sterbedatum] verstorben. Als [Erbe/Erbin bzw. Bevollmächtigte/r] kündige ich den oben "
            "genannten Vertrag außerordentlich zum nächstmöglichen Zeitpunkt. Eine Kopie der Sterbeurkunde liegt bei.",
            "",
            "Bitte bestätigen Sie mir die Kündigung und das Vertragsende schriftlich, stellen Sie alle Abbuchungen ein "
            "und erstatten Sie zu viel gezahlte Beträge auf folgendes Konto: [IBAN].",
            "",
            "Mit freundlichen Grüßen",
            "",
            "[Unterschrift]",
        ]
    )


def build(contracts: list[Contract], owner: dict, note: str, today: date) -> dict:
    running = [c for c in contracts if c.end_date is None or c.end_date >= today]
    items = []
    for c in sorted(running, key=lambda c: (CATEGORY_MAP.get(c.category, {}).get("label", ""), c.name.lower())):
        cat = CATEGORY_MAP.get(c.category, {})
        price = calc.price_at(c, today) or next(iter(calc.recurring_prices(c)), None)
        interval = INTERVALS.get(price.interval, {}).get("label", "") if price else ""
        terms = calc.term_info(c, today)
        attrs = c.attributes or {}
        items.append(
            {
                "id": c.id,
                "name": c.name,
                "category": c.category,
                "category_label": cat.get("label", "Sonstiges"),
                "icon": c.icon or cat.get("icon", "📄"),
                "provider": c.provider,
                "provider_address": c.provider_address,
                "customer_number": c.customer_number,
                "contract_number": c.contract_number,
                "details": [
                    {"label": label, "value": str(attrs[key])}
                    for key, label in HIGHLIGHT_ATTRIBUTES.items()
                    if attrs.get(key)
                ]
                + _loan_details(c, today),
                "price": f"{_money(price.amount)} {interval}".strip() if price else None,
                "monthly_cost": round(calc.current_monthly_cost(c, today), 2),
                "start_date": c.start_date,
                "notice": _notice(c),
                "next_term_end": terms.next_term_end,
                "cancellation_deadline": terms.cancellation_deadline,
                "flexible": terms.flexible,
                "cancelled_on": c.cancelled_on,
                "end_date": c.end_date,
                "notes": c.notes,
                "death_hint": DEATH_HINTS.get(c.category, "Anbieter mit Sterbeurkunde informieren und kündigen."),
                "letter": death_letter(c, owner),
                "documents": [
                    {"id": d.id, "name": d.original_name, "description": d.description, "size": d.size}
                    for d in sorted(c.documents, key=lambda d: d.uploaded_at, reverse=True)
                ],
            }
        )
    return {
        "owner": {k: owner.get(k) for k in ("name", "street", "zip_city", "email", "phone")},
        "note": note,
        "generated_on": today,
        "checklist": CHECKLIST,
        "contracts": items,
        "monthly_total": round(sum(i["monthly_cost"] for i in items), 2),
    }


def _derive(passphrase: str, salt: bytes) -> bytes:
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITERATIONS).derive(
        passphrase.encode("utf-8")
    )


def encrypt(payload: dict, passphrase: str) -> dict:
    """Encrypt for the browser (WebCrypto: PBKDF2-SHA256 + AES-GCM)."""
    salt, iv = os.urandom(16), os.urandom(12)
    data = json.dumps(payload, default=str, ensure_ascii=False).encode("utf-8")
    ct = AESGCM(_derive(passphrase, salt)).encrypt(iv, data, None)
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return {"v": 1, "iter": PBKDF2_ITERATIONS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def decrypt(blob: dict, passphrase: str) -> dict:
    """Counterpart of :func:`encrypt` (used by the tests; relatives use the browser)."""
    raw = AESGCM(_derive(passphrase, base64.b64decode(blob["salt"]))).decrypt(
        base64.b64decode(blob["iv"]), base64.b64decode(blob["ct"]), None
    )
    return json.loads(raw)


def viewer_html(blob: dict, generated_on: date) -> str:
    """The self-contained file: encrypted data plus a small viewer, no external resources."""
    return (
        VIEWER.read_text(encoding="utf-8")
        .replace("__GENERATED__", f"{generated_on:%d.%m.%Y}")
        .replace("__PAYLOAD__", json.dumps(blob))
    )
