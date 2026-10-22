"""Letters and e-mails from providers: what kind of message is it and what has to change?

Works on plain text (OCR of a photo/PDF, an e-mail body or pasted text) with simple,
local rules – no data leaves the server. The result is a list of proposed actions the
user confirms with one click (new price, confirmed cancellation, settlement, …).
"""

import email
import html
import re
from datetime import date, timedelta
from email import policy
from email.utils import parseaddr, parsedate_to_datetime

from . import ocr
from .categories import is_energy

KINDS = {
    "price_increase": "Preiserhöhung",
    "price_decrease": "Preissenkung",
    "installment": "Neuer Abschlag",
    "settlement": "Jahresabrechnung",
    "cancellation_confirmation": "Kündigungsbestätigung",
    "contract_confirmation": "Vertragsbestätigung",
    "terms_change": "Neue Vertragsbedingungen",
    "other": "Schreiben",
}

# Keyword patterns per kind; the subject counts three times.
SIGNALS: dict[str, re.Pattern] = {
    "price_increase": re.compile(
        r"preiserhöhung|preisanpassung|preisänderung|beitragsanpassung|beitragserhöhung|neue preise|"
        r"(?:erhöhen|anpassen|ändern) (?:wir|sich) (?:\w+ ){0,3}(?:preis|beitr)|preise? (?:steig|erhöh)",
        re.I,
    ),
    "price_decrease": re.compile(r"preissenkung|(?:senken|reduzieren) wir (?:\w+ ){0,3}(?:preis|beitr)", re.I),
    "installment": re.compile(r"abschlag(?:splan|szahlung|sanpassung)?|vorauszahlung", re.I),
    "settlement": re.compile(
        r"jahresabrechnung|verbrauchsabrechnung|schlussrechnung|endabrechnung|nachzahlung|guthaben", re.I
    ),
    "cancellation_confirmation": re.compile(
        r"kündigungsbestätigung|bestätigung (?:ihrer|der) kündigung|ihre kündigung|kündigung (?:\w+ ){0,4}bestätig|"
        r"(?:vertrag|mitgliedschaft) endet",
        re.I,
    ),
    "contract_confirmation": re.compile(
        r"auftragsbestätigung|vertragsbestätigung|willkommen bei|herzlich willkommen|ihr neuer vertrag|"
        r"versicherungsschein|lieferbeginn|vertragsunterlagen",
        re.I,
    ),
    "terms_change": re.compile(
        r"allgemeine[nr]? geschäftsbedingungen|\bagb\b|leistungsbeschreibung|vertragsbedingungen|bedingungen ändern",
        re.I,
    ),
}

MONTHS = {
    m: i + 1
    for i, names in enumerate(
        [
            ("januar", "jan"),
            ("februar", "feb"),
            ("märz", "maerz", "mär"),
            ("april", "apr"),
            ("mai",),
            ("juni", "jun"),
            ("juli", "jul"),
            ("august", "aug"),
            ("september", "sep", "sept"),
            ("oktober", "okt"),
            ("november", "nov"),
            ("dezember", "dez"),
        ]
    )
    for m in names
}
_MONTH_NAMES = "|".join(sorted(MONTHS, key=len, reverse=True))
DATE = rf"(\d{{1,2}}\.\d{{1,2}}\.(?:\d{{4}}|\d{{2}})\b|(?:\d{{1,2}}\.\s*)?(?:{_MONTH_NAMES})\.?\s+\d{{4}})"
DATE_ANY = re.compile(DATE, re.I)
AMOUNT = r"(?:(?:€|EUR)\s*(\d{1,5}(?:\.\d{3})*,\d{2})|(\d{1,5}(?:\.\d{3})*,\d{2})\s*(?:€|EUR|Euro))"
CENT = r"(\d{1,3},\d{1,4})\s*(?:ct|Cent)"

