import pytest

from app import backup
from tests.conftest import PASSWORD


def test_encrypt_roundtrip():
    blob = backup.encrypt(b"hello", "geheimer-schluessel")
    assert backup.is_encrypted(blob)
    assert backup.decrypt(blob, "geheimer-schluessel") == b"hello"
    with pytest.raises(backup.BackupError):
        backup.decrypt(blob, "falsch-falsch")


def test_backup_with_passphrase(client):
    client.post("/api/demo")
    count = len(client.get("/api/contracts").json())
    c = client.get("/api/contracts").json()[0]
    client.post(f"/api/contracts/{c['id']}/documents", files={"file": ("a.txt", b"doc-content", "text/plain")})

    assert client.post("/api/backups", json={"passphrase": "kurz"}).status_code == 400
    created = client.post("/api/backups", json={"passphrase": "sehr-geheim-123"}).json()
    assert created["name"].endswith(".ctly")
    blob = client.get(f"/api/backups/{created['name']}").content

    client.delete(f"/api/contracts/{c['id']}")
    assert len(client.get("/api/contracts").json()) == count - 1

    r = client.post("/api/backups/restore", files={"file": ("b.ctly", blob)})
    assert r.status_code == 400  # backup key missing
    r = client.post("/api/backups/restore", files={"file": ("b.ctly", blob)}, data={"passphrase": "falsch-123"})
    assert r.status_code == 400
    r = client.post("/api/backups/restore", files={"file": ("b.ctly", blob)}, data={"passphrase": "sehr-geheim-123"})
    assert r.status_code == 200, r.text
    assert r.json()["documents"] == 1
    client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    assert len(client.get("/api/contracts").json()) == count
    names = [b["name"] for b in client.get("/api/backups").json()["backups"]]
    assert any("pre-restore" in n for n in names)


def test_backup_name_validation(client):
    assert client.get("/api/backups/..%2Fcontractly.db").status_code in (400, 404)
    assert client.delete("/api/backups/evil.zip").status_code == 400
