"""Letters and e-mails from providers: recognition, contract matching and applying the changes."""

from datetime import date
from email.message import EmailMessage

import pytest

from app import messages

TODAY = date(2026, 10, 22)

PRICE_MAIL = (
    "Wichtige Information zu Ihrem Vertrag – Preisanpassung",
    "Hallo Sven Hauschke,\n"
    "wir passen die Preise für Ihren Tarif MagentaZuhause L an. Ab dem 01.01.2027 ändert sich Ihr monatlicher "
    "Grundpreis von 44,95 € auf 49,95 €.\nIhre Kundennummer: 123456789\n"
    "Sie haben ein Sonderkündigungsrecht bis zum Inkrafttreten der Änderung.",
)
INSTALLMENT_LETTER = (
    "",
    "Stadtwerke Musterstadt GmbH · Postfach 1 · 12345 Musterstadt\nMusterstadt, 14.10.2026\n"
    "Vertragskonto 4711-0815\nIhr neuer Abschlagsplan\n"
    "Ihr monatlicher Abschlag ändert sich von 95,00 € auf 118,00 €. Der neue Abschlag gilt ab dem 01.11.2026.",
)
CANCELLATION = (
    "Bestätigung Ihrer Kündigung",
    "Sehr geehrter Herr Hauschke,\nhiermit bestätigen wir Ihnen den Eingang Ihrer Kündigung. "
    "Ihre Mitgliedschaft endet zum 31.12.2026.\nMitgliedsnummer 99812",
)
SETTLEMENT = (
    "Ihre Jahresabrechnung Strom 2026",
    "Naturstrom Nord · 3. März 2027\nJahresabrechnung für den Zeitraum 01.02.2026 bis 31.01.2027\n"
    "Ihr Verbrauch: 2.950 kWh\nNachzahlungsbetrag: 184,80 €\n"
    "Ihr neuer monatlicher Abschlag beträgt ab April 2027 90,00 €.",
)
CREDIT = ("", "Ihre Verbrauchsabrechnung vom 05.02.2027\nWir erstatten Ihnen ein Guthaben in Höhe von 52,10 €.")
INSURANCE = (
    "Beitragsanpassung Ihrer Kfz-Versicherung",
    "Versicherungsschein-Nr. KFZ-778\nIhr Jahresbeitrag ab 01.01.2027: 589,40 €. Bisher zahlten Sie 534,00 € jährlich.",
)
TERMS = ("Änderung unserer AGB", "Wir ändern zum 01.02.2027 unsere Allgemeinen Geschäftsbedingungen.")
WELCOME = (
    "Herzlich willkommen bei Sportnavi",
    "Ihre Auftragsbestätigung. Vertragsbeginn 01.11.2026. Monatlicher Beitrag 45,00 €.",
)


@pytest.mark.parametrize(
    ("message", "kind", "facts"),
    [
        (PRICE_MAIL, "price_increase", {"effective_date": date(2027, 1, 1)}),
        (INSTALLMENT_LETTER, "installment", {"letter_date": date(2026, 10, 14), "installment": 118.0}),
        (CANCELLATION, "cancellation_confirmation", {"end_date": date(2026, 12, 31), "letter_date": TODAY}),
        (SETTLEMENT, "settlement", {"letter_date": date(2027, 3, 3), "installment": 90.0}),
        (CREDIT, "settlement", {"letter_date": date(2027, 2, 5)}),
        (INSURANCE, "price_increase", {"effective_date": date(2027, 1, 1)}),
        (TERMS, "terms_change", {"effective_date": date(2027, 2, 1)}),
        (WELCOME, "contract_confirmation", {}),
    ],
)
def test_classify_and_extract(message, kind, facts):
    subject, text = message
    r = messages.analyze(text, subject=subject, today=TODAY)
    assert r["kind"] == kind
    for key, value in facts.items():
        assert r["facts"][key] == value, key


