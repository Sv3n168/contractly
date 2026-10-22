"""Emergency folder: content, personal note and the encrypted, self-contained export."""

import json
import re
from datetime import date

from app import emergency

PDF = b"%PDF-1.4\n% Police KFZ-778\n"


def _setup(client):
    client.put("/api/profile", json={"name": "Sven Muster", "street": "Weg 1", "zip_city": "12345 Ort"})
    c = client.post(
        "/api/contracts",
        json={
            "name": "Kfz-Versicherung Golf",
            "category": "car_insurance",
            "provider": "HUK-COBURG",
            "provider_address": "HUK-COBURG\nBahnhofsplatz\n96444 Coburg",
            "contract_number": "KFZ-778",
            "start_date": "2024-01-01",
            "min_term_months": 12,
            "renewal_months": 12,
            "notice_value": 1,
            "attributes": {"license_plate": "CO-AB 123"},
            "initial_price": {"valid_from": "2024-01-01", "amount": 534, "interval": "yearly"},
        },
    ).json()
    client.post(f"/api/contracts/{c['id']}/documents", files={"file": ("police.pdf", PDF, "application/pdf")})
    client.post(
        "/api/contracts",
        json={"name": "Alt", "category": "other", "start_date": "2020-01-01", "end_date": "2021-01-01"},
    )
    return c


def test_folder_content_and_note(client):
    c = _setup(client)
    folder = client.get("/api/emergency").json()
    assert [x["name"] for x in folder["contracts"]] == ["Kfz-Versicherung Golf"]  # ended contracts are left out
    item = folder["contracts"][0]
    assert item["contract_number"] == "KFZ-778" and item["notice"] == "1 Monat"
    assert {"label": "Kennzeichen", "value": "CO-AB 123"} in item["details"]
    assert "Schadenfreiheitsrabatt" in item["death_hint"]
    assert "Vertragsinhaber/in: Sven Muster" in item["letter"] and "Vertragsnummer: KFZ-778" in item["letter"]
    assert item["documents"][0]["name"] == "police.pdf"
    assert folder["monthly_total"] == 44.5 and folder["checklist"]

    assert (
        client.put("/api/emergency/note", json={"note": "Passwörter: grüner Ordner im Arbeitszimmer"}).status_code
        == 200
    )
    assert client.get("/api/emergency").json()["note"].startswith("Passwörter")
    assert c["id"] == item["id"]


def test_encrypted_export(client):
    _setup(client)
    assert client.post("/api/emergency/export", json={"passphrase": "kurz"}).status_code == 422
    r = client.post("/api/emergency/export", json={"passphrase": "Familie-Notfall-2026"})
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith('attachment; filename="notfall-mappe-')
    html = r.text
    # nothing readable without the passphrase
    assert "KFZ-778" not in html and "Sven Muster" not in html and "HUK" not in html
    blob = json.loads(re.search(r"const PAYLOAD = (\{.*?\});", html).group(1))
    data = emergency.decrypt(blob, "Familie-Notfall-2026")
    assert data["folder"]["contracts"][0]["contract_number"] == "KFZ-778"
    doc = next(iter(data["documents"].values()))
    assert doc["name"] == "police.pdf" and doc["data"]

    without = client.post(
        "/api/emergency/export", json={"passphrase": "Familie-Notfall-2026", "include_documents": False}
    )
    blob = json.loads(re.search(r"const PAYLOAD = (\{.*?\});", without.text).group(1))
    assert emergency.decrypt(blob, "Familie-Notfall-2026")["documents"] == {}


def test_wrong_passphrase_fails():
    blob = emergency.encrypt({"x": 1}, "richtiges-passwort")
    try:
        emergency.decrypt(blob, "falsches-passwort")
    except Exception:  # noqa: BLE001 - cryptography raises InvalidTag
        pass
    else:
        raise AssertionError("decrypted with the wrong passphrase")
    assert emergency.viewer_html(blob, date(2026, 10, 22)).count("__") == 0
