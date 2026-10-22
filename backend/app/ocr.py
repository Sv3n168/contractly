"""Text extraction (pdftotext / Tesseract OCR) and heuristic detection of contract data."""

import logging
import re
import shutil
import subprocess
import tempfile
from datetime import date
from pathlib import Path

log = logging.getLogger("contractly.ocr")

MAX_PDF_PAGES = 5
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".gif"}


class OcrError(Exception):
    pass


def available() -> dict[str, bool]:
    return {
        "pdftotext": shutil.which("pdftotext") is not None,
        "tesseract": shutil.which("tesseract") is not None,
        "pdftoppm": shutil.which("pdftoppm") is not None,
    }


def _run(args: list[str], timeout: int = 120) -> str:
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise OcrError(proc.stderr.strip()[-300:] or f"{args[0]} fehlgeschlagen")
    return proc.stdout


def _tesseract(image: Path) -> str:
    if not shutil.which("tesseract"):
        raise OcrError("Tesseract ist nicht installiert")
    return _run(["tesseract", str(image), "stdout", "-l", "deu+eng", "--psm", "3"])


def extract_text(path: Path, content_type: str | None = None) -> tuple[str, str]:
    """Returns (text, method)."""
    suffix = path.suffix.lower()
    is_pdf = suffix == ".pdf" or (content_type or "").endswith("pdf")
    if is_pdf:
        text = ""
        if shutil.which("pdftotext"):
            text = _run(["pdftotext", "-layout", "-l", str(MAX_PDF_PAGES), str(path), "-"])
        if len(text.strip()) >= 80:
            return text, "pdf-text"
        if not shutil.which("pdftoppm"):
            raise OcrError("PDF enthält keinen Text und pdftoppm fehlt für OCR")
        with tempfile.TemporaryDirectory() as tmp:
            _run(["pdftoppm", "-r", "300", "-l", str(MAX_PDF_PAGES), "-png", str(path), f"{tmp}/page"], timeout=300)
            pages = sorted(Path(tmp).glob("page*.png"))
            return "\n\f".join(_tesseract(p) for p in pages), "ocr"
    if suffix in IMAGE_TYPES or (content_type or "").startswith("image/"):
        return _tesseract(path), "ocr"
    if suffix in {".txt", ".csv", ".md"}:
        return path.read_text(errors="replace"), "text"
    raise OcrError("Dateityp wird für die Texterkennung nicht unterstützt (PDF oder Bild)")


# --------------------------------------------------------------------------- field detection

_LABEL_VALUE = r"[:#.\s]*\s*([A-Z0-9][A-Z0-9\-/ .]{3,28}[A-Z0-9])"

PATTERNS: list[tuple[str, str, str, re.Pattern]] = [
    # (field key, label, target, pattern)
    (
        "customer_number",
        "Kundennummer",
        "contract",
        re.compile(r"(?:Kunden[- ]?(?:nummer|nr\.?)|Kd\.?[- ]?Nr\.?|Kundenkonto(?:nummer)?)" + _LABEL_VALUE, re.I),
    ),
    (
        "contract_number",
        "Vertragsnummer",
        "contract",
        re.compile(
            r"(?:Vertrags[- ]?konto[- ]?(?:nummer|nr\.?)|Vertrags[- ]?(?:nummer|nr\.?|konto)|"
            r"Versicherungs[- ]?(?:schein)?[- ]?(?:nummer|nr\.?)|"
            r"Policen[- ]?(?:nummer|nr\.?))" + _LABEL_VALUE,
            re.I,
        ),
    ),
    ("meter_number", "Zählernummer", "attribute", re.compile(r"Zähler[- ]?(?:nummer|nr\.?)" + _LABEL_VALUE, re.I)),
    (
        "market_location",
        "Marktlokation (MaLo)",
        "attribute",
        re.compile(r"(?:Marktlokation|MaLo)(?:[- ]?ID)?[:#.\s]*\s*(\d{11})", re.I),
    ),
    (
        "phone_number",
        "Rufnummer",
        "attribute",
        re.compile(r"(?:Ruf|Mobilfunk|Telefon)[- ]?nummer[:\s]*((?:\+49|0)[\d /-]{6,18}\d)", re.I),
    ),
    (
        "license_plate",
        "Kennzeichen",
        "attribute",
        re.compile(r"(?:amtl\.?\s*)?Kennzeichen[:\s]*([A-ZÄÖÜ]{1,3}[- ][A-Z]{1,2}[- ]?\d{1,4}[EH]?)", re.I),
    ),
]

