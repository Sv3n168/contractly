"""Contractly thinks along: missing data per contract and computed insights."""

from datetime import date

from app.calc import add_months, month_start


def _contract(client, months_ago, amount, category="other", interval="monthly", **extra):
    start = month_start(add_months(date.today(), -months_ago))
    r = client.post(
        "/api/contracts",
        json={
            "name": extra.pop("name", category),
            "category": category,
            "start_date": start.isoformat(),
            "initial_price": {"valid_from": start.isoformat(), "amount": amount, "interval": interval},
            **extra,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_gaps_name_what_a_contract_lacks(client):
    c = _contract(client, 3, 30, category="mobile")
    keys = [g["key"] for g in c["gaps"]]
    assert keys == ["address", "numbers", "notice", "document"]
    assert c["gaps"][0]["field"] == "provider_address"

    full = _contract(
        client, 3, 30, category="mobile", provider_address="Telekom\n53262 Bonn", customer_number="123", notice_value=1
    )
    assert [g["key"] for g in full["gaps"]] == ["document"]


def test_energy_gaps_and_streaming_needs_no_address(client):
    power = _contract(client, 3, 60, category="electricity")
    assert {"consumption", "unit_price"} <= {g["key"] for g in power["gaps"]}
    netflix = _contract(client, 3, 13.99, category="streaming")
    assert "address" not in {g["key"] for g in netflix["gaps"]}


def test_ignored_gap_stays_away_and_can_come_back(client):
    c = _contract(client, 3, 30, category="mobile")
    r = client.post(f"/api/contracts/{c['id']}/gaps/document/ignore")
    assert "document" not in {g["key"] for g in r.json()["gaps"]}
    # editing the contract keeps the choice
    detail = client.get(f"/api/contracts/{c['id']}").json()
    assert "document" not in {g["key"] for g in detail["gaps"]}
    r = client.delete(f"/api/contracts/{c['id']}/gaps/document/ignore")
    assert "document" in {g["key"] for g in r.json()["gaps"]}


def test_ended_contracts_have_no_gaps(client):
    c = _contract(client, 24, 30, category="mobile", end_date=add_months(date.today(), -2).isoformat())
    assert c["gaps"] == []
    assert all(i["contract_id"] != c["id"] for i in client.get("/api/insights").json()["incomplete"])


def test_insights_bundle_subscriptions_and_monthly_insurance(client):
    _contract(client, 3, 13.99, category="streaming", name="Netflix")
    _contract(client, 3, 10.99, category="streaming", name="Spotify")
    _contract(client, 3, 50, category="car_insurance", name="HUK Kfz")
    insights = client.get("/api/insights").json()["insights"]
    kinds = {i["kind"]: i for i in insights}
    assert "Netflix, Spotify kosten zusammen 24,98 €" in kinds["bundle"]["text"]
    assert "etwa 24,00 € im Jahr weniger" in kinds["yearly"]["text"]  # 4 % of 600 €
    # ranked by the money involved
    assert [i["weight"] for i in insights] == sorted((i["weight"] for i in insights), reverse=True)


def test_insight_trend_names_the_driver(client):
    _contract(client, 30, 40, category="mobile")
    _contract(client, 2, 100, category="education", name="Master")
    trend = next(i for i in client.get("/api/insights").json()["insights"] if i["kind"] == "trend")
    assert "um 100,00 € im Monat gestiegen (+250 %)" in trend["text"]
    assert "vor allem durch Bildung" in trend["text"]


def test_insight_old_tariff_suggests_comparing(client):
    c = _contract(client, 40, 45, category="internet", name="DSL")
    loyal = next(i for i in client.get("/api/insights").json()["insights"] if i["kind"] == "loyal")
    assert loyal["link"] == f"#/contracts/{c['id']}?tab=compare"
    assert loyal["title"] == "Seit 3 Jahren gleicher Tarif"


def test_dismissed_insight_disappears(client):
    _contract(client, 3, 50, category="car_insurance", name="HUK Kfz")
    key = client.get("/api/insights").json()["insights"][0]["key"]
    assert client.post("/api/insights/dismiss", json={"keys": [key]}).status_code == 204
    assert key not in {i["key"] for i in client.get("/api/insights").json()["insights"]}


def test_open_data_note_can_be_acknowledged_until_something_new_is_missing(client):
    _contract(client, 3, 30, category="mobile", name="Handy")
    entries = client.get("/api/insights").json()["incomplete"]
    keys = [g["ack"] for e in entries for g in e["gaps"]]
    assert client.post("/api/insights/dismiss", json={"keys": keys}).status_code == 204
    assert client.get("/api/insights").json()["incomplete"] == []
    # the contract itself still names its gaps
    cid = entries[0]["contract_id"]
    assert client.get(f"/api/contracts/{cid}").json()["gaps"]
    # a new contract with open data brings the note back – only with the new one
    new = _contract(client, 1, 20, category="internet", name="DSL")
    assert [e["contract_id"] for e in client.get("/api/insights").json()["incomplete"]] == [new["id"]]
    # undo
    client.post("/api/insights/restore", json={"keys": keys})
    assert len(client.get("/api/insights").json()["incomplete"]) == 2
