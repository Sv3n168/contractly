from datetime import date

from app import importer
from app.calc import add_months

# Real Sparkasse CSV-CAMT header: "Lastschrift Ursprungsbetrag" comes before "Betrag".
SPARKASSE = """Auftragskonto;Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Glaeubiger ID;Mandatsreferenz;Kundenreferenz (End-to-End);Sammlerreferenz;Lastschrift Ursprungsbetrag;Auslagenersatz Ruecklastschrift;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC (SWIFT-Code);Betrag;Waehrung;Info
{rows}"""


def _bank_csv():
    rows = []
    start = add_months(date.today(), -8).replace(day=3)
    for i in range(8):
        d = add_months(start, i)
        # Telekom: 39,95 then 42,95 from month 5; one month with 15 € extra (calls abroad)
        tel = 39.95 if i < 5 else 42.95
        if i == 2:
            tel += 15
        amount = f"{tel:.2f}".replace(".", ",")
        rows.append(
            f"DE1;{d:%d.%m.%y};x;LASTSCHRIFT;Rechnung {i};DE11ZZZ;M1;Telekom Deutschland GmbH;DE9;BIC;-{amount};EUR;"
        )
        rows.append(
            f"DE1;{add_months(start, i).replace(day=15):%d.%m.%y};x;LASTSCHRIFT;Mitgliedsbeitrag;DE22ZZZ;M2;FitX Deutschland GmbH;DE8;BIC;-35,00;EUR;Umsatz gebucht"
        )
        rows.append(f"DE1;{d.replace(day=25):%d.%m.%y};x;GUTSCHRIFT;Gehalt;;;Arbeitgeber AG;DE7;BIC;2500,00;EUR;")
        if i == 4:
            rows.append(f"DE1;{d:%d.%m.%y};x;KARTENZAHLUNG;Einkauf;;;REWE Markt;DE6;BIC;-54,20;EUR;")
    rows.append(
        f"DE1;{date.today().replace(month=1, day=10):%d.%m.%y};x;LASTSCHRIFT;Beitrag 2026;DE33ZZZ;M3;HUK-COBURG;DE5;BIC;-534,00;EUR;"
    )
    rows = [";".join((f := r.split(";"))[:7] + ["", "", "", ""] + f[7:]) for r in rows]
    return SPARKASSE.format(rows="\n".join(rows)).encode("cp1252")


def test_amount_and_date_parsing():
    assert importer.parse_amount("-1.234,56") == -1234.56
    assert importer.parse_amount("12,99 €") == 12.99
    assert importer.parse_amount("1,234.50") == 1234.50
    assert importer.parse_amount("19.99-") == -19.99
    assert importer.parse_date("03.02.26") == date(2026, 2, 3)
    assert importer.parse_date("2026-02-03") == date(2026, 2, 3)


def test_detect_recurring_with_price_change_and_extra():
    txs = importer.read_transactions(_bank_csv(), "umsaetze.csv")
    found = {f["name"]: f for f in importer.detect_recurring(txs)}
    assert set(found) == {"Telekom Deutschland GmbH", "FitX Deutschland GmbH"}  # salary, REWE, single HUK ignored
    tel = found["Telekom Deutschland GmbH"]
    assert tel["interval"] == "monthly" and tel["amount"] == 42.95
    assert [(c["old"], c["new"]) for c in tel["price_changes"]] == [(39.95, 42.95)]
    assert [e["amount"] for e in tel["extras"]] == [15.0]
    assert tel["category"] in ("internet", "mobile")
    assert found["FitX Deutschland GmbH"]["category"] == "fitness"


def test_bank_import_flow(client):
    # existing contract with the old price -> detected price change
    start = add_months(date.today(), -12).isoformat()
    client.post(
        "/api/contracts",
        json={
            "name": "FitX",
            "provider": "FitX",
            "category": "fitness",
            "start_date": start,
            "initial_price": {"valid_from": start, "amount": 30},
        },
    )
    r = client.post("/api/import/bank", files={"file": ("umsaetze.csv", _bank_csv(), "text/csv")})
    assert r.status_code == 200, r.text
    res = r.json()
    by_name = {s["name"]: s for s in res["suggestions"]}
    fit = by_name["FitX Deutschland GmbH"]
    assert fit["status"] == "changed" and fit["match"]["current_monthly"] == 30
    tel = by_name["Telekom Deutschland GmbH"]
    assert tel["status"] == "new"
    applied = client.post(
        "/api/import/apply",
        json={
            "create": [
                {
                    "name": "Telekom",
                    "provider": tel["provider"],
                    "category": "mobile",
                    "amount": tel["amount"],
                    "interval": tel["interval"],
                    "start_date": tel["first_date"],
                    "price_changes": tel["price_changes"],
                }
            ],
            "price_updates": [
                {"contract_id": fit["match"]["contract_id"], "valid_from": fit["change_from"], "amount": 35}
            ],
        },
    ).json()
    assert applied == {"created": 1, "updated": 1}
    contracts = {c["name"]: c for c in client.get("/api/contracts").json()}
    assert contracts["Telekom"]["monthly_cost"] == 42.95
    assert contracts["FitX"]["monthly_cost"] == 35
    assert client.post("/api/import/bank", files={"file": ("x.csv", b"foo;bar\n1;2", "text/csv")}).status_code == 400


def test_contract_list_import_csv_and_xlsx(client):
    csv = importer.TEMPLATE.encode()
    rows = client.post("/api/import/contracts", files={"file": ("liste.csv", csv, "text/csv")}).json()["rows"]
    assert [(r["name"], r["category"], r["interval"], r["amount"]) for r in rows] == [
        ("MagentaMobil M", "mobile", "monthly", 42.95),
        ("Kfz-Versicherung", "car_insurance", "yearly", 534.0),
    ]
    assert rows[0]["min_term_months"] == 24 and rows[0]["notice_value"] == 1

    from io import BytesIO

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["Vertrag", "Anbieter", "Kosten", "Zahlweise", "Beginn"])
    ws.append(["Netflix", "Netflix", 13.99, "monatlich", date(2023, 5, 1)])
    buf = BytesIO()
    wb.save(buf)
    rows = client.post("/api/import/contracts", files={"file": ("liste.xlsx", buf.getvalue())}).json()["rows"]
    assert rows[0]["category"] == "streaming" and rows[0]["start_date"] == "2023-05-01"
    assert client.get("/api/import/template.csv").text.startswith("﻿Bezeichnung")