IBAN_RE = re.compile(r"\b(DE\d{2}(?:\s?\d{4}){4}\s?\d{2})\b")
DATE_RE = re.compile(r"\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b")
START_RE = re.compile(r"(?:Vertrags|Versicherungs|Liefer)?(?:beginn|start)|gültig ab|Lieferbeginn|ab dem", re.I)
AMOUNT_RE = re.compile(
    r"(\d{1,4}(?:\.\d{3})*,\d{2})\s*(?:€|EUR)(?:\s*(?:/|pro|je|im)\s*(Monat|Mon\.|Jahr|monatlich|jährlich))?", re.I
)
MONTHLY_HINT_RE = re.compile(r"monatlich|mtl\.|pro Monat|/\s*Monat|Grundgebühr|Monatspreis|Abschlag", re.I)
YEARLY_HINT_RE = re.compile(r"jährlich|pro Jahr|/\s*Jahr|Jahresbeitrag|Jahresprämie|Beitrag p\.a\.", re.I)
UNIT_PRICE_RE = re.compile(r"Arbeitspreis[^\n\d]{0,40}(\d{1,3},\d{1,4})\s*(?:ct|Cent)", re.I)
BASE_PRICE_RE = re.compile(r"Grundpreis[^\n\d]{0,40}(\d{1,4},\d{2})\s*(?:€|EUR)", re.I)
CONSUMPTION_RE = re.compile(r"(?:Jahresverbrauch|Verbrauch)[^\n\d]{0,40}(\d{1,3}(?:\.\d{3})*|\d{3,6})\s*kWh", re.I)
DATA_VOLUME_RE = re.compile(r"(\d{1,3})\s*GB\b(?![^\n]*(?:Speicher|Cloud))", re.I)
POSTCODE_LINE_RE = re.compile(r"^\s*(?:D-)?(\d{5})\s+[A-ZÄÖÜ][\wäöüß .\-]+$")
STREET_RE = re.compile(r"(straße|str\.|weg|allee|platz|ring|gasse|damm|ufer|chaussee|postfach|\s\d+[a-z]?\s*$)", re.I)
COMPANY_RE = re.compile(r"\b(GmbH|AG|SE|KG|KGaA|e\.\s?V\.|mbH|VVaG|Versicherung|Stadtwerke|Telekom|Vodafone)\b")


def _num(value: str) -> float:
    return float(value.replace(".", "").replace(",", "."))


def _parse_date(d: str, m: str, y: str) -> date | None:
    year = int(y) + (2000 if len(y) == 2 else 0)
    try:
        return date(year, int(m), int(d))
    except ValueError:
        return None


def _clean(value: str) -> str:
    return re.sub(r"\s{2,}", " ", value).strip(" .-/")


POSTCODE_CITY_RE = re.compile(r"\b\d{5}\s+[A-ZÄÖÜ][\wäöüß\-]+(?:\s(?:am|an der|im|bei)\s[A-ZÄÖÜ][\wäöüß\-]+)?")
STREET_SPLIT_RE = re.compile(r"(?<=\d)(?:[a-z])?\s+(?=[A-ZÄÖÜ])")
COMPANY_SPLIT_RE = re.compile(r"\b(?:GmbH|AG|SE|KG|mbH|KGaA|VVaG|e\.V\.)(\s+)")


def _side_by_side_blocks(lines: list[str]) -> list[str]:
    """OCR merges two address columns (sender | recipient) into one line - split them again."""
    blocks = []
    nonempty = [ln.strip() for ln in lines[:80] if ln.strip()]
    for i, line in enumerate(nonempty):
        postcodes = list(POSTCODE_CITY_RE.finditer(line))
        if len(postcodes) != 2 or re.search(r"\s{3,}", line):
            continue
        cols = [[line[: postcodes[1].start()].strip()], [line[postcodes[1].start() :].strip()]]
        for back in range(1, 3):
            if i - back < 0:
                break
            prev = nonempty[i - back]
            parts = STREET_SPLIT_RE.split(prev, maxsplit=1)
            if len(parts) != 2 and (m := COMPANY_SPLIT_RE.search(prev)):
                parts = [prev[: m.start(1)], prev[m.end(1) :]]
            if len(parts) != 2 or not all(p.strip() for p in parts):
                break
            cols[0].insert(0, parts[0].strip())
            cols[1].insert(0, parts[1].strip())
            if COMPANY_RE.search(parts[0]):
                break
        for col in cols:
            if len(col) >= 2 and any(STREET_RE.search(b) for b in col[:-1]):
                blocks.append("\n".join(col))
    return blocks