EFFECTIVE_RE = re.compile(
    rf"(?:\bab\b|\bzum\b|mit wirkung (?:zum|ab|vom)|gültig ab|wirksam (?:zum|ab)|gelten ab|beginnend (?:am|mit))"
    rf"\s+(?:dem\s+|den\s+)?{DATE}",
    re.I,
)
END_RE = re.compile(
    rf"(?:\bzum\b|endet (?:am|zum|mit ablauf des)|beendet (?:am|zum)|vertragsende[:\s]+|läuft (?:am|zum)|"
    rf"ende der (?:vertrags)?laufzeit[:\s]+|wirksam zum)\s*(?:dem\s+)?{DATE}",
    re.I,
)
CHANGE_RE = re.compile(rf"von\s*{AMOUNT}[^\n€]{{0,40}}?\bauf\s*{AMOUNT}", re.I)
NEW_PRICE_RE = re.compile(
    rf"(?:neue[rnms]?|künftige[rnms]?|zukünftige[rnms]?)\s+(?:monatliche[rnms]?\s+|jährliche[rnms]?\s+)?"
    rf"(?:Preis|Beitrag|Grundgebühr|Monatspreis|Paketpreis|Jahresbeitrag|Abschlag)\w*[^\n€]{{0,50}}?{AMOUNT}",
    re.I,
)
# "Ihr Jahresbeitrag ab 01.01.2027: 589,40 €" / "Bisher zahlten Sie 534,00 €"
DATED_PRICE_RE = re.compile(
    rf"(?:Preis|Beitrag|Grundgebühr|Monatspreis|Paketpreis|Prämie)\w*\s+(?:ab|zum)\s+(?:dem\s+)?{DATE}"
    rf"[^\n€]{{0,25}}?{AMOUNT}",
    re.I,
)
OLD_PRICE_RE = re.compile(rf"\b(?:bisher(?:ige[rnms]?)?|alte[rnms]?)\b[^\n€]{{0,40}}?{AMOUNT}", re.I)
# Date lines in a letter head: "Musterstadt, 14.10.2026", "Datum: …", "… vom 05.02.2027", "Firma · 3. März 2027"
LETTER_DATE_RE = re.compile(
    rf"(?:^\s*(?:[A-ZÄÖÜ][\wäöüß .\-]{{1,40}}(?:,|·)\s*)?(?:den\s+)?{DATE}\s*$|"
    rf"(?:Datum|Briefdatum|Rechnungsdatum)[:\s]+{DATE}|\bvom\s+{DATE})",
    re.I | re.M,
)
INSTALLMENT_RE = re.compile(rf"Abschlag\w*[^\n€]{{0,60}}?{AMOUNT}", re.I)
SETTLEMENT_RE = re.compile(rf"(nachzahlung|nachzuzahlen|guthaben|erstatten|erstattung)\w*[^\n€]{{0,60}}?{AMOUNT}", re.I)
UNIT_CHANGE_RE = re.compile(rf"Arbeitspreis[^\n]{{0,80}}?von\s*{CENT}[^\n]{{0,30}}?auf\s*{CENT}", re.I)
BASE_CHANGE_RE = re.compile(rf"Grundpreis[^\n]{{0,80}}?von\s*{AMOUNT}[^\n]{{0,30}}?auf\s*{AMOUNT}", re.I)
YEARLY_RE = re.compile(r"jährlich|pro jahr|im jahr|/\s*jahr|jahresbeitrag|jahresprämie|p\.\s?a\.", re.I)
PRICE_WORD_RE = re.compile(r"preis|beitrag|grundgebühr|kosten|tarif|monatlich|entgelt", re.I)


# --------------------------------------------------------------------------- reading


def _amount(m: re.Match, first_group: int = 1) -> float:
    raw = m.group(first_group) or m.group(first_group + 1)
    return float(raw.replace(".", "").replace(",", "."))


def parse_date(text: str) -> date | None:
    text = text.strip().lower().replace(" ", " ")
    if m := re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})", text):
        d, mo, y = m.groups()
        try:
            return date(int(y) + (2000 if len(y) == 2 else 0), int(mo), int(d))
        except ValueError:
            return None
    if m := re.fullmatch(rf"(?:(\d{{1,2}})\.\s*)?({_MONTH_NAMES})\.?\s+(\d{{4}})", text):
        d, name, y = m.groups()
        try:
            return date(int(y), MONTHS[name], int(d or 1))
        except ValueError:
            return None
    return None


