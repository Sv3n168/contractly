from datetime import date, timedelta

from app.calc import add_months


def _create(client, **kw):
    payload = {
        "name": "Fitnessstudio",
        "category": "fitness",
        "start_date": add_months(date.today(), -12).isoformat(),
        "initial_price": {"valid_from": add_months(date.today(), -12).isoformat(), "amount": 35},
    }
    payload.update(kw)
    r = client.post("/api/contracts", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_crud_and_summary(client):
    c = _create(client)
    assert c["monthly_cost"] == 35
    assert c["state"] == "active"
    r = client.post(f"/api/contracts/{c['id']}/prices", json={"valid_from": date.today().isoformat(), "amount": 40})
    assert r.status_code == 201
    assert client.get(f"/api/contracts/{c['id']}").json()["monthly_cost"] == 40
    s = client.get("/api/stats/summary").json()
    assert s["monthly_total"] == 40
    assert s["yearly_total"] == 480
    assert client.delete(f"/api/contracts/{c['id']}").status_code == 204
    assert client.get("/api/contracts").json() == []


def test_successor_continues_history(client):
    """Fitness studio (35 €) replaced by Sportnavi (45 €): one continuous series."""
    gym = _create(client)
    switch = add_months(date.today(), -3).replace(day=1)
    nav = _create(
        client,
        name="Sportnavi",
        start_date=switch.isoformat(),
        predecessor_id=gym["id"],
        initial_price={"valid_from": switch.isoformat(), "amount": 45},
    )
    gym_after = client.get(f"/api/contracts/{gym['id']}").json()
    assert gym_after["end_date"] == (switch - timedelta(days=1)).isoformat()
    assert gym_after["state"] == "ended"

    hist = client.get(f"/api/contracts/{nav['id']}/history").json()
    assert [s["name"] for s in hist["series"]] == ["Fitnessstudio", "Sportnavi"]
    idx = hist["months"].index(f"{switch.year:04d}-{switch.month:02d}")
    assert hist["totals"][idx - 1] == 35
    assert hist["totals"][idx] == 45
    detail = client.get(f"/api/contracts/{nav['id']}").json()
    assert detail["switch_savings"] < 0  # Sportnavi is more expensive


def test_offer_compare_and_switch(client):
    c = _create(client, name="Handy", category="mobile", attributes={"data_volume_gb": 40})
    o = client.post(
        f"/api/contracts/{c['id']}/offers",
        json={"name": "Neu 50GB", "provider": "X", "monthly_price": 20, "attributes": {"data_volume_gb": 50}},
    ).json()
    ev = client.get(f"/api/contracts/{c['id']}/offers/evaluate?horizon_months=12").json()
    assert ev["results"][0]["savings_total"] == 180
    assert ev["results"][0]["verdict"] == "worth_it"
    switch_date = (date.today() + timedelta(days=10)).isoformat()
    new = client.post(f"/api/contracts/{c['id']}/offers/{o['id']}/switch", json={"switch_date": switch_date}).json()
    assert new["predecessor_id"] == c["id"]
    assert new["attributes"]["data_volume_gb"] == 50
    old = client.get(f"/api/contracts/{c['id']}").json()
    assert old["state"] == "cancelled"
    assert old["successor_ids"] == [new["id"]]


def test_cancel_uses_next_term_end(client):
    c = _create(client, min_term_months=24, renewal_months=1, notice_value=1)
    r = client.post(f"/api/contracts/{c['id']}/cancel", json={}).json()
    assert r["end_date"] == c["next_term_end"]
    assert r["state"] == "cancelled"
    assert client.post(f"/api/contracts/{c['id']}/reactivate").json()["end_date"] is None


def test_reminders(client):
    c = _create(client, min_term_months=24, renewal_months=1, notice_value=1, reminder_days=365)
    due = (date.today() + timedelta(days=3)).isoformat()
    r = client.post(
        "/api/reminders", json={"title": "Zähler ablesen", "due_date": due, "repeat": "yearly", "lead_days": 5}
    ).json()
    up = client.get("/api/reminders/upcoming").json()
    kinds = {i["kind"] for i in up["items"]}
    assert {"custom", "deadline"} <= kinds
    assert up["due_count"] >= 1
    done = client.post(f"/api/reminders/{r['id']}/done").json()
    assert done["due_date"] == add_months(date.fromisoformat(due), 12).isoformat()
    deadline = next(i for i in up["items"] if i["kind"] == "deadline")
    client.post("/api/reminders/dismiss", params={"key": deadline["key"]})
    keys = [i["key"] for i in client.get("/api/reminders/upcoming").json()["items"]]
    assert deadline["key"] not in keys
    assert "Kündigungsfrist" in client.get("/api/calendar.ics").text
    assert c["id"]


def test_documents_upload_and_analyze(client):
    c = _create(client)
    files = {"file": ("vertrag.txt", b"Kundennummer: 123456789\nVertragsnummer: V-2024-77881\n", "text/plain")}
    doc = client.post(f"/api/contracts/{c['id']}/documents", files=files).json()
    assert client.get(f"/api/documents/{doc['id']}").content.startswith(b"Kundennummer")
    ex = client.post(f"/api/documents/{doc['id']}/extract").json()
    found = {s["key"]: s["value"] for s in ex["suggestions"]}
    assert found["customer_number"] == "123456789"
    assert found["contract_number"] == "V-2024-77881"

    pre = client.post("/api/documents/analyze", files=files).json()
    new = _create(client, name="Mit Dokument", document_ids=[pre["document_id"]])
    assert new["document_count"] == 1


def test_demo_and_projection(client):
    assert client.post("/api/demo").json()["created"] >= 5
    assert client.post("/api/demo").status_code == 400
    p = client.get("/api/stats/projection?months=24&increase_pct=5").json()
    assert len(p["months"]) == 24
    assert p["sum"] > p["sum_without_increase"]
    ts = client.get("/api/stats/timeseries?group=contract").json()
    assert ts["series"] and len(ts["totals"]) == len(ts["months"])
    assert client.get("/api/export").status_code == 200


def test_profile(client):
    assert client.put("/api/profile", json={"name": "Max Mustermann", "zip_city": "12345 Berlin"}).status_code == 200
    assert client.get("/api/profile").json()["name"] == "Max Mustermann"
