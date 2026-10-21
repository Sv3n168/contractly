from datetime import date

from app import importer


def test_amount_and_date_parsing():
    assert importer.parse_amount("-1.234,56") == -1234.56
    assert importer.parse_amount("12,99 €") == 12.99
    assert importer.parse_amount("1,234.50") == 1234.50
    assert importer.parse_amount("19.99-") == -19.99
    assert importer.parse_date("03.02.26") == date(2026, 2, 3)
    assert importer.parse_date("2026-02-03") == date(2026, 2, 3)


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
    assert client.post("/api/import/apply", json={"create": rows}).json() == {"created": 1}
    assert client.get("/api/contracts").json()[0]["monthly_cost"] == 13.99
