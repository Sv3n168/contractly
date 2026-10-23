"""Start over: all contracts and attached data go, account and profile stay."""

from app.config import settings


def _stored_files():
    return [p for p in settings.data_dir.rglob("documents/*") if p.is_file()]


def test_reset_removes_data_keeps_profile(client):
    client.put("/api/profile", json={"name": "Max Muster", "street": "Weg 1"})
    assert client.post("/api/demo").status_code == 200
    contract = client.get("/api/contracts").json()[0]
    files = {"file": ("vertrag.pdf", b"%PDF-1.4 test", "application/pdf")}
    doc = client.post(f"/api/contracts/{contract['id']}/documents", files=files)
    assert doc.status_code == 201, doc.text
    assert _stored_files()
    client.put("/api/emergency/note", json={"note": "Schlüssel liegt bei Anna"})

    # without the confirmation word nothing happens
    assert client.post("/api/data/reset", json={"confirm": "ja"}).status_code == 400
    assert client.get("/api/contracts").json()

    r = client.post("/api/data/reset", json={"confirm": "löschen"})
    assert r.status_code == 200, r.text
    assert r.json()["contracts"] >= 9 and r.json()["income_sources"] == 2 and r.json()["documents"] == 1
    assert client.get("/api/contracts").json() == []
    assert client.get("/api/income").json()["sources"] == []
    assert client.get("/api/reminders").json() == []
    assert not _stored_files()
    assert client.get("/api/emergency").json()["note"] == ""
    # profile and login stay; the demo can be loaded again into the now empty area
    assert client.get("/api/profile").json()["name"] == "Max Muster"
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/demo").status_code == 200
