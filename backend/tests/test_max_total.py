"""Agreed total of a contract: progress, the odd last payment and a warning when more was paid."""

from datetime import date

from app.calc import add_months, month_start


def _master(client, months_ago, **extra):
    start = month_start(add_months(date.today(), -months_ago))
    r = client.post(
        "/api/contracts",
        json={
            "name": "Master",
            "category": "other",
            "start_date": start.isoformat(),
            "initial_price": {"valid_from": start.isoformat(), "amount": 1105, "interval": "monthly"},
            "max_total": 19900,
            **extra,
        },
    )
    assert r.status_code == 201, r.text
    return start, r.json()


def test_last_payment_makes_the_total_exact(client):
    start, c = _master(client, 13)  # 14 payments of 1,105 € so far
    detail = client.get(f"/api/contracts/{c['id']}").json()
    assert detail["max_total"] == 19900
    b = detail["budget"]
    assert b["paid"] == 14 * 1105 == detail["total_paid"]
    assert b["left"] == 19900 - 14 * 1105
    assert b["regular_left"] == 4 and b["regular_amount"] == 1105
    assert b["last_amount"] == 10  # 18 × 1,105 € = 19,890 €, so the 19th payment is 10 €
    assert b["last_date"] == add_months(start, 18).isoformat()
    assert not b["exceeded"]


def test_end_date_past_the_total_warns(client):
    start, c = _master(client, 1, end_date=add_months(start_of(1), 24).isoformat())
    b = client.get(f"/api/contracts/{c['id']}").json()["budget"]
    # 19 payments needed (the last one 10 €); the rest up to the end would be too much
    assert b["projected_over"] == round(25 * 1105 - 19900, 2)


def start_of(months_ago):
    return month_start(add_months(date.today(), -months_ago))


def test_paying_more_than_the_total_is_flagged(client):
    _, c = _master(client, 19)  # 20 × 1,105 € = 22,100 €
    b = client.get(f"/api/contracts/{c['id']}").json()["budget"]
    assert b["exceeded"] and b["over"] == 20 * 1105 - 19900
    items = client.get("/api/reminders/upcoming").json()["items"]
    warn = [i for i in items if i["kind"] == "total_exceeded"]
    assert warn and warn[0]["due"] and "überschritten" in warn[0]["title"]


def test_reminder_names_the_last_amount(client):
    start, c = _master(client, 16)  # 17 paid, 18th regular next month, then 10 €
    items = client.get("/api/reminders/upcoming", params={"horizon_days": 90}).json()["items"]
    last = next(i for i in items if i["kind"] == "total_reached")
    assert last["date"] == add_months(start, 18).isoformat()
    assert "10,00 €" in last["title"] and "statt 1.105,00 €" in last["detail"]


def test_no_total_no_budget(client):
    r = client.post(
        "/api/contracts",
        json={
            "name": "Handy",
            "category": "mobile",
            "start_date": "2025-01-01",
            "initial_price": {"valid_from": "2025-01-01", "amount": 20, "interval": "monthly"},
        },
    )
    assert client.get(f"/api/contracts/{r.json()['id']}").json()["budget"] is None