def _html_to_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", markup)
    markup = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|li|h\d)>", "\n", markup)
    text = html.unescape(re.sub(r"<[^>]+>", " ", markup))
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def read_email(blob: bytes) -> dict:
    """Subject, sender, date, body text and attachments of an .eml file."""
    msg = email.message_from_bytes(blob, policy=policy.default)
    name, addr = parseaddr(str(msg.get("From", "")))
    try:
        sent = parsedate_to_datetime(str(msg.get("Date"))).date() if msg.get("Date") else None
    except (TypeError, ValueError):
        sent = None
    plain = msg.get_body(preferencelist=("plain",))
    rich = msg.get_body(preferencelist=("html",))
    text = plain.get_content() if plain is not None else ""
    if rich is not None:
        # Many newsletters' plain part is only "please view as HTML": prefer the fuller version.
        html_text = _html_to_text(rich.get_content())
        if len(html_text) > 1.5 * len(text.strip()):
            text = html_text
    attachments = []
    for part in msg.iter_attachments():
        payload = part.get_payload(decode=True)
        if payload:
            attachments.append(
                {"filename": part.get_filename() or "anhang", "content_type": part.get_content_type(), "data": payload}
            )
    return {
        "subject": str(msg.get("Subject", "") or ""),
        "sender_name": name,
        "sender_address": addr,
        "date": sent,
        "text": text.strip(),
        "attachments": attachments,
    }


# --------------------------------------------------------------------------- analysis


def classify(text: str, subject: str = "") -> str:
    scores = {kind: 3 * len(p.findall(subject)) + len(p.findall(text)) for kind, p in SIGNALS.items()}
    # A settlement usually also announces a new installment; a price change letter mentions "Preis" a lot.
    if scores["settlement"] and scores["installment"] and re.search(r"abrechnung", subject + text, re.I):
        scores["settlement"] += 2
    if scores["cancellation_confirmation"] and re.search(r"kündigung", subject, re.I):
        scores["cancellation_confirmation"] += 3
    best = max(scores, key=lambda k: scores[k])
    return best if scores[best] > 0 else "other"


def _first_date(pattern: re.Pattern, text: str, not_before: date | None = None) -> date | None:
    for m in pattern.finditer(text):
        d = parse_date(m.group(m.lastindex))
        if d and (not_before is None or d >= not_before):
            return d
    return None


def letter_date(text: str) -> date | None:
    """Date of the letter from a date line in its head (not a deadline like "ab dem …")."""
    head = "\n".join(text.splitlines()[:25])
    for m in LETTER_DATE_RE.finditer(head):
        raw = next((g for g in m.groups() if g), None)
        if raw and (d := parse_date(raw)):
            return d
    return None


def price_change(text: str) -> dict | None:
    """Old/new recurring price; ``kind`` tells whether it is the installment (Abschlag)."""
    for m in CHANGE_RE.finditer(text):
        window = text[max(0, m.start() - 160) : m.end() + 60]
        if not PRICE_WORD_RE.search(window) and "abschlag" not in window.lower():
            continue
        old, new = _amount(m, 1), _amount(m, 3)
        if old == new:
            continue
        return {
            "old": old,
            "new": new,
            "kind": "installment" if re.search(r"abschlag", window, re.I) else "price",
            "interval": "yearly" if YEARLY_RE.search(window) else None,
            "source": m.group(0)[:160],
        }
    if m := DATED_PRICE_RE.search(text):
        old = OLD_PRICE_RE.search(text)
        window = text[max(0, m.start() - 60) : m.end() + 80]
        return {
            "old": _amount(old) if old else None,
            "new": _amount(m, 2),
            "kind": "installment" if re.search(r"abschlag", m.group(0), re.I) else "price",
            "interval": "yearly" if YEARLY_RE.search(window) else None,
            "source": m.group(0)[:160],
        }
    if m := NEW_PRICE_RE.search(text):
        window = text[max(0, m.start() - 60) : m.end() + 60]
        return {
            "old": None,
            "new": _amount(m),
            "kind": "installment" if re.search(r"abschlag", m.group(0), re.I) else "price",
            "interval": "yearly" if YEARLY_RE.search(window) else None,
            "source": m.group(0)[:160],
        }
    return None


def new_installment(text: str) -> float | None:
    candidates = []
    for m in INSTALLMENT_RE.finditer(text):
        window = text[max(0, m.start() - 40) : m.end() + 40].lower()
        weight = 2 if re.search(r"neu|künftig|zukünftig|ab |ab dem", window) else 1
        candidates.append((weight, m.start(), _amount(m)))
    if not candidates:
        return None
    candidates.sort(key=lambda c: (-c[0], c[1]))
    return candidates[0][2]


def settlement(text: str) -> dict | None:
    for m in SETTLEMENT_RE.finditer(text):
        word = m.group(1).lower()
        value = _amount(m, 2)
        if value <= 0:
            continue
        credit = word.startswith(("guthaben", "erstatt"))
        return {"amount": -value if credit else value, "credit": credit, "source": m.group(0)[:160]}
    return None


