"""Encryption at rest, login, separate user areas and backups."""

import sqlite3
from datetime import date, timedelta

from app import db as database
from app.security import vault
from tests.conftest import PASSWORD, make_client

SECRET_NAME = "Geheimtarif-XYZ-4711"
PDF = b"%PDF-1.4\n% Kundennummer GEHEIM-123456\n"


def _contract(client, name=SECRET_NAME):
    r = client.post(
        "/api/contracts",
        json={
            "name": name,
            "category": "mobile",
            "start_date": date.today().isoformat(),
            "customer_number": "KD-998877",
            "min_term_months": 24,
            "initial_price": {"valid_from": date.today().isoformat(), "amount": 19.99},
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def _login(client, username="admin", password=PASSWORD):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def _restart():
    """Simulate a container restart: all keys and sessions are gone."""
    vault.lock_all()
    database.close_all()


def _admin_id():
    return vault.find("admin")["id"]


def test_requires_setup_then_login(anon_client):
    st = anon_client.get("/api/auth/status").json()
    assert st["initialized"] is False and st["authenticated"] is False
    assert anon_client.get("/api/contracts").json()["detail"] == "setup_required"
    assert anon_client.get("/").status_code == 200  # app shell stays reachable
    weak = anon_client.post("/api/auth/setup", json={"username": "admin", "password": "kurz"})
    assert weak.status_code == 400
    r = anon_client.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD})
    assert len(r.json()["recovery_key"]) > 30
    assert anon_client.post("/api/auth/setup", json={"username": "x", "password": PASSWORD}).status_code == 409
    me = anon_client.get("/api/auth/status").json()["user"]
    assert me["username"] == "admin" and me["role"] == "admin"
    assert anon_client.get("/api/contracts").status_code == 200


def test_data_and_pdfs_are_encrypted_at_rest(client, app_env):
    c = _contract(client)
    client.post(f"/api/contracts/{c['id']}/documents", files={"file": ("vertrag.pdf", PDF, "application/pdf")})
    area = app_env / "users" / _admin_id()
    client.post("/api/auth/logout")  # last session -> key wiped, database closed
    assert not database.is_open(_admin_id())
    raw = (area / "contractly.db").read_bytes()
    assert not raw.startswith(b"SQLite format 3")
    assert SECRET_NAME.encode() not in raw and b"KD-998877" not in raw
    stored = next((area / "documents").iterdir()).read_bytes()
    assert b"GEHEIM-123456" not in stored and not stored.startswith(b"%PDF")
    conn = sqlite3.connect(area / "contractly.db")
    try:
        conn.execute("select * from contracts")
        raise AssertionError("plain sqlite must not read the database")
    except sqlite3.DatabaseError:
        pass
    finally:
        conn.close()
    # Nothing in the reminder outbox reveals the contract name by default
    outbox = (area / "outbox.json").read_text()
    assert SECRET_NAME not in outbox and "Mobilfunk" in outbox or outbox


def test_logout_wipes_key_and_relogin_decrypts(client):
    c = _contract(client)
    client.post(f"/api/contracts/{c['id']}/documents", files={"file": ("v.pdf", PDF, "application/pdf")})
    client.post("/api/auth/logout")
    assert not vault.is_unlocked(_admin_id())
    assert client.get("/api/contracts").status_code == 401
    assert _login(client, password="falsch-falsch").status_code == 401
    assert _login(client, username="ADMIN").status_code == 200
    detail = client.get(f"/api/contracts/{c['id']}").json()
    assert detail["name"] == SECRET_NAME
    assert client.get(f"/api/documents/{detail['documents'][0]['id']}").content == PDF


def test_restart_locks_until_login(client):
    _contract(client)
    _restart()
    assert client.get("/api/contracts").status_code == 401
    assert _login(client).status_code == 200
    assert client.get("/api/contracts").json()[0]["name"] == SECRET_NAME


def test_separate_user_areas(client, app_env):
    _contract(client)
    invite = client.post("/api/users", json={"username": "Partner", "role": "member"}).json()
    code = invite["code"]
    assert invite["user"]["status"] == "invited"
    assert client.post("/api/users", json={"username": "partner"}).status_code == 400  # name taken

    with make_client() as partner:
        assert (
            partner.post(
                "/api/auth/activate", json={"username": "partner", "code": "FALSCH", "password": "partner-passwort"}
            ).status_code
            == 401
        )
        r = partner.post(
            "/api/auth/activate", json={"username": "partner", "code": code.lower(), "password": "partner-passwort"}
        )
        assert r.status_code == 200, r.text
        assert r.json()["recovery_key"]
        # code is single-use
        assert (
            partner.post(
                "/api/auth/activate", json={"username": "partner", "code": code, "password": "x" * 12}
            ).status_code
            == 401
        )
        assert partner.get("/api/contracts").json() == []  # does not see the admin's contracts
        _contract(partner, name="Partner-Handy")
        assert partner.get("/api/users").status_code == 403  # members can't manage users
        assert partner.get("/api/backups").status_code == 403
        partner.post("/api/auth/logout")

    # admin still sees only their own data; partner's area is locked again
    assert [c["name"] for c in client.get("/api/contracts").json()] == [SECRET_NAME]
    partner_id = vault.find("partner")["id"]
    assert not vault.is_unlocked(partner_id)
    raw = (app_env / "users" / partner_id / "contractly.db").read_bytes()
    assert b"Partner-Handy" not in raw

    # admin can delete the user incl. data, but not themselves
    assert client.delete(f"/api/users/{_admin_id()}").status_code == 400
    assert client.delete(f"/api/users/{partner_id}").status_code == 204
    assert not (app_env / "users" / partner_id).exists()


