from datetime import date

import pytest

from app import calc
from app.models import Contract, Offer, PriceEntry


def make(start, prices, end=None, **kw):
    c = Contract(name="x", category=kw.pop("category", "mobile"), start_date=start, end_date=end, attributes={}, **kw)
    for valid_from, amount, interval in prices:
        c.prices.append(PriceEntry(valid_from=valid_from, amount=amount, interval=interval, details={}))
    return c


def test_add_months_clamps_day():
    assert calc.add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
    assert calc.add_months(date(2024, 3, 15), -3) == date(2023, 12, 15)


def test_monthly_equivalent():
    assert calc.monthly_equivalent(120, "yearly") == 10
    assert calc.monthly_equivalent(30, "quarterly") == 10
    assert calc.monthly_equivalent(99, "once") == 0


def test_monthly_costs_prorates_and_follows_price_changes():
    c = make(date(2024, 1, 16), [(date(2024, 1, 16), 31, "monthly"), (date(2024, 3, 1), 62, "monthly")])
    costs = calc.monthly_costs(c, date(2024, 1, 1), date(2024, 3, 31))
    assert costs == {"2024-01": 16.0, "2024-02": 31.0, "2024-03": 62.0}


def test_monthly_costs_stops_at_end_and_adds_once():
    c = make(
        date(2024, 1, 1),
        [(date(2024, 1, 1), 30, "monthly"), (date(2024, 1, 1), -50, "once")],
        end=date(2024, 2, 29),
    )
    costs = calc.monthly_costs(c, date(2024, 1, 1), date(2024, 4, 30))
    assert costs == {"2024-01": -20.0, "2024-02": 30.0, "2024-03": 0.0, "2024-04": 0.0}


def test_term_info_min_term_then_monthly_renewal():
    c = make(date(2024, 1, 1), [], min_term_months=24, renewal_months=1, notice_value=1, notice_unit="months")
    info = calc.term_info(c, date(2024, 6, 1))
    assert info.next_term_end == date(2025, 12, 31)
    assert info.cancellation_deadline == date(2025, 11, 30)
    later = calc.term_info(c, date(2026, 3, 10))
    assert later.next_term_end == date(2026, 4, 30)
    assert later.cancellation_deadline == date(2026, 3, 31)


def test_term_info_yearly_insurance_with_three_months_notice():
    c = make(date(2023, 1, 1), [], min_term_months=12, renewal_months=12, notice_value=3, notice_unit="months")
    info = calc.term_info(c, date(2024, 10, 2))
    assert info.next_term_end == date(2025, 12, 31)
    assert info.cancellation_deadline == date(2025, 9, 30)


def test_chain_order():
    a = make(date(2022, 1, 1), [])
    b = make(date(2023, 1, 1), [])
    a.id, b.id = 1, 2
    b.predecessor = a
    assert [x.id for x in calc.contract_chain(b)] == [1, 2]
    assert [x.id for x in calc.contract_chain(a)] == [1, 2]


def test_evaluate_offer_verdicts():
    c = make(date(2024, 1, 1), [(date(2024, 1, 1), 40, "monthly")])
    cheap = Offer(id=1, name="a", monthly_price=25, one_time_costs=30, bonus=0, attributes={})
    r = calc.evaluate_offer(cheap, c, date(2024, 6, 1), 24, 20)
    assert r["savings_total"] == 40 * 24 - (25 * 24 + 30)
    assert r["verdict"] == "worth_it"
    assert r["break_even_month"] == 3
    pricey = Offer(id=2, name="b", monthly_price=45, one_time_costs=0, bonus=0, attributes={})
    assert calc.evaluate_offer(pricey, c, date(2024, 6, 1), 24, 20)["verdict"] == "not_worth_it"


def test_energy_offer_uses_consumption():
    c = make(date(2024, 1, 1), [(date(2024, 1, 1), 100, "monthly")], category="electricity")
    c.attributes = {"base_price_month": 10, "unit_price_ct": 40, "consumption_kwh": 3000}
    assert calc.contract_reference_monthly(c, date(2024, 6, 1)) == 110
    offer = Offer(id=1, name="o", base_price_month=12, unit_price_ct=30, one_time_costs=0, bonus=0, attributes={})
    assert calc.offer_monthly(offer, c) == 12 + 75


