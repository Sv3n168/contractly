"""Filters of the cost analysis: payment interval, category and 'when paid'."""

from datetime import date

import pytest


def _contract(client, name, category, amount, interval, start, **extra):
    r = client.post(
        "/api/contracts",
        json={
            "name": name,
            "category": category,
            "start_date": start,
            "initial_price": {"valid_from": start, "amount": amount, "interval": interval},
            **extra,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_yearly_only_spread_and_when_paid(client):
    year = date.today().year - 1
    _contract(client, "Handy", "mobile", 30, "monthly", f"{year}-01-01")
    _contract(client, "Haftpflicht", "liability", 120, "yearly", f"{year}-03-10")
    _contract(client, "Kfz", "car_insurance", 300, "half_yearly", f"{year}-01-01")
    params = {"start": f"{year}-01", "end": f"{year}-12", "group": "contract"}

    yearly = client.get("/api/stats/timeseries", params={**params, "intervals": "yearly"}).json()
    assert [s["label"] for s in yearly["series"]] == ["Haftpflicht"]
    # spread: 10 € a month from March (the first month only partly)
    assert yearly["totals"][5] == pytest.approx(10)

    paid = client.get(
        "/api/stats/timeseries", params={**params, "intervals": "yearly,half_yearly", "mode": "paid"}
    ).json()
    totals = dict(zip(paid["months"], paid["totals"], strict=True))
    assert totals[f"{year}-03"] == pytest.approx(120)  # the yearly bill in its month
    assert totals[f"{year}-01"] == pytest.approx(300) and totals[f"{year}-07"] == pytest.approx(300)
    assert totals[f"{year}-02"] == 0
    assert sum(totals.values()) == pytest.approx(720)

    cats = client.get("/api/stats/timeseries", params={**params, "categories": "mobile"}).json()
    assert [s["label"] for s in cats["series"]] == ["Handy"]


def test_when_paid_with_partner_amount(client):
    year = date.today().year - 1
    _contract(client, "Zeitung", "streaming", 150, "yearly", f"{year}-01-01", partner_amount=5)
    paid = client.get(
        "/api/stats/timeseries",
        params={"start": f"{year}-01", "end": f"{year}-12", "mode": "paid"},
    ).json()
    # the partner pays 5 € a month = 60 € of the yearly 150 €
    assert paid["totals"][0] == pytest.approx(90) and sum(paid["totals"]) == pytest.approx(90)


def test_projection_takes_the_filters(client):
    year = date.today().year
    _contract(client, "Handy", "mobile", 30, "monthly", f"{year - 1}-01-01")
    _contract(client, "Haftpflicht", "liability", 120, "yearly", f"{year - 1}-03-10")
    p = client.get("/api/stats/projection", params={"months": 12, "intervals": "yearly", "mode": "paid"}).json()
    assert p["sum"] == pytest.approx(120)


def test_bookings_so_far(client):
    from app.calc import add_months, month_start

    start = month_start(add_months(date.today(), -23))  # e.g. 01.11.2024 when today is in October 2026
    c = _contract(client, "Kredit", "other", 454, "monthly", start.isoformat())
    detail = client.get(f"/api/contracts/{c['id']}").json()
    assert detail["payments"]["count"] == 24
    assert detail["payments"]["first"] == start.isoformat()
    assert detail["payments"]["next"] == add_months(start, 24).isoformat()
    assert detail["total_paid"] == 24 * 454  # what left the account, not the costs spread by days
