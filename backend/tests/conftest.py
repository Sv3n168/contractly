from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

PASSWORD = "sehr-geheimes-passwort"


@pytest.fixture()
def app_env(tmp_path, monkeypatch):
    from app import db as database
    from app.config import settings
    from app.security import vault

    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "documents_dir", tmp_path / "documents")
    monkeypatch.setattr(settings, "backup_dir", tmp_path / "backups")
    monkeypatch.setattr("app.security.time.sleep", lambda _s: None)
    vault.lock_all()
    database.close_all()
    yield tmp_path
    vault.lock_all()
    database.close_all()


@contextmanager
def make_client():
    """A second browser/device: own cookies, same server (no extra app lifespan)."""
    from app.main import create_app

    yield TestClient(create_app(background=False), client=("127.0.0.1", 50000))


@pytest.fixture()
def anon_client(app_env):
    """Client for a fresh, not yet set up installation."""
    from app.main import create_app

    with TestClient(create_app(background=False), client=("127.0.0.1", 50000)) as c:
        yield c


@pytest.fixture()
def client(anon_client):
    """Set up and logged-in admin client."""
    r = anon_client.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD})
    assert r.status_code == 200, r.text
    anon_client.recovery_key = r.json()["recovery_key"]
    return anon_client
