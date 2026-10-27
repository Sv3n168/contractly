"""A contract entered as already cancelled: no follow-up bill after its end."""

from datetime import date

import pytest


def test_yearly_contract_cancelled_when_created(client):
    year = date.today().year
    r = client.post(
        "/api/contracts",
        json={
            "name": "ADAC Plus",
            "category": "other",
            "start_date": f"{year}-01-15",
            "min_term_months": 12,
            "renewal_months": 12,
            "end_date": f"{year + 1}-01-14",
            "cancelled_on": date.today().isoformat(),
            "initial_price": {"valid_from": f"{year}-01-15", "amount": 150, "interval": "yearly"},
        },
    )
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["state"] == "cancelled" and c["end_date"] == f"{year + 1}-01-14"
    assert c["cancellation_deadline"] is None  # nothing left to cancel
    ts = client.get(
        "/api/stats/timeseries", params={"start": f"{year}-01", "end": f"{year + 1}-12", "group": "contract"}
    )
    assert ts.status_code == 200, ts.text
    data = ts.json()
    values = dict(zip(data["months"], data["series"][0]["values"], strict=True))
    # costs are spread over the months of the term: one year = 150 €, no second yearly payment
    assert sum(values.values()) == pytest.approx(150)
    assert all(v == 0 for m, v in values.items() if m > f"{year + 1}-01")
