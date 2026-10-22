"""Loans: amortisation, special repayments, costs ending at payoff, refinancing, reminders."""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app import calc, loans
from app.calc import add_months


def _loan(start=date(2025, 1, 1), payment=351.57, **attrs):
    attrs = {"principal": 15000, "interest_rate": 5.9} | attrs
    price = SimpleNamespace(valid_from=start, amount=payment, interval="monthly", details={}, note=None)
    return SimpleNamespace(
        category="loan", start_date=start, end_date=None, attributes=attrs, prices=[price], share_percent=None
    )


def test_annuity_schedule():
    rows = loans.schedule(_loan())
    assert len(rows) == 48 and rows[-1].balance == 0
    assert sum(r.interest for r in rows) == pytest.approx(351.57 * 48 - 15000, abs=2)
    first = rows[0]
    assert first.interest == pytest.approx(15000 * 0.059 / 12, abs=0.01)
    assert first.principal == pytest.approx(351.57 - first.interest, abs=0.01)


def test_special_repayment_shortens_term_and_saves_interest():
    plain = loans.schedule(_loan())
    extra = loans.schedule(_loan(special_repayments=[{"date": "2025-12-15", "amount": 3000}]))
    assert len(extra) < len(plain)
    assert sum(r.interest for r in extra) < sum(r.interest for r in plain) - 150


def test_special_repayment_counts_immediately():
    today = date(2025, 6, 15)
    before = loans.analysis(_loan(), today)["balance"]
    after = loans.analysis(_loan(special_repayments=[{"date": "2025-06-15", "amount": 1000}]), today)["balance"]
    assert after == pytest.approx(before - 1000)


def test_balance_from_bank_statement_and_rate_change():
    c = _loan(balance=10_000, balance_date="2026-01-01")
    a = loans.analysis(c, date(2026, 1, 15))
    assert a["anchored"] and a["balance"] == 10_000 and a["start_balance"] == 10_000
    # follow-up financing: from 2027 a new rate with another interest rate
    c.prices.append(
        SimpleNamespace(
            valid_from=date(2027, 1, 1), amount=300, interval="monthly", details={"interest_rate": 3.0}, note=None
        )
    )
    rows = loans.schedule(c)
    later = next(r for r in rows if r.day >= date(2027, 2, 1))
    assert later.payment == 300


def test_missing_data_and_payment_too_low():
    assert loans.analysis(_loan(principal=None), date.today())["missing"] == ["Kreditbetrag"]
    low = loans.analysis(_loan(payment=50), date.today())
    assert low["payment_too_low"] and low["monthly_interest"] == pytest.approx(73.75)


def test_costs_stop_when_repaid():
    c = _loan(start=date(2020, 1, 1))
    costs = calc.monthly_costs(c, date(2023, 11, 1), date(2024, 3, 31))
    assert costs["2023-11"] > 0 and costs["2024-02"] == 0 and costs["2024-03"] == 0


def test_refinancing_compare():
    c = _loan(start=add_months(date.today(), -12))
    result = loans.compare(c, date.today(), new_rate=3.5, fees=100)
    assert result["worth_it"] and result["months_saved"] >= 1
    assert result["saving"] == pytest.approx(result["interest_current"] - result["interest_new"] - 100)
    with pytest.raises(ValueError):
        loans.compare(c, date.today(), new_rate=3.5, new_payment=10)


def _create(client, **attrs):
    start = add_months(date.today(), -12).isoformat()
    r = client.post(
        "/api/contracts",
        json={
            "name": "Autokredit",
            "category": "loan",
            "start_date": start,
            "notice_value": 0,
            "notice_unit": "days",
            "attributes": {"principal": 15000, "interest_rate": 5.9} | attrs,
            "initial_price": {"valid_from": start, "amount": 351.57},
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_api_detail_repayments_and_compare(client):
    c = _create(client)
    detail = client.get(f"/api/contracts/{c['id']}").json()
    assert detail["loan"]["balance"] < 15000 and detail["loan"]["payoff_date"]
    r = client.post(
        f"/api/contracts/{c['id']}/loan/repayments", json={"on": date.today().isoformat(), "amount": 2000}
    ).json()
    assert r["loan"]["payoff_date"] < detail["loan"]["payoff_date"]
    r = client.delete(f"/api/contracts/{c['id']}/loan/repayments/0").json()
    assert r["loan"]["payoff_date"] == detail["loan"]["payoff_date"]
    cmp = client.post(f"/api/contracts/{c['id']}/loan/compare", json={"new_rate": 3.9}).json()
    assert cmp["fee_estimated"] and cmp["fees"] == pytest.approx(cmp["balance"] * 0.01, abs=0.01)  # § 502 BGB cap
    assert client.post(f"/api/contracts/{c['id']}/loan/compare", json={"new_rate": 99}).status_code == 422
    other = client.post(
        "/api/contracts", json={"name": "Handy", "category": "mobile", "start_date": "2025-01-01"}
    ).json()
    assert client.post(f"/api/contracts/{other['id']}/loan/compare", json={"new_rate": 3}).status_code == 400


def test_reminders_and_checkup(client):
    fixed = (date.today() + timedelta(days=200)).isoformat()
    c = _create(client, fixed_until=fixed, special_repayment_pct=5)
    items = client.get("/api/reminders/upcoming?horizon_days=400").json()["items"]
    kinds = {i["kind"]: i for i in items if i["contract_id"] == c["id"]}
    assert "fixed_rate_end" in kinds and "noch ca." in kinds["fixed_rate_end"]["detail"]
    assert "special_repayment" in kinds and "750" in kinds["special_repayment"]["detail"]
    assert "deadline" not in kinds  # loans have no notice-period alarm
    ov = client.get("/api/checkup").json()
    item = next(i for i in ov["items"] if i["contract_id"] == c["id"])
    assert item["reasons"][0]["code"] == "fixed_rate"


def test_emergency_folder_shows_debt(client):
    c = _create(client, debt_insurance=True)
    item = next(x for x in client.get("/api/emergency").json()["contracts"] if x["id"] == c["id"])
    labels = {d["label"]: d["value"] for d in item["details"]}
    assert labels["Restschuldversicherung"] == "ja" and "Restschuld (berechnet)" in labels
    assert "Erben" in item["death_hint"]
