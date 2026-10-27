"""Contracts paid from another account (e.g. a joint account) don't burden the own account."""

from datetime import date

import pytest

from app.calc import add_months, month_start


def _contract(client, name, amount, **extra):
    start = month_start(add_months(date.today(), -3))
    r = client.post(
        "/api/contracts",
        json={
            "name": name,
            "category": "other",
            "start_date": start.isoformat(),
            "initial_price": {"valid_from": start.isoformat(), "amount": amount},
            **extra,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_other_account_not_in_own_costs(client):
    _contract(client, "Handy", 40)
    joint = _contract(client, "Strom", 95, account="Gemeinschaftskonto")
    assert joint["account"] == "Gemeinschaftskonto"
    own = client.get("/api/stats/summary").json()
    assert own["monthly_total"] == pytest.approx(40)
    assert own["other_accounts"] == [{"name": "Gemeinschaftskonto", "monthly": 95}]
    # the contract stays visible everywhere else
    assert len(client.get("/api/contracts").json()) == 2
    assert client.get("/api/stats/summary", params={"account": "all"}).json()["monthly_total"] == pytest.approx(135)
    joint_only = client.get("/api/stats/summary", params={"account": "Gemeinschaftskonto"}).json()
    assert joint_only["monthly_total"] == pytest.approx(95)
    month = date.today().isoformat()[:7]
    ts = client.get("/api/stats/timeseries", params={"start": month, "end": month}).json()
    assert ts["totals"] == [pytest.approx(40)]
    assert client.get("/api/stats/projection", params={"months": 1}).json()["sum"] == pytest.approx(40)


def test_my_account_means_none(client):
    c = _contract(client, "Fitness", 30, account="  Mein Konto ")
    assert c["account"] is None
