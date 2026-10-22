"""Income: salary history (net, optional gross), raises, bonuses, other income, fixed-cost ratio."""

from datetime import date

import pytest

from app.calc import add_months, month_start


def _salary(client, start, net=3000, gross=4500):
    r = client.post(
        "/api/income/sources",
        json={
            "name": "Gehalt",
            "kind": "salary",
            "payer": "Musterwerk GmbH",
            "start_date": start.isoformat(),
            "first": {"valid_from": start.isoformat(), "net": net, "gross": gross},
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_salary_history_raise_and_bonus(client):
    start = month_start(add_months(date.today(), -24))
    s = _salary(client, start)
    raise_day = month_start(add_months(date.today(), -6))
    s = client.post(
        f"/api/income/sources/{s['id']}/entries",
        json={"valid_from": raise_day.isoformat(), "net": 3150, "gross": 4800, "note": "Gehaltserhöhung"},
    ).json()
    assert s["current_net"] == 3150 and s["current_gross"] == 4800
    assert s["raises"][0]["pct_net"] == pytest.approx(5.0) and s["raises"][0]["pct_gross"] == pytest.approx(6.7)
    bonus_day = month_start(add_months(date.today(), -2))
    client.post(
        f"/api/income/sources/{s['id']}/entries",
        json={"valid_from": bonus_day.isoformat(), "net": 1200, "gross": 2200, "interval": "once", "note": "Bonus"},
    )
    ov = client.get("/api/income").json()
    assert ov["monthly_net"] == 3150 and ov["monthly_gross"] == 4800
    assert ov["bonus_12m"] == 1200
    # the last 12 months include this one: 5 months before the raise, 7 after
    assert ov["net_12m"] == pytest.approx(5 * 3000 + 7 * 3150 + 1200, abs=1)
    i = ov["months"].index(bonus_day.isoformat()[:7])
    assert ov["one_off"][i] == 1200 and ov["regular"][i] == 3150
    years = {y["year"]: y for y in ov["years"]}
    assert years[start.year]["net"] > 0 and years[date.today().year]["complete"] is False


def test_net_only_and_other_income(client):
    start = month_start(add_months(date.today(), -3))
    r = client.post(
        "/api/income/sources",
        json={
            "name": "Kindergeld",
            "kind": "child_benefit",
            "start_date": start.isoformat(),
            "first": {"valid_from": start.isoformat(), "net": 255},
        },
    ).json()
    assert r["current_gross"] is None and r["icon"] == "👶"
    ov = client.get("/api/income").json()
    assert ov["monthly_net"] == 255 and ov["monthly_gross"] is None


def test_fixed_cost_ratio_on_dashboard(client):
    start = month_start(add_months(date.today(), -14))
    _salary(client, start, net=2000, gross=None)
    client.post(
        "/api/contracts",
        json={
            "name": "Miete-Versicherung",
            "category": "household",
            "start_date": start.isoformat(),
            "initial_price": {"valid_from": start.isoformat(), "amount": 500},
        },
    )
    summary = client.get("/api/stats/summary").json()
    assert summary["income_monthly_net"] == 2000
    assert summary["fixed_cost_ratio"] == pytest.approx(0.25) and summary["free_monthly"] == pytest.approx(1500)


def test_validation_and_delete(client):
    s = _salary(client, date(2025, 1, 1))
    bad = client.post(
        "/api/income/sources",
        json={
            "name": "X",
            "kind": "lotto",
            "start_date": "2025-01-01",
            "first": {"valid_from": "2025-01-01", "net": 1},
        },
    )
    assert bad.status_code == 422
    only = s["entries"][0]["id"]
    assert client.delete(f"/api/income/sources/{s['id']}/entries/{only}").status_code == 400
    assert client.delete(f"/api/income/sources/{s['id']}").status_code == 204
    assert client.get("/api/income").json()["sources"] == []


def test_demo_income(client):
    client.post("/api/demo")
    ov = client.get("/api/income").json()
    assert {s["name"] for s in ov["sources"]} == {"Gehalt", "Kindergeld"}
    assert len(ov["raises"]) == 2 and ov["fixed_cost_ratio"] < 0.5
