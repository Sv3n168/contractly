"""A contract paid once (e.g. a device, a lifetime licence, a course paid up front)."""


def test_contract_paid_once(client):
    r = client.post(
        "/api/contracts",
        json={
            "name": "Sprachkurs",
            "category": "education",
            "start_date": "2026-03-01",
            "initial_price": {"valid_from": "2026-03-01", "amount": 490, "interval": "once"},
        },
    )
    assert r.status_code == 201, r.text
    c = client.get(f"/api/contracts/{r.json()['id']}").json()
    assert c["monthly_cost"] == 0
    assert c["total_paid"] == 490
    assert c["payments"]["count"] == 1
    assert c["current_price"] is None and c["one_off_total"] == 490
