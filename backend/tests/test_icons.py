"""Own emoji for contracts and income sources."""


def test_own_icon_for_contract_and_income(client):
    c = client.post(
        "/api/contracts",
        json={"name": "Hundeversicherung", "category": "other", "icon": "🐶", "start_date": "2025-01-01"},
    )
    assert c.status_code == 201, c.text
    assert c.json()["icon"] == "🐶"
    assert client.get("/api/contracts").json()[0]["icon"] == "🐶"
    # letters are not an emoji; an empty value goes back to the category's emoji
    bad = client.put(f"/api/contracts/{c.json()['id']}", json={**c.json(), "icon": "abc"})
    assert bad.status_code == 422
    body = {k: v for k, v in c.json().items() if k not in ("id",)}
    ok = client.put(f"/api/contracts/{c.json()['id']}", json={**body, "icon": " "})
    assert ok.status_code == 200, ok.text
    assert ok.json()["icon"] is None
    s = client.post(
        "/api/income/sources",
        json={
            "name": "Flohmarkt",
            "kind": "other",
            "icon": "🧸",
            "start_date": "2025-01-01",
            "first": {"valid_from": "2025-01-01", "net": 50},
        },
    ).json()
    assert s["icon"] == "🧸" and s["own_icon"] == "🧸"