def test_monthly_cancellable_after_min_term():
    c = make(date(2024, 1, 1), [], min_term_months=12, renewal_months=1, notice_value=1, notice_unit="months")
    assert not calc.term_info(c, date(2024, 6, 1)).flexible
    assert calc.term_info(c, date(2025, 6, 1)).flexible
    yearly = make(date(2020, 1, 1), [], min_term_months=12, renewal_months=12, notice_value=3, notice_unit="months")
    assert not calc.term_info(yearly, date(2025, 6, 1)).flexible


def test_extra_charge_only_affects_its_month():
    """Calls abroad make one month more expensive; the next month is back to the base price."""
    c = make(date(2024, 1, 1), [(date(2024, 1, 1), 40, "monthly")])
    c.prices.append(
        PriceEntry(
            valid_from=date(2024, 3, 12), amount=15.5, interval="once", note="Ausland", details={"kind": "extra"}
        )
    )
    costs = calc.monthly_costs(c, date(2024, 2, 1), date(2024, 4, 30))
    assert costs == {"2024-02": 40.0, "2024-03": 55.5, "2024-04": 40.0}
    assert calc.current_monthly_cost(c, date(2024, 3, 20)) == 40
    assert calc.extras_by_month(c, date(2024, 1, 1), date(2024, 12, 31)) == {"2024-03": 15.5}
    assert calc.average_extras(c, date(2024, 12, 15)) == pytest.approx(15.5 / 12)


def test_projection_with_average_extras():
    c = make(date(2024, 1, 1), [(date(2024, 1, 1), 40, "monthly")])
    c.prices.append(PriceEntry(valid_from=date(2024, 5, 3), amount=24, interval="once", details={"kind": "extra"}))
    costs = calc.monthly_costs(c, date(2025, 1, 1), date(2025, 1, 31), today=date(2024, 12, 10), extra_monthly=2)
    assert costs == {"2025-01": 42.0}


def _offer(**kw):
    base = {"id": 1, "name": "o", "one_time_costs": 0, "bonus": 0, "attributes": {}, "bonuses": []}
    base.update(kw)
    return Offer(**base)


def test_switch_bonus_timing_and_dependency():
    c = make(date(2024, 1, 1), [(date(2024, 1, 1), 30, "monthly")])
    # 2 €/month more expensive, but 120 € new-customer bonus after 12 months
    o = _offer(monthly_price=32, bonuses=[{"type": "new_customer", "amount": 120, "paid_after_months": 12}])
    r = calc.evaluate_offer(o, c, date(2024, 6, 1), 24, 20)
    assert r["bonus_in_horizon"] == 120
    assert r["savings_total"] == 30 * 24 - (32 * 24 - 120)  # 72
    assert r["savings_total_without_bonus"] == -48
    assert r["bonus_dependent"] is True
    assert r["verdict"] == "worth_it" and r["verdict_without_bonus"] == "not_worth_it"
    # 120 € bonus covers 2 €/month extra for 60 months in total
    assert r["advantage_ends_month"] == 60
    assert r["break_even_month"] is None  # never cheaper on a monthly basis

    no_bonus = calc.evaluate_offer(o, c, date(2024, 6, 1), 24, 20, include_bonus=False)
    assert no_bonus["savings_total"] == -48
    assert no_bonus["bonus_dependent"] is False

    short = calc.evaluate_offer(o, c, date(2024, 6, 1), 12, 20)
    assert short["bonus_in_horizon"] == 0
    assert short["bonus_outside_horizon"] == 120


def test_promo_price_and_legacy_bonus():
    c = make(date(2024, 1, 1), [(date(2024, 1, 1), 30, "monthly")])
    o = _offer(monthly_price=25, promo_price=10, promo_months=6, bonus=20)
    r = calc.evaluate_offer(o, c, date(2024, 6, 1), 12, 20)
    assert r["offer_total"] == 6 * 10 + 6 * 25 - 20  # 190
    assert r["savings_total"] == 360 - 190
    assert r["bonus_in_horizon"] == 20
    assert r["break_even_month"] == 1
