from datetime import date, timedelta

import pytest

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


def test_extra_charges(client):
    c = _create(client, name="Handy", category="mobile")
    month = add_months(date.today(), -1).replace(day=15)
    r = client.post(
        f"/api/contracts/{c['id']}/prices",
        json={
            "valid_from": month.isoformat(),
            "amount": 12.5,
            "interval": "once",
            "note": "Roaming",
            "details": {"kind": "extra"},
        },
    )
    assert r.status_code == 201
    detail = client.get(f"/api/contracts/{c['id']}").json()
    assert detail["monthly_cost"] == 35  # base price unchanged
    assert detail["extras_12m"] == 12.5
    assert detail["extras_months_12m"] == 1
    hist = client.get(f"/api/contracts/{c['id']}/history").json()
    idx = hist["months"].index(f"{month.year:04d}-{month.month:02d}")
    assert hist["totals"][idx] == 47.5
    assert hist["extras"][idx] == 12.5
    assert hist["totals"][idx + 1] == 35
    with_extras = client.get("/api/stats/projection?months=12&include_extras=true").json()
    without = client.get("/api/stats/projection?months=12").json()
    # 12.5 € spread as Ø per month over 12 months (rounded per month)
    assert with_extras["sum"] - without["sum"] == pytest.approx(12.5, abs=0.1)
    assert client.get("/api/stats/summary").json()["extras_12m"] == 12.5


def test_switch_with_bonus_and_promo(client):
    c = _create(client, name="Handy", category="mobile")
    o = client.post(
        f"/api/contracts/{c['id']}/offers",
        json={
            "name": "Aktion",
            "provider": "X",
            "monthly_price": 30,
            "promo_price": 15,
            "promo_months": 3,
            "bonuses": [{"type": "switch", "amount": 50, "paid_after_months": 2}],
        },
    ).json()
    assert o["bonuses"][0]["amount"] == 50
    ev = client.get(f"/api/contracts/{c['id']}/offers/evaluate?horizon_months=12").json()["results"][0]
    assert ev["offer_total"] == 3 * 15 + 9 * 30 - 50
    ev_nb = client.get(f"/api/contracts/{c['id']}/offers/evaluate?horizon_months=12&include_bonus=false").json()
    assert ev_nb["results"][0]["offer_total"] == 3 * 15 + 9 * 30

    switch = date.today() + timedelta(days=5)
    new = client.post(
        f"/api/contracts/{c['id']}/offers/{o['id']}/switch", json={"switch_date": switch.isoformat()}
    ).json()
    prices = sorted(new["prices"], key=lambda p: (p["valid_from"], p["amount"]))
    assert [(p["amount"], p["interval"]) for p in prices] == [(15, "monthly"), (-50, "once"), (30, "monthly")]
    assert prices[1]["valid_from"] == add_months(switch, 2).isoformat()
    assert prices[2]["valid_from"] == add_months(switch, 3).isoformat()
    titles = [r["title"] for r in new["reminders"]]
    assert any("Wechselbonus" in t for t in titles)
    assert any("Aktionspreis" in t for t in titles)