def _address_candidates(lines: list[str]) -> list[str]:
    """Find address blocks (company / street / postcode city) - typically the sender."""
    found = _side_by_side_blocks(lines)
    for i, line in enumerate(lines[:80]):
        # Layout PDFs put recipient and sender side by side; examine column chunks separately.
        for chunk in re.split(r"\s{3,}", line.strip()):
            if not POSTCODE_LINE_RE.match(chunk):
                continue
            block = [chunk.strip()]
            for back in range(1, 4):
                if i - back < 0:
                    break
                prev_chunks = [c for c in re.split(r"\s{3,}", lines[i - back].strip()) if c]
                if not prev_chunks:
                    break
                # pick the chunk in roughly the same column
                col = line.find(chunk)
                prev_line = lines[i - back]
                best = min(prev_chunks, key=lambda c: abs(prev_line.find(c) - col))
                block.insert(0, best.strip())
                if COMPANY_RE.search(best):
                    break
            if len(block) >= 2 and any(STREET_RE.search(b) for b in block[:-1]):
                found.append("\n".join(block))
    # Prefer blocks that look like companies (provider), keep order otherwise.
    found.sort(key=lambda b: 0 if COMPANY_RE.search(b) else 1)
    unique = []
    for b in found:
        if b not in unique:
            unique.append(b)
    return unique


def detect_fields(text: str) -> list[dict]:
    suggestions: list[dict] = []

    def add(key: str, label: str, value, target: str, source: str = "", alternatives=None):
        if value in (None, "") or any(s["key"] == key for s in suggestions):
            return
        item = {"key": key, "label": label, "value": value, "target": target, "source": source.strip()[:120]}
        if alternatives:
            item["alternatives"] = alternatives
        suggestions.append(item)

    for key, label, target, pattern in PATTERNS:
        m = pattern.search(text)
        if m:
            value = _clean(m.group(1))
            # Avoid capturing the next label word
            value = re.split(r"\s(?:vom|Datum|Seite|Tel|Rechnung)", value)[0].strip()
            if sum(ch.isdigit() for ch in value) >= 3:
                add(key, label, value, target, m.group(0))

    iban = IBAN_RE.search(text)
    if iban:
        add("iban", "IBAN (Abbuchung)", iban.group(1).replace(" ", ""), "attribute", iban.group(0))

    lines = text.splitlines()
    for line in lines:
        if START_RE.search(line):
            d = DATE_RE.search(line[START_RE.search(line).start() :])
            if d and (parsed := _parse_date(*d.groups())):
                add("start_date", "Vertragsbeginn", parsed.isoformat(), "contract", line)
                break

    if m := UNIT_PRICE_RE.search(text):
        add("unit_price_ct", "Arbeitspreis (ct/kWh)", _num(m.group(1)), "attribute", m.group(0))
    if m := BASE_PRICE_RE.search(text):
        value = _num(m.group(1))
        if YEARLY_HINT_RE.search(m.group(0)) or "Jahr" in text[m.end() : m.end() + 20]:
            value = round(value / 12, 2)
        add("base_price_month", "Grundpreis (€/Monat)", value, "attribute", m.group(0))
    if m := CONSUMPTION_RE.search(text):
        add("consumption_kwh", "Jahresverbrauch (kWh)", _num(m.group(1)), "attribute", m.group(0))
    if m := DATA_VOLUME_RE.search(text):
        add("data_volume_gb", "Datenvolumen (GB)", int(m.group(1)), "attribute", m.group(0))

    # Price: prefer amounts on lines that mention a billing interval.
    amounts = []
    for line in lines:
        for m in AMOUNT_RE.finditer(line):
            interval = None
            hint = (m.group(2) or "") + " " + line
            if YEARLY_HINT_RE.search(hint) or (m.group(2) or "").lower().startswith(("jahr", "jähr")):
                interval = "yearly"
            elif MONTHLY_HINT_RE.search(hint) or (m.group(2) or "").lower().startswith("mon"):
                interval = "monthly"
            amounts.append({"amount": _num(m.group(1)), "interval": interval, "line": line.strip()[:120]})
    priced = [a for a in amounts if a["interval"]]
    if priced:
        best = priced[0]
        add(
            "price",
            "Preis",
            {"amount": best["amount"], "interval": best["interval"]},
            "price",
            best["line"],
            alternatives=[{"amount": a["amount"], "interval": a["interval"], "line": a["line"]} for a in priced[1:6]],
        )

    addresses = _address_candidates(lines)
    if addresses:
        add("provider_address", "Anschrift Anbieter", addresses[0], "contract", "", alternatives=addresses[1:4] or None)
        first_line = addresses[0].splitlines()[0]
        if COMPANY_RE.search(first_line):
            add("provider", "Anbieter", first_line, "contract", first_line)
    return suggestions
