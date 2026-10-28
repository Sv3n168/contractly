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
    # dismissed deadline is gone, the (neutrally labelled) own reminder is in the calendar
    cal = client.get("/api/calendar.ics").text
    assert "Eigene Erinnerung" in cal and "Kündigungsfrist" not in cal
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


def test_meta(client):
    meta = client.get("/api/meta").json()
    assert {c["key"] for c in meta["categories"]} >= {"mobile", "electricity", "fitness"}
    assert "smtp" in meta and "ocr" in meta


def _kinds(client):
    return {i["kind"]: i for i in client.get("/api/reminders/upcoming?horizon_days=400").json()["items"]}


def test_cost_share(client):
    c = _create(client, share_percent=50)  # partner pays half of 35 €
    assert c["monthly_cost"] == 17.5
    assert c["full_monthly_cost"] == 35
    assert client.get("/api/stats/summary").json()["monthly_total"] == 17.5


def test_pause_contract(client):
    start = add_months(date.today(), -6).replace(day=1)
    c = _create(
        client,
        min_term_months=12,
        start_date=start.isoformat(),
        initial_price={"valid_from": start.isoformat(), "amount": 30},
    )
    p_from = add_months(date.today(), -2).replace(day=1)
    p_until = add_months(p_from, 1) - timedelta(days=1)  # one month
    r = client.post(
        f"/api/contracts/{c['id']}/pause", json={"from_date": p_from.isoformat(), "until": p_until.isoformat()}
    )
    assert r.status_code == 200, r.text
    assert r.json()["min_term_months"] == 13  # term extended by the pause
    hist = client.get(f"/api/contracts/{c['id']}/history").json()
    by_month = dict(zip(hist["months"], hist["totals"], strict=False))
    assert by_month[f"{p_from:%Y-%m}"] == 0
    assert by_month[f"{add_months(p_from, 1):%Y-%m}"] == 30


def test_scenario_reminders(client):
    soon = date.today() + timedelta(days=5)
    c = _create(
        client,
        name="Neuer Vertrag",
        notice_value=3,
        withdrawal_until=soon.isoformat(),
        attributes={"price_guarantee_until": (date.today() + timedelta(days=20)).isoformat()},
    )
    kinds = _kinds(client)
    assert kinds["withdrawal"]["date"] == soon.isoformat()
    assert "price_guarantee" in kinds

    # price increase announced for next month -> special cancellation right
    nxt = add_months(date.today(), 1).replace(day=1)
    client.post(f"/api/contracts/{c['id']}/prices", json={"valid_from": nxt.isoformat(), "amount": 40})
    inc = _kinds(client)["price_increase"]
    assert "+5,00" in inc["title"] and inc["date"] == (nxt - timedelta(days=1)).isoformat()

    # cancellation sent 20 days ago without confirmation
    sent = date.today() - timedelta(days=20)
    client.post(f"/api/contracts/{c['id']}/cancel", json={"cancelled_on": sent.isoformat()})
    assert _kinds(client)["confirmation"]["due"] is True
    client.post(f"/api/contracts/{c['id']}/cancellation-confirmed", json={})
    assert "confirmation" not in _kinds(client)


def test_subscription_check(client):
    old = add_months(date.today(), -14)
    c = _create(
        client,
        name="Netflix",
        category="streaming",
        start_date=old.isoformat(),
        initial_price={"valid_from": old.isoformat(), "amount": 13.99},
    )
    assert _kinds(client)["subscription_check"]["contract_id"] == c["id"]
    client.post(f"/api/contracts/{c['id']}/still-used")
    assert "subscription_check" not in {i["kind"] for i in client.get("/api/reminders/upcoming").json()["items"]}


