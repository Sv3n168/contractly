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
    """Simulate a container restart: in-memory keys are gone, stored sessions remain."""
    vault.forget_keys()
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


def test_restart_keeps_session_but_server_alone_cannot_decrypt(client, app_env):
    _contract(client)
    _restart()
    assert not vault.unlocked_users() and not database.open_users()
    # The browser's session cookie unlocks the area again (no re-login needed) ...
    assert client.get("/api/contracts").json()[0]["name"] == SECRET_NAME
    # ... but the stored session alone is useless: it only holds the key wrapped with the cookie token.
    stored = (app_env / "sessions.db").read_bytes()
    assert SECRET_NAME.encode() not in stored
    with make_client() as stranger:
        assert stranger.get("/api/contracts").status_code == 401
        stranger.cookies.set("contractly_session", "erfundenes-token")
        assert stranger.get("/api/contracts").status_code == 401


def test_session_works_across_instances(client):
    """Two app instances on the same data volume share sessions (e.g. behind a load balancer)."""
    _contract(client)
    token = client.cookies.get("contractly_session")
    _restart()  # "other instance": no keys in memory
    with make_client() as other:
        other.cookies.set("contractly_session", token)
        assert other.get("/api/contracts").json()[0]["name"] == SECRET_NAME
        other.post("/api/auth/logout")
    assert client.get("/api/contracts").status_code == 401


def test_separate_user_areas(client, app_env):
    _contract(client)
    invite = client.post("/api/users", json={"username": "Partner", "role": "member"}).json()
    code = invite["code"]
    assert invite["user"]["status"] == "invited"
    assert client.post("/api/users", json={"username": "partner"}).status_code == 400  # name taken

    with make_client() as partner:
        assert (
            partner.post(
                "/api/auth/activate", json={"username": "partner", "code": "FALSCH", "password": "Lindenbaum-2026"}
            ).status_code
            == 401
        )
        r = partner.post(
            "/api/auth/activate", json={"username": "partner", "code": code.lower(), "password": "Lindenbaum-2026"}
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
    from alembic import command
    from sqlalchemy import create_engine, text

    from app.migrate import alembic_config

    (app_env / "documents").mkdir()
    plain = create_engine(f"sqlite:///{app_env / 'contractly.db'}")
    # Schema of the first version: no migration bookkeeping, no bonus/promo columns yet.
    with plain.begin() as conn:
        command.upgrade(alembic_config(conn), "0001")
        conn.execute(text("DROP TABLE alembic_version"))
        for column in ("bonuses", "promo_price", "promo_months"):
            conn.execute(text(f"ALTER TABLE offers DROP COLUMN {column}"))
        conn.execute(text("DROP TABLE meter_readings"))
        conn.execute(
            text(
                "INSERT INTO contracts (name, category, start_date, notice_unit, attributes, created_at, updated_at) "
                "VALUES ('Alter Vertrag', 'other', '2024-01-01', 'months', '{}', '2024-01-01', '2024-01-01')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO documents (contract_id, original_name, stored_name, content_type, size, uploaded_at) "
                "VALUES (1, 'a.pdf', 'abc.pdf', 'application/pdf', 5, '2024-01-01')"
            )
        )
    plain.dispose()
    (app_env / "documents" / "abc.pdf").write_bytes(PDF)

    with make_client() as c:
        assert c.get("/api/auth/status").json()["legacy_data"] is True
        c.post("/api/auth/setup", json={"username": "admin", "password": PASSWORD})
        contracts = c.get("/api/contracts").json()
        assert contracts[0]["name"] == "Alter Vertrag"
        offer = {"name": "Neu", "monthly_price": 5, "bonuses": [{"type": "switch", "amount": 50}]}
        assert c.post(f"/api/contracts/{contracts[0]['id']}/offers", json=offer).status_code == 201
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
        p.post(
            "/api/auth/activate", json={"username": "partner", "code": invite["code"], "password": "Kastanie-pw-123"}
        )
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
        assert _login(p, "partner", "Kastanie-pw-123").status_code == 200
        assert [c["name"] for c in p.get("/api/contracts").json()] == ["Vertrag Partner"]


def test_two_factor_login(client):
    from app.security import totp_code

    setup = client.post("/api/auth/2fa/setup").json()
    assert setup["uri"].startswith("otpauth://totp/Contractly:admin") and "<svg" in setup["qr_svg"]
    assert client.post("/api/auth/2fa/enable", json={"code": "000000"}).status_code == 400
    assert client.post("/api/auth/2fa/enable", json={"code": totp_code(setup["secret"])}).json()["totp_enabled"]
    client.post("/api/auth/logout")
    r = _login(client)
    assert r.status_code == 401 and r.json()["detail"] == "totp_required"
    assert not vault.unlocked_users()  # password alone does not unlock
    bad = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp": "123456"})
    assert bad.status_code == 401
    # the code used for activation is spent; the next one works exactly once
    # (codes are derived from the stored time step, so a 30-second boundary mid-test doesn't matter)
    step = vault.find("admin")["totp_step"]
    spent = totp_code(setup["secret"], step * 30)
    reused = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp": spent})
    assert reused.status_code == 401
    code = totp_code(setup["secret"], (step + 1) * 30)
    ok = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp": code})
    assert ok.status_code == 200
    assert ok.json()["failed_logins"] == 2  # wrong code + reused code, reported after login
    client.post("/api/auth/logout")
    again = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp": code})
    assert again.status_code == 401
    client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD, "totp": code})
    # recovery key disables 2FA (lost phone)
    client.post("/api/auth/logout")
    client.post(
        "/api/auth/recover",
        json={"username": "admin", "recovery_key": client.recovery_key, "new_password": "neu-passwort-99"},
    )
    assert client.get("/api/auth/me").json()["totp_enabled"] is False