def energy_prices(text: str) -> dict:
    out = {}
    if m := UNIT_CHANGE_RE.search(text):
        out["unit_price_ct"] = float(m.group(2).replace(",", "."))
    if m := BASE_CHANGE_RE.search(text):
        value = _amount(m, 3)
        window = text[m.start() : m.end() + 30]
        out["base_price_month"] = round(value / 12, 2) if YEARLY_RE.search(window) else value
    return out


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9äöüß]", "", (text or "").lower())


LEGAL_WORDS = re.compile(r"\b(gmbh|ag|se|kg|mbh|co|ohg|deutschland|germany|versicherung|services?|online)\b", re.I)


def _provider_tokens(provider: str) -> list[str]:
    words = re.findall(r"[a-zäöüß0-9&\-]{3,}", LEGAL_WORDS.sub(" ", (provider or "").lower()))
    return [w for w in words if len(w) >= 3]


def match_contracts(contracts, text: str, sender: str = "", sender_address: str = "") -> list[dict]:
    """Contracts the message probably belongs to, best first."""
    hay = _norm(text)
    low = f"{sender} {text}".lower()
    domain = sender_address.split("@")[-1].lower() if "@" in sender_address else ""
    domain_root = domain.rsplit(".", 2)[-2] if domain.count(".") >= 1 else ""
    out = []
    for c in contracts:
        score = 0
        reasons = []
        for label, number in (("Kundennummer", c.customer_number), ("Vertragsnummer", c.contract_number)):
            n = _norm(number)
            if len(n) >= 4 and n in hay:
                score += 10
                reasons.append(label)
        tokens = _provider_tokens(c.provider or "") or _provider_tokens(c.name)
        if tokens and any(re.search(rf"\b{re.escape(t)}", low) for t in tokens):
            score += 5
            reasons.append("Anbieter")
        joined = "".join(_norm(t) for t in tokens)
        root = _norm(domain_root)
        if len(root) >= 3 and joined and (root == joined or joined in root or (len(root) >= 5 and root in joined)):
            score += 4
            reasons.append("Absender")
        if score:
            if c.end_date and c.end_date < date.today() - timedelta(days=400):
                score -= 4  # long gone
            out.append({"contract_id": c.id, "name": c.name, "provider": c.provider, "score": score, "why": reasons})
    out.sort(key=lambda x: -x["score"])
    return out


def analyze(
    text: str,
    *,
    subject: str = "",
    sender: str = "",
    sender_address: str = "",
    sent: date | None = None,
    contracts=(),
    today: date | None = None,
) -> dict:
    """Classify a message, extract facts and propose actions."""
    today = today or date.today()
    full = f"{subject}\n{text}" if subject else text
    kind = classify(text, subject)
    written = sent or letter_date(text) or today
    effective = _first_date(EFFECTIVE_RE, full, not_before=written - timedelta(days=31))
    fields = ocr.detect_fields(text)
    provider = sender or next((f["value"] for f in fields if f["key"] == "provider"), "")
    candidates = match_contracts(contracts, full, sender, sender_address)
    facts: dict = {"letter_date": written, "effective_date": effective}

    change = price_change(full)
    if change:
        facts["price_change"] = change
        if kind in ("other", "terms_change", "contract_confirmation") and change["old"] is not None:
            kind = "price_increase" if change["new"] > change["old"] else "price_decrease"
        elif kind == "price_increase" and change["old"] is not None and change["new"] < change["old"]:
            kind = "price_decrease"
    installment = None
    if change and change["kind"] == "installment":
        installment = change["new"]
    elif kind in ("installment", "settlement"):
        installment = new_installment(full)
    if installment:
        facts["installment"] = installment
    if kind == "settlement" and (s := settlement(full)):
        facts["settlement"] = s
    if energy := energy_prices(full):
        facts["energy_prices"] = energy
    if kind == "cancellation_confirmation":
        facts["end_date"] = _first_date(END_RE, full, not_before=written - timedelta(days=1))
    return {
        "kind": kind,
        "kind_label": KINDS[kind],
        "subject": subject,
        "sender": sender,
        "provider": provider,
        "facts": facts,
        "fields": fields,
        "candidates": candidates[:5],
        "actions": [],
    }


