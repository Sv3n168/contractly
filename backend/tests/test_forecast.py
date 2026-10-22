"""Consumption forecast from meter readings (seasonal profile, learning, range, settlement)."""

from datetime import date, timedelta

import pytest

from app import forecast
from app.calc import add_months

GAS_YEAR_KWH = 12_000


def _readings(profile, annual, start, days_between, count, factor=1.0, value=1000.0):
    """Synthetic meter readings that follow ``profile`` exactly."""
    out = [(start, value)]
    day = start
    for _ in range(count - 1):
        nxt = day + timedelta(days=days_between)
        value += annual * sum(forecast.month_weights(profile, day, nxt).values()) / factor
        out.append((nxt, value))
        day = nxt
    return out


def test_profiles_sum_to_one():
    for profile in forecast.PROFILES.values():
        assert sum(profile) == pytest.approx(1.0)


def test_winter_readings_are_not_extrapolated_linearly():
    """Two gas readings in January: a linear estimate would double the yearly consumption."""
    readings = _readings(forecast.PROFILES["heating"], GAS_YEAR_KWH, date(2026, 1, 1), 31, 2, factor=10)
    fc = forecast.forecast(readings, "gas", {"gas_factor": 10})
    assert fc["annual_kwh"] == pytest.approx(GAS_YEAR_KWH, rel=0.01)
    linear = (readings[1][1] - readings[0][1]) * 10 / 31 * 365
    assert linear > 1.8 * GAS_YEAR_KWH
    assert fc["low_kwh"] < GAS_YEAR_KWH < fc["high_kwh"]  # little data -> wide range
    assert fc["relative_uncertainty"] > 0.2 and fc["learned"] is False


def test_learns_household_profile_and_narrows_range():
    """A flat consumer on a gas contract (e.g. only hot water): after a year the profile adapts."""
    flat = [1 / 12] * 12
    readings = _readings(flat, 3000, date(2025, 1, 1), 30, 15, factor=10)
    fc = forecast.forecast(readings, "gas", {"gas_factor": 10})
    assert fc["learned"] is True
    assert fc["annual_kwh"] == pytest.approx(3000, rel=0.03)
    july, january = fc["monthly_kwh"][6], fc["monthly_kwh"][0]
    typical = forecast.PROFILES["heating"]
    assert july / january > 2 * typical[6] / typical[0]  # much flatter than a heating profile
    assert fc["relative_uncertainty"] < 0.1


def test_meter_replacement_and_bad_input():
    readings = [(date(2025, 1, 1), 5000), (date(2025, 3, 1), 5600), (date(2025, 5, 1), 20), (date(2025, 7, 1), 520)]
    fc = forecast.forecast(readings, "electricity", {})
    assert fc["periods"] == 2  # the negative step (new meter) is skipped
    assert forecast.forecast([(date(2025, 1, 1), 100)], "electricity", {}) is None
    assert forecast.gas_factor({"gas_factor": "abc"}) == forecast.DEFAULT_GAS_FACTOR
    assert forecast.gas_factor({"gas_factor": 11.2}) == 11.2


def test_heat_pump_uses_heating_profile():
    kind, profile = forecast.profile_for("electricity", {"heating": True})
    assert kind == "heat_pump" and profile[0] > 2 * profile[6]


def _gas_contract(client, start, readings, installment=80):
    c = client.post(
        "/api/contracts",
        json={
            "name": "Gas",
            "category": "gas",
            "start_date": start.isoformat(),
            "attributes": {"base_price_month": 15, "unit_price_ct": 12, "installment": installment, "gas_factor": 10},
            "initial_price": {"valid_from": start.isoformat(), "amount": installment},
        },
    ).json()
    for day, value in readings:
        client.post(f"/api/contracts/{c['id']}/readings", json={"reading_date": day.isoformat(), "value": value})
    return client.get(f"/api/contracts/{c['id']}").json()


def test_settlement_needed_installment_and_reminder(client):
    today = date.today()
    start = today - timedelta(days=400)  # a full year of monthly readings, whatever the season today
    readings = _readings(forecast.PROFILES["heating"], GAS_YEAR_KWH, start, 30, 14, factor=10)
    c = _gas_contract(client, start, readings)
    e = c["energy"]
    expected = 15 * 12 + 0.12 * e["forecast"]["annual_kwh"]
    assert e["expected_yearly_cost"] == pytest.approx(expected, abs=0.01)
    assert e["settlement_estimate"] == pytest.approx(80 * 12 - expected, abs=0.01)
    assert e["settlement_estimate"] < -500  # 80 € can't cover 12,000 kWh
    assert e["cost_low"] < e["expected_yearly_cost"] < e["cost_high"]
    assert e["forecast"]["learned"] and e["forecast"]["annual_kwh"] == pytest.approx(GAS_YEAR_KWH, rel=0.02)
    # paying the needed installment for the rest of the billing year closes the gap
    begin = add_months(date.fromisoformat(e["billing_year_end"]) + timedelta(days=1), -12)
    elapsed = (today.year - begin.year) * 12 + today.month - begin.month
    assert 80 * elapsed + e["needed_installment"] * (12 - elapsed) == pytest.approx(expected, abs=1)

    items = client.get("/api/reminders/upcoming?horizon_days=30").json()["items"]
    warn = [i for i in items if i["kind"] == "installment_check"]
    assert len(warn) == 1 and "Nachzahlung droht" in warn[0]["title"]
    assert warn[0]["date"] == e["billing_year_end"]


def test_no_warning_when_installment_fits(client):
    start = date.today() - timedelta(days=400)
    readings = _readings(forecast.PROFILES["heating"], 6000, start, 30, 14, factor=10)
    c = _gas_contract(client, start, readings, installment=80)  # ~900 €/year vs 960 € paid
    assert c["energy"]["settlement_estimate"] > 0
    items = client.get("/api/reminders/upcoming?horizon_days=30").json()["items"]
    assert not [i for i in items if i["kind"] == "installment_check"]


def test_demo_gas_contract_shows_forecast(client):
    client.post("/api/demo")
    gas = next(c for c in client.get("/api/contracts").json() if c["category"] == "gas")
    e = client.get(f"/api/contracts/{gas['id']}").json()["energy"]
    assert e["consumption_source"] == "readings" and e["forecast"]["annual_kwh"] == pytest.approx(10_500, rel=0.05)
    assert e["settlement_estimate"] < 0 and e["needed_installment"] > 95
