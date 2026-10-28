"""Automatic logout: an idle session ends and the user's data key leaves the memory."""

import sqlite3

from app.config import settings
from app.security import vault

from .conftest import PASSWORD


def _ttls():
    with sqlite3.connect(settings.data_dir / "sessions.db") as db:
        return [row[0] for row in db.execute("SELECT ttl FROM sessions")]


def _settings(client, minutes):
    r = client.put("/api/auth/me/settings", json={"idle_minutes": minutes})
    assert r.status_code == 200, r.text
    return r.json()


def test_setting_shortens_open_sessions_and_new_ones(client):
    assert max(_ttls()) > 15 * 60
    assert _settings(client, 15)["settings"]["idle_minutes"] == 15
    assert max(_ttls()) <= 15 * 60  # the session already open
    client.post("/api/auth/logout")
    r = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "remember": True})
    assert r.status_code == 200, r.text
    assert max(_ttls()) <= 15 * 60  # also wins over "Angemeldet bleiben"


def test_idle_session_locks_the_data(client, monkeypatch):
    _settings(client, 5)
    uid = client.get("/api/auth/me").json()["id"]
    assert uid in vault._keys
    import time as real_time

    later = real_time.time() + 6 * 60
    monkeypatch.setattr("app.security.time.time", lambda: later)
    vault.expire_sessions()
    assert uid not in vault._keys  # key gone: the database is locked again
    assert client.get("/api/contracts").status_code == 401


def test_saving_notifications_keeps_the_idle_setting(client):
    _settings(client, 30)
    s = client.put(
        "/api/auth/me/settings", json={"idle_minutes": 30, "notify_email": "", "ntfy_url": "", "reveal_names": True}
    ).json()
    assert s["settings"]["idle_minutes"] == 30 and s["settings"]["reveal_names"] is True