def test_subscription_check_of_old_subscription_is_not_years_overdue(client):
    """Never answered: the check refers to the latest anniversary, not the first one years ago."""
    _create(client, name="Spotify", category="streaming", start_date=add_months(date.today(), -41).isoformat())
    _create(client, name="Disney+", category="streaming", start_date=add_months(date.today(), -37).isoformat())
    items = client.get("/api/reminders/upcoming?horizon_days=400").json()["items"]
    due = {i["contract_name"]: date.fromisoformat(i["date"]) for i in items if i["kind"] == "subscription_check"}
    assert due["Spotify"] == add_months(date.today(), 7)  # missed 5 months ago -> next anniversary
    assert due["Disney+"] == add_months(date.today(), -1)  # 1 month ago -> still open


def test_yearly_report_and_tax_export(client):
    y = date.today().year - 1
    client.post(
        "/api/contracts",
        json={
            "name": "Haftpflicht",
            "category": "liability",
            "start_date": f"{y - 1}-01-01",
            "initial_price": {"valid_from": f"{y - 1}-01-01", "amount": 60, "interval": "yearly"},
        },
    )
    client.post(
        "/api/contracts",
        json={
            "name": "Netflix",
            "category": "streaming",
            "start_date": f"{y}-07-01",
            "initial_price": {"valid_from": f"{y}-07-01", "amount": 10},
        },
    )
    r = client.get(f"/api/stats/report?year={y}").json()
    assert r["total"] == 60 + 60 and r["complete"] is True
    assert r["tax_total"] == 60
    assert {c["name"]: c["tax_relevant"] for c in r["contracts"]} == {"Haftpflicht": True, "Netflix": False}
    csv = client.get(f"/api/stats/tax.csv?year={y}").text
    assert '"Haftpflicht"' in csv and "Netflix" not in csv and '"Summe";;;;;60,00;' in csv


def test_shared_contract_compare_and_switch(client):
    """Offers are compared with the full price; a switch keeps the cost share."""
    c = _create(
        client,
        name="Netflix",
        category="streaming",
        share_percent=50,
        initial_price={"valid_from": add_months(date.today(), -12).isoformat(), "amount": 60},
    )
    o = client.post(f"/api/contracts/{c['id']}/offers", json={"name": "Günstiger", "monthly_price": 45}).json()
    ev = client.get(f"/api/contracts/{c['id']}/offers/evaluate?horizon_months=12").json()
    assert ev["current_monthly"] == 60
    assert ev["results"][0]["savings_total"] == 180 and ev["results"][0]["verdict"] == "worth_it"
    switch_date = (date.today() + timedelta(days=1)).isoformat()
    new = client.post(f"/api/contracts/{c['id']}/offers/{o['id']}/switch", json={"switch_date": switch_date}).json()
    assert new["share_percent"] == 50


def test_report_average_for_future_year(client):
    _create(
        client,
        name="Strom",
        category="electricity",
        initial_price={"valid_from": add_months(date.today(), -12).isoformat(), "amount": 120},
    )
    r = client.get(f"/api/stats/report?year={date.today().year + 1}").json()
    assert r["monthly_average"] == pytest.approx(r["total"] / 12, abs=0.01)


def test_app_files_are_revalidated(anon_client):
    """After an update browsers and proxies (Cloudflare) must not keep serving the old app."""
    r = anon_client.get("/static/js/app.js")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"
    assert anon_client.get("/").headers["cache-control"] == "no-cache"


def test_undo_reminder_actions(client):
    r = client.post("/api/reminders", json={"title": "Zähler ablesen", "due_date": "2026-01-10"}).json()
    client.post(f"/api/reminders/{r['id']}/done")
    back = client.post(f"/api/reminders/{r['id']}/reopen", json={"due_date": "2026-01-10"}).json()
    assert back["done_at"] is None and back["due_date"] == "2026-01-10"
    client.post("/api/reminders/dismiss", params={"key": "deadline:1:2026-11-30"})
    assert client.post("/api/reminders/undismiss", params={"key": "deadline:1:2026-11-30"}).json() == {"ok": True}