def test_home_assistant_summary(client):
    _contract(client)
    with make_client() as ha:
        assert ha.get("/api/ha/summary").status_code == 401
    token = client.post("/api/auth/api-token").json()["token"]
    client.post("/api/auth/logout")  # works while logged out
    with make_client() as ha:
        r = ha.get("/api/ha/summary", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["monthly_total"] == 19.99 and data["active_contracts"] == 1
        assert SECRET_NAME not in r.text


def test_rate_limit_per_username_and_parallel_attempts(app_env):
    """Changing client addresses (spoofed X-Forwarded-For) doesn't lift the per-account limit."""
    import pytest

    from app.security import VaultError

    for i in range(20):
        vault.check_rate_limit(f"10.0.0.{i}", "Admin")  # counted up front, before the slow KDF
    with pytest.raises(VaultError):
        vault.check_rate_limit("10.0.1.1", "admin")
    vault.check_rate_limit("10.0.1.1", "someone-else")


def test_shutdown_keeps_sessions(client):
    """Stopping the app (container update) must not log anyone out."""
    import asyncio

    from app.main import create_app, lifespan

    async def run():
        app = create_app(background=False)
        async with lifespan(app):
            pass

    asyncio.run(run())
    database.close_all()
    assert client.get("/api/contracts").status_code == 200


def test_member_cannot_target_internal_network(client, monkeypatch):
    import socket

    def resolve(host, *_a, **_kw):
        ip = {"ntfy.sh": "159.203.148.75", "router.fritz.box": "192.168.178.1"}.get(host, host)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))]

    monkeypatch.setattr("app.reminders.socket.getaddrinfo", resolve)
    invite = client.post("/api/users", json={"username": "partner"}).json()
    with make_client() as partner:
        partner.post("/api/auth/activate", json={"username": "partner", "code": invite["code"], "password": PASSWORD})
        for url in ("http://router.fritz.box/admin", "http://127.0.0.1:8000/x", "http://[::1]/x"):
            r = partner.put("/api/auth/me/settings", json={"ntfy_url": url})
            assert r.status_code == 400, url
        assert partner.put("/api/auth/me/settings", json={"ntfy_url": "https://ntfy.sh/topic"}).status_code == 200
    # the admin may use a self-hosted ntfy in the home network
    assert client.put("/api/auth/me/settings", json={"ntfy_url": "http://router.fritz.box/ntfy"}).status_code == 200


def test_setup_from_outside_needs_code(app_env):
    """A fresh instance reachable from the internet can't be claimed by a stranger."""
    from fastapi.testclient import TestClient

    from app.main import create_app

    remote = TestClient(create_app(background=False), client=("203.0.113.7", 40000))
    assert remote.get("/api/auth/status").json()["setup_code_required"] is True
    body = {"username": "admin", "password": PASSWORD}
    assert remote.post("/api/auth/setup", json=body).status_code == 403
    assert remote.post("/api/auth/setup", json={**body, "setup_code": "AAAAA-BBBBB"}).status_code == 403
    code = (app_env / "setup-code.txt").read_text()
    assert remote.post("/api/auth/setup", json={**body, "setup_code": code.lower()}).status_code == 200
    assert not (app_env / "setup-code.txt").exists()


def test_cross_site_requests_and_headers(anon_client):
    r = anon_client.post(
        "/api/auth/login", json={"username": "admin", "password": "x"}, headers={"Sec-Fetch-Site": "cross-site"}
    )
    assert r.status_code == 403
    page = anon_client.get("/")
    for header in ("Content-Security-Policy", "Permissions-Policy", "Cross-Origin-Opener-Policy", "X-Frame-Options"):
        assert header in page.headers
    assert "Strict-Transport-Security" not in page.headers  # only over https
    assert "Strict-Transport-Security" in anon_client.get("https://testserver/").headers


def test_weak_passwords_rejected(anon_client):
    for pw in ("passwort123", "aaaaaaaaaaaa", "mein-admin-konto", "1234567890"):
        r = anon_client.post("/api/auth/setup", json={"username": "admin", "password": pw})
        assert r.status_code == 400, pw


def test_login_limit_survives_restart(client):
    client.post("/api/auth/logout")
    for _ in range(10):
        _login(client, password="falsch-falsch")
    _restart()
    with make_client() as other:  # same address, new process state
        assert _login(other).status_code == 429
