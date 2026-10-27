"""A partner pays a fixed amount instead of a percentage."""

from datetime import date

import pytest

from app.calc import add_months, month_start


def _electricity(client, **share):
    start = month_start(add_months(date.today(), -3))
    r = client.post(
        "/api/contracts",
        json={
            "name": "Ökostrom",
            "category": "electricity",
            "start_date": start.isoformat(),
            "initial_price": {"valid_from": start.isoformat(), "amount": 95},
            **share,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_partner_pays_fixed_amount(client):
    c = _electricity(client, partner_amount=20)
    assert c["partner_amount"] == 20 and c["share_percent"] is None
    assert c["monthly_cost"] == pytest.approx(75) and c["full_monthly_cost"] == pytest.approx(95)
    # the amount stays fixed when the price goes up
    client.post(
        f"/api/contracts/{c['id']}/prices",
        json={"valid_from": month_start(date.today()).isoformat(), "amount": 105},
    )
    c = client.get(f"/api/contracts/{c['id']}").json()
    assert c["monthly_cost"] == pytest.approx(85)
    # costs per month follow, also in the summary
    assert client.get("/api/stats/summary").json()["monthly_total"] == pytest.approx(85)
    month = date.today().isoformat()[:7]
    ts = client.get("/api/stats/timeseries", params={"start": month, "end": month, "group": "contract"}).json()
    assert ts["series"][0]["values"][0] == pytest.approx(85)


def test_partner_amount_replaces_percentage_and_never_goes_negative(client):
    c = _electricity(client, share_percent=50, partner_amount=120)
    assert c["share_percent"] is None
    assert c["monthly_cost"] == 0
    # back to a percentage: an empty amount clears it
    body = {k: v for k, v in c.items() if k != "id"}
    r = client.put(f"/api/contracts/{c['id']}", json={**body, "partner_amount": 0, "share_percent": 50})
    assert r.status_code == 200, r.text
    assert r.json()["partner_amount"] is None and r.json()["monthly_cost"] == pytest.approx(47.5)
