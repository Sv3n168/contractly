"""The yearly check: which contracts need a decision, decisions, summary and the yearly reminder."""

from datetime import date, timedelta

from app.calc import add_months


def _create(client, **kw):
    start = kw.pop("start", add_months(date.today(), -12))
    payload = {
        "name": "Vertrag",
        "category": "other",
        "start_date": start.isoformat(),
        "initial_price": {"valid_from": start.isoformat(), "amount": 20},
    } | kw
    r = client.post("/api/contracts", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _codes(overview, contract_id):
    item = next((i for i in overview["items"] if i["contract_id"] == contract_id), None)
    return {r["code"] for r in item["reasons"]} if item else set()


def test_reasons(client):
    today = date.today()
    # introductory price ended four months ago
    promo_start = add_months(today, -10)
    dsl = _create(
        client,
        name="DSL 100",
        category="internet",
        start=promo_start,
        min_term_months=24,
        initial_price={"valid_from": promo_start.isoformat(), "amount": 19.99, "note": "Aktionspreis"},
    )
    client.post(
        f"/api/contracts/{dsl['id']}/prices", json={"valid_from": add_months(today, -4).isoformat(), "amount": 39.99}
    )
    # three years with the same insurer, never compared
    old = _create(client, name="Haftpflicht", category="liability", start=add_months(today, -37), min_term_months=12)
    # a gym nobody asked about for a year
    gym = _create(client, name="FitX", category="fitness", start=add_months(today, -14), min_term_months=12)
    # nothing to do: a new streaming subscription
    fresh = _create(client, name="Disney+", category="streaming", start=add_months(today, -2))

    ov = client.get("/api/checkup").json()
    assert _codes(ov, dsl["id"]) == {"promo_ended"}
    assert "not_compared" in _codes(ov, old["id"])
    assert "unused" in _codes(ov, gym["id"])
    assert _codes(ov, fresh["id"]) == set()
    assert ov["running"] == 4 and ov["summary"]["open"] == len(ov["items"])
    text = next(r["text"] for i in ov["items"] if i["contract_id"] == dsl["id"] for r in i["reasons"])
    assert "Aktionspreis ist ausgelaufen" in text and "20,00 €" in text


def test_decisions_summary_and_reminder(client):
    today = date.today()
    gym = _create(
        client,
        name="FitX",
        category="fitness",
        start=add_months(today, -14),
        initial_price={"valid_from": add_months(today, -14).isoformat(), "amount": 35},
    )
    tv = _create(
        client,
        name="Sky",
        category="streaming",
        start=add_months(today, -13),
        initial_price={"valid_from": add_months(today, -13).isoformat(), "amount": 25},
    )
    kinds = {i["kind"] for i in client.get("/api/reminders/upcoming?horizon_days=30").json()["items"]}
    assert "subscription_check" in kinds

    client.post(f"/api/checkup/{gym['id']}", json={"decision": "ok"})
    ov = client.post(f"/api/checkup/{tv['id']}", json={"decision": "cancel"}).json()
    s = ov["summary"]
    assert (s["reviewed"], s["ok"], s["cancel"], s["cancel_savings_year"]) == (2, 1, 1, 300)
    # decided contracts stay in the list (with their answer) until the year is over
    assert {i["decision"] for i in ov["items"]} == {"ok", "cancel"}
    # "keep" answers the subscription check, too
    kinds = {i["kind"] for i in client.get("/api/reminders/upcoming?horizon_days=30").json()["items"]}
    assert "subscription_check" not in kinds
    assert client.post(f"/api/checkup/{gym['id']}", json={"decision": "later"}).status_code == 422

    ov = client.post("/api/checkup/complete").json()
    assert ov["completed_on"] == today.isoformat()
    items = client.get("/api/reminders/upcoming?horizon_days=500").json()["items"]
    check = next(i for i in items if i["kind"] == "checkup")
    assert check["date"] == f"{today.year + 1}-01-15" and check["contract_id"] is None


def test_first_check_waits_for_next_january(client):
    """Someone starting today isn't asked for a yearly check right away."""
    _create(client, name="Handy", category="mobile", start=date.today() - timedelta(days=800))
    items = client.get("/api/reminders/upcoming?horizon_days=60").json()["items"]
    assert not [i for i in items if i["kind"] == "checkup" and i["date"] < f"{date.today().year + 1}-01-01"]