def test_price_and_settlement_amounts():
    r = messages.analyze(PRICE_MAIL[1], subject=PRICE_MAIL[0], today=TODAY)
    assert (r["facts"]["price_change"]["old"], r["facts"]["price_change"]["new"]) == (44.95, 49.95)
    r = messages.analyze(INSURANCE[1], subject=INSURANCE[0], today=TODAY)
    change = r["facts"]["price_change"]
    assert (change["old"], change["new"], change["interval"]) == (534.0, 589.4, "yearly")
    assert messages.analyze(SETTLEMENT[1], subject=SETTLEMENT[0])["facts"]["settlement"]["amount"] == 184.8
    assert messages.analyze(CREDIT[1])["facts"]["settlement"]["amount"] == -52.1


def test_dates_and_html():
    assert messages.parse_date("3. März 2027") == date(2027, 3, 3)
    assert messages.parse_date("April 2027") == date(2027, 4, 1)
    assert messages.parse_date("31.02.2027") is None
    assert (
        messages._html_to_text("<p>Hallo&nbsp;Sven</p><style>p{}</style><div>Abschlag</div>") == "Hallo Sven\nAbschlag"
    )


# --------------------------------------------------------------------------- API


def _contract(client, **kw):
    start = "2025-01-01"
    payload = {
        "name": "Vertrag",
        "category": "other",
        "start_date": start,
        "initial_price": {"valid_from": start, "amount": 10},
    } | kw
    r = client.post("/api/contracts", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _apply(client, res, contract_id=None):
    actions = [a for a in res["actions"] if a.get("selected")]
    r = client.post(
        f"/api/inbox/{res['document_id']}/apply",
        json={"contract_id": contract_id or res["contract_id"], "actions": actions},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_pasted_mail_price_increase_end_to_end(client):
    tel = _contract(
        client,
        name="MagentaZuhause L",
        category="internet",
        provider="Telekom Deutschland GmbH",
        customer_number="123456789",
        initial_price={"valid_from": "2025-01-01", "amount": 44.95},
    )
    _contract(client, name="Handy", category="mobile", provider="Vodafone")
    res = client.post("/api/inbox/analyze", data={"subject": PRICE_MAIL[0], "text": PRICE_MAIL[1]}).json()
    assert res["kind"] == "price_increase" and res["contract_id"] == tel["id"]
    assert res["candidates"][0]["why"][0] == "Kundennummer"
    price = next(a for a in res["actions"] if a["type"] == "price")
    assert (price["amount"], price["valid_from"], price["interval"]) == (49.95, "2027-01-01", "monthly")
    assert price["details"] == {}  # "Grundpreis" of a phone line is not an energy tariff
    assert any(a["type"] == "info" and "Sonderkündigungsrecht" in a["label"] for a in res["actions"])

    assert _apply(client, res)["applied"] == ["Preis"]
    detail = client.get(f"/api/contracts/{tel['id']}").json()
    assert [p["amount"] for p in detail["prices"]] == [44.95, 49.95]
    doc = detail["documents"][0]
    assert doc["description"].startswith("Preiserhöhung vom")
    assert client.get(f"/api/documents/{doc['id']}").content.decode().startswith("Betreff: Wichtige Information")
    kinds = {i["kind"] for i in client.get("/api/reminders/upcoming?horizon_days=120").json()["items"]}
    assert "price_increase" in kinds  # special right of cancellation is now on the radar


def _eml(sender, subject, html, attachment=None):
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = "sven@example.org"
    msg["Subject"] = subject
    msg["Date"] = "Wed, 14 Oct 2026 09:12:00 +0200"
    msg.set_content("Bitte HTML-Ansicht verwenden.")
    msg.add_alternative(html, subtype="html")
    if attachment:
        msg.add_attachment(attachment[1], maintype="application", subtype="pdf", filename=attachment[0])
    return msg.as_bytes()


def test_eml_installment_matches_sender_domain(client):
    gas = _contract(
        client,
        name="Erdgas",
        category="gas",
        provider="Stadtwerke Musterstadt",
        attributes={"installment": 95},
        initial_price={"valid_from": "2025-01-01", "amount": 95},
    )
    html = (
        "<html><body><p>Guten Tag,</p><p>Ihr monatlicher Abschlag ändert sich von 95,00&nbsp;€ auf 118,00&nbsp;€.</p>"
        "<p>Der neue Abschlag gilt ab dem 01.11.2026.</p></body></html>"
    )
    blob = _eml("Ihre Stadtwerke <service@stadtwerke-musterstadt.de>", "Ihr neuer Abschlagsplan", html)
    res = client.post("/api/inbox/analyze", files={"file": ("abschlag.eml", blob, "message/rfc822")}).json()
    assert res["kind"] == "installment" and res["contract_id"] == gas["id"]
    assert "Absender" in res["candidates"][0]["why"]
    assert res["facts"]["letter_date"] == "2026-10-14"  # from the e-mail header
    _apply(client, res)
    detail = client.get(f"/api/contracts/{gas['id']}").json()
    assert detail["prices"][-1]["amount"] == 118 and detail["prices"][-1]["valid_from"] == "2026-11-01"
    assert detail["attributes"]["installment"] == 118
    assert detail["documents"][0]["original_name"] == "Ihr neuer Abschlagsplan.txt"


def test_eml_pdf_attachment_is_kept(client):
    pdftotext = pytest.importorskip("shutil").which("pdftotext")
    if not pdftotext:
        pytest.skip("pdftotext not installed")
    _contract(client, name="Strom", category="electricity", provider="Naturstrom Nord")
    pdf = _pdf("Jahresabrechnung 2026 Nachzahlungsbetrag: 184,80 EUR")
    blob = _eml(
        "Naturstrom Nord <rechnung@naturstrom-nord.de>", "Ihre Jahresabrechnung", "<p>Anbei</p>", ("re.pdf", pdf)
    )
    res = client.post("/api/inbox/analyze", files={"file": ("mail.eml", blob)}).json()
    assert res["original_name"] == "re.pdf"
    assert res["kind"] == "settlement"
    extra = next(a for a in res["actions"] if a["type"] == "extra")
    assert extra["amount"] == 184.8


def _pdf(text: str) -> bytes:
    """Minimal one-page PDF with a text layer."""
    stream = f"BT /F1 12 Tf 40 760 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def test_cancellation_confirmation_and_settlement(client):
    gym = _contract(client, name="FitX", category="fitness", provider="FitX", contract_number="99812")
    client.post(f"/api/contracts/{gym['id']}/cancel", json={"cancelled_on": "2026-10-01"})
    res = client.post("/api/inbox/analyze", data={"subject": CANCELLATION[0], "text": CANCELLATION[1]}).json()
    assert res["contract_id"] == gym["id"]
    _apply(client, res)
    detail = client.get(f"/api/contracts/{gym['id']}").json()
    assert detail["cancellation_confirmed_on"] and detail["end_date"] == "2026-12-31"

    power = _contract(client, name="Ökostrom", category="electricity", provider="Naturstrom Nord")
    res = client.post("/api/inbox/analyze", data={"subject": SETTLEMENT[0], "text": SETTLEMENT[1]}).json()
    assert res["contract_id"] == power["id"]
    types = {a["type"] for a in res["actions"]}
    assert {"extra", "price"} <= types
    _apply(client, res)
    prices = client.get(f"/api/contracts/{power['id']}").json()["prices"]
    extra = next(p for p in prices if p["interval"] == "once")
    assert extra["amount"] == 184.8 and extra["details"]["kind"] == "extra"
    assert any(p["amount"] == 90 and p["valid_from"] == "2027-04-01" for p in prices)


def test_unknown_provider_and_other_contract(client):
    other = _contract(client, name="Netflix", category="streaming", provider="Netflix")
    res = client.post("/api/inbox/analyze", data={"subject": WELCOME[0], "text": WELCOME[1]}).json()
    assert res["contract_id"] is None and res["actions"][0]["type"] == "new_contract"
    # the user picks a contract themselves
    res = client.get(f"/api/inbox/{res['document_id']}?contract_id={other['id']}").json()
    assert res["contract_id"] == other["id"] and res["actions"][-1]["type"] == "attach"


def test_bad_input(client):
    assert client.post("/api/inbox/analyze", data={"text": "  "}).status_code == 400
    r = client.post("/api/inbox/analyze", files={"file": ("x.msg", b"\xd0\xcf\x11\xe0", "application/vnd.ms-outlook")})
    assert r.status_code == 400 and ".eml" in r.json()["detail"]
    res = client.post("/api/inbox/analyze", data={"text": "Hallo"}).json()
    bad = client.post(f"/api/inbox/{res['document_id']}/apply", json={"contract_id": 999, "actions": []})
    assert bad.status_code == 404