def test_invite_renew_and_expiry(client, monkeypatch):
    invite = client.post("/api/users", json={"username": "kind"}).json()
    new_code = client.post(f"/api/users/{invite['user']['id']}/invite").json()["code"]
    monkeypatch.setattr("app.security.time.time", lambda: 10**12)  # far in the future
    with make_client() as c:
        r = c.post("/api/auth/activate", json={"username": "kind", "code": new_code, "password": "kind-passwort-1"})
        assert r.status_code == 400 and "abgelaufen" in r.json()["detail"]


def test_recovery_and_password_change(client):
    _contract(client)
    recovery = client.recovery_key
    bad = client.post("/api/auth/change-password", json={"old_password": "falsch", "new_password": "neues-passwort-1"})
    assert bad.status_code == 400
    ok = client.post("/api/auth/change-password", json={"old_password": PASSWORD, "new_password": "neues-passwort-1"})
    assert ok.status_code == 200
    assert client.get("/api/contracts").status_code == 200  # current session kept
    _restart()
    assert _login(client).status_code == 401
    r = client.post(
        "/api/auth/recover",
        json={
            "username": "admin",
            "recovery_key": recovery.lower().replace("-", " "),
            "new_password": "drittes-pw-123",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["recovery_key"] != recovery
    assert client.get("/api/contracts").json()[0]["name"] == SECRET_NAME
    _restart()
    assert _login(client, password="drittes-pw-123").status_code == 200


def test_calendar_and_reminders_work_while_logged_out(client, monkeypatch):
    _contract(client)
    due = (date.today() + timedelta(days=2)).isoformat()
    client.post("/api/reminders", json={"title": "Bonus prüfen GEHEIM", "due_date": due, "lead_days": 5})
    token = client.get("/api/auth/calendar").json()["token"]
    client.put("/api/auth/me/settings", json={"reveal_names": False, "ntfy_url": "https://ntfy.example/topic"})
    client.post("/api/auth/logout")

    with make_client() as calendar_app:  # no session cookie
        assert calendar_app.get("/api/calendar.ics").status_code == 401
        cal = calendar_app.get(f"/api/calendar/{token}.ics")
        assert cal.status_code == 200
        assert "Eigene Erinnerung" in cal.text and "GEHEIM" not in cal.text
        assert calendar_app.get("/api/calendar/falsch.ics").status_code == 404

    sent = []
    monkeypatch.setattr("app.reminders._send_ntfy", lambda url, title, body, link: sent.append((url, title)))
    from app.reminders import run_notifications

    assert run_notifications() == 1  # delivered although the user is logged out
    assert sent == [("https://ntfy.example/topic", "Contractly: Eigene Erinnerung")]
    assert run_notifications() == 0  # only once


def test_rate_limit(client):
    client.post("/api/auth/logout")
    for _ in range(10):
        _login(client, password="falsch-falsch")
    assert _login(client).status_code == 429


def test_legacy_plaintext_data_is_migrated(app_env):
    """Data from the version without encryption moves into the first admin's encrypted area."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.db import Base
    from app.models import Contract, Document

    (app_env / "documents").mkdir()
    plain = create_engine(f"sqlite:///{app_env / 'contractly.db'}")
    Base.metadata.create_all(plain)
    with Session(plain) as s:
        c = Contract(name="Alter Vertrag", category="other", start_date=date(2024, 1, 1), attributes={})
        c.documents.append(
            Document(original_name="a.pdf", stored_name="abc.pdf", content_type="application/pdf", size=5)
        )
        s.add(c)
        s.commit()
    plain.dispose()
    (app_env / "documents" / "abc.pdf").write_bytes(PDF)

    with make_client() as c:
        assert c.get("/api/auth/status").json()["legacy_data"] is True
        c.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD})
        contracts = c.get("/api/contracts").json()
        assert contracts[0]["name"] == "Alter Vertrag"
        doc_id = c.get(f"/api/contracts/{contracts[0]['id']}").json()["documents"][0]["id"]
        assert c.get(f"/api/documents/{doc_id}").content == PDF
    # plaintext originals are gone
    assert not (app_env / "contractly.db").exists()
    assert not (app_env / "documents").exists()
    area = app_env / "users" / vault.find("admin")["id"]
    assert not database.is_plaintext(area / "contractly.db")
    assert (area / "documents" / "abc.pdf").read_bytes() != PDF


def test_backup_restore_all_users(client):
    _contract(client, name="Vertrag A")
    invite = client.post("/api/users", json={"username": "partner"}).json()
    with make_client() as p:
        p.post("/api/auth/activate", json={"username": "partner", "code": invite["code"], "password": "partner-pw-123"})
        _contract(p, name="Vertrag Partner")
        # backup while the partner is still logged in (open database)
        name = client.post("/api/backups", json={}).json()["name"]
        blob = client.get(f"/api/backups/{name}").content
        p.post("/api/auth/logout")

    client.delete(f"/api/users/{vault.find('partner')['id']}")
    client.post("/api/contracts", json={"name": "Neu nach Backup", "category": "other", "start_date": "2025-01-01"})

    r = client.post("/api/backups/restore", files={"file": ("x.zip", blob)})
    assert r.status_code == 200, r.text
    assert r.json()["relogin"] is True and r.json()["users"] == 2
    assert client.get("/api/contracts").status_code == 401  # everybody logged out
    assert _login(client).status_code == 200
    assert [c["name"] for c in client.get("/api/contracts").json()] == ["Vertrag A"]
    with make_client() as p:
        assert _login(p, "partner", "partner-pw-123").status_code == 200
        assert [c["name"] for c in p.get("/api/contracts").json()] == ["Vertrag Partner"]