def propose_actions(result: dict, contract) -> list[dict]:
    """Concrete changes for the chosen contract (None = message for a contract not yet recorded)."""
    f = result["facts"]
    kind = result["kind"]
    written: date = f["letter_date"]
    effective: date | None = f.get("effective_date")
    actions: list[dict] = []
    if contract is None:
        if kind in ("contract_confirmation", "other", "price_increase"):
            actions.append(
                {"type": "new_contract", "label": "Neuen Vertrag mit diesen Angaben anlegen", "selected": True}
            )
        return actions

    current = None
    recurring = sorted((p for p in contract.prices if p.interval != "once"), key=lambda p: p.valid_from)
    if recurring:
        current = recurring[-1]
    interval = current.interval if current is not None else "monthly"

    def money(v: float) -> str:
        return f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")

    change = f.get("price_change")
    is_installment = bool(f.get("installment")) or bool(change and change["kind"] == "installment")
    # Energy: a new base/unit price is a tariff change, the installment (Abschlag) stays as it is.
    energy = (f.get("energy_prices") or {}) if is_energy(contract.category) else {}
    new_amount = None
    what = "Preis"
    if is_installment:
        new_amount = f.get("installment") or change["new"]
        interval, what = "monthly", "Abschlag"
    elif energy and current is not None:
        new_amount, what = current.amount, "Tarif"
    elif change:
        new_amount = change["new"]
        interval = change["interval"] or interval
    if new_amount is not None and (current is None or abs(current.amount - new_amount) > 0.004 or energy):
        if effective:
            valid_from = effective
        elif kind == "settlement":  # the new installment usually starts with the next month
            valid_from = (written.replace(day=1) + timedelta(days=32)).replace(day=1)
        else:
            valid_from = written
        if what == "Tarif":
            parts = []
            if "unit_price_ct" in energy:
                parts.append(f"Arbeitspreis {energy['unit_price_ct']:.2f} ct/kWh".replace(".", ","))
            if "base_price_month" in energy:
                parts.append(f"Grundpreis {money(energy['base_price_month'])}/Monat")
            label = f"Neue Tarifpreise ab {valid_from:%d.%m.%Y}: {', '.join(parts)}"
        else:
            label = f"Neuer {what}: {money(new_amount)} ab {valid_from:%d.%m.%Y}"
            if current is not None and current.interval == interval:
                label += f" (bisher {money(current.amount)})"
        actions.append(
            {
                "type": "price",
                "label": label,
                "valid_from": valid_from,
                "amount": new_amount,
                "interval": interval,
                "details": energy,
                "selected": True,
            }
        )
        raises = what == "Tarif" or (current is not None and new_amount > current.amount and what == "Preis")
        if raises and kind != "price_decrease" and valid_from > written:
            actions.append(
                {
                    "type": "info",
                    "label": f"Sonderkündigungsrecht bis {valid_from - timedelta(days=1):%d.%m.%Y} – "
                    "Contractly erinnert dich rechtzeitig",
                    "selected": True,
                }
            )
    if (s := f.get("settlement")) is not None:
        label = f"{'Guthaben' if s['credit'] else 'Nachzahlung'} aus der Abrechnung: {money(abs(s['amount']))}"
        actions.append({"type": "extra", "label": label, "on": written, "amount": s["amount"], "selected": True})
    if kind == "cancellation_confirmation":
        end = f.get("end_date") or contract.end_date
        label = "Kündigung als bestätigt markieren" + (f", Vertragsende {end:%d.%m.%Y}" if end else "")
        actions.append(
            {"type": "confirm_cancellation", "label": label, "end_date": end, "on": written, "selected": True}
        )
    if kind == "terms_change":
        due = effective or written + timedelta(days=14)
        actions.append(
            {
                "type": "reminder",
                "label": f"Erinnerung: neue Bedingungen bis {due:%d.%m.%Y} prüfen (oft mit Sonderkündigungsrecht)",
                "title": f"Neue Bedingungen prüfen: {contract.name}",
                "due_date": due,
                "selected": True,
            }
        )
    if (
        kind == "contract_confirmation"
        and contract.withdrawal_until is None
        and (written - contract.start_date).days <= 30
    ):
        until = written + timedelta(days=14)
        actions.append(
            {
                "type": "withdrawal",
                "label": f"Widerrufsfrist bis {until:%d.%m.%Y} merken",
                "until": until,
                "selected": True,
            }
        )
    actions.append({"type": "attach", "label": f"Schreiben bei „{contract.name}“ ablegen", "selected": True})
    return actions
