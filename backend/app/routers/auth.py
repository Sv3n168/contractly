"""Setup, login/logout, invitations, password management and (admin) user management."""

import hmac
import io
import ipaddress
import logging
import os
import shutil
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import db as database
from ..config import settings
from ..security import (
    MIN_PASSWORD_LENGTH,
    InvalidCredentials,
    TotpRequired,
    VaultError,
    new_setup_code,
    new_totp_secret,
    normalize_code,
    public_user,
    vault,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
users_router = APIRouter(prefix="/api/users", tags=["users"])
log = logging.getLogger("contractly.auth")

COOKIE = "contractly_session"


class SetupIn(BaseModel):
    username: str = Field(min_length=1, max_length=60)
    password: str = Field(max_length=500)
    setup_code: str | None = Field(default=None, max_length=40)


class LoginIn(BaseModel):
    username: str = Field(max_length=60)
    password: str = Field(max_length=500)
    totp: str | None = Field(default=None, max_length=12)
    remember: bool = False


class CodeIn(BaseModel):
    code: str = Field(max_length=12)


class ActivateIn(BaseModel):
    username: str = Field(max_length=60)
    code: str = Field(max_length=100)
    password: str = Field(max_length=500)


class RecoverIn(BaseModel):
    username: str = Field(max_length=60)
    recovery_key: str = Field(max_length=200)
    new_password: str = Field(max_length=500)


class ChangePasswordIn(BaseModel):
    old_password: str = Field(max_length=500)
    new_password: str = Field(max_length=500)


class PasswordIn(BaseModel):
    password: str = Field(max_length=500)


class AccountSettingsIn(BaseModel):
    reveal_names: bool = False
    notify_email: str = Field(default="", max_length=200)
    ntfy_url: str = Field(default="", max_length=500)


class InviteIn(BaseModel):
    username: str = Field(min_length=1, max_length=60)
    role: Literal["admin", "member"] = "member"


class RoleIn(BaseModel):
    role: Literal["admin", "member"]


# --------------------------------------------------------------------------- helpers


def client_id(request: Request) -> str:
    return request.client.host if request.client else "unknown"


LOCAL_NETWORKS = [
    ipaddress.ip_network(n)
    for n in (
        "127.0.0.0/8",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16",
        "::1/128",
        "fc00::/7",
        "fe80::/10",
    )
]


def is_local_client(request: Request) -> bool:
    """Request from the own network (LAN, Docker network, localhost)?"""
    try:
        ip = ipaddress.ip_address(client_id(request))
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return any(ip in net for net in LOCAL_NETWORKS)


def setup_code() -> str:
    """One-time code for the first setup from outside the own network (shown in the container log).

    Without it, whoever reaches a freshly started, internet-facing instance first would become admin.
    """
    path = settings.data_dir / "setup-code.txt"
    if not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(new_setup_code())
        os.chmod(path, 0o600)
    return path.read_text().strip()


def log_setup_code() -> None:
    if not vault.initialized:
        log.warning(
            "Contractly ist noch nicht eingerichtet. Einrichtungscode für den Zugriff von außerhalb "
            "des eigenen Netzwerks: %s",
            setup_code(),
        )


def current_user_id(request: Request) -> str:
    uid = getattr(request.state, "user_id", None)
    if not uid:
        raise HTTPException(401, "auth_required")
    return uid


def require_admin(request: Request) -> str:
    uid = current_user_id(request)
    if vault.user(uid)["role"] != "admin":
        raise HTTPException(403, "Nur für Administratoren")
    return uid


def _start_session(request: Request, response: Response, user: dict, remember: bool) -> None:
    open_user_area(user["id"])
    token, max_age = vault.create_session(user["id"], remember)
    response.set_cookie(
        COOKIE,
        token,
        max_age=max_age or None,
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
        path="/",
    )


def open_user_area(user_id: str) -> None:
    """Open the user's encrypted database; migrate data from versions without encryption."""
    from ..backup import migrate_legacy_data

    if not database.is_open(user_id):
        migrate_legacy_data(user_id)
        database.open_database(user_id, vault.db_key(user_id))
        from .documents import cleanup_unassigned

        token = database.current_user.set(user_id)
        try:
            with database.session(user_id) as db:
                cleanup_unassigned(db)
        finally:
            database.current_user.reset(token)


def _rate_limited(request: Request, username: str | None) -> list[str]:
    try:
        return vault.check_rate_limit(client_id(request), username)
    except VaultError as exc:
        raise HTTPException(429, "Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen") from exc


def _failed(request: Request, attempt: list[str]) -> None:
    # Same line for login, invitation, recovery and setup code: one fail2ban filter covers all.
    log.warning("failed login from %s", client_id(request))
    vault.record_failure(attempt)


def me(user_id: str) -> dict:
    u = vault.user(user_id)
    return {
        **public_user(u),
        "settings": u.get("settings", {}),
        "totp_enabled": bool(u.get("totp")),
        "api_token": bool(u.get("api_token")),
    }


# --------------------------------------------------------------------------- public


@router.get("/status")
def status(request: Request):
    uid = vault.session_user(request.cookies.get(COOKIE))
    return {
        "initialized": vault.initialized,
        "authenticated": uid is not None,
        "user": me(uid) if uid else None,
        "legacy_data": not vault.initialized and database.is_plaintext(settings.data_dir / "contractly.db"),
        "setup_code_required": not vault.initialized and not is_local_client(request),
        "min_password_length": MIN_PASSWORD_LENGTH,
    }


@router.post("/setup")
def setup(data: SetupIn, request: Request, response: Response):
    """Create the first (admin) account."""
    if vault.initialized:
        raise HTTPException(409, "Contractly ist bereits eingerichtet")
    if not is_local_client(request):
        attempt = _rate_limited(request, None)
        if not hmac.compare_digest(normalize_code(data.setup_code or ""), normalize_code(setup_code())):
            _failed(request, attempt)
            raise HTTPException(403, "Einrichtungscode falsch – er steht im Container-Log (docker logs contractly)")
    try:
        user, recovery = vault.setup(data.username, data.password)
    except VaultError as exc:
        raise HTTPException(400, str(exc)) from exc
    (settings.data_dir / "setup-code.txt").unlink(missing_ok=True)
    _start_session(request, response, user, remember=False)
    return {"recovery_key": recovery}


@router.post("/login")
def login(data: LoginIn, request: Request, response: Response):
    attempt = _rate_limited(request, data.username)
    try:
        user = vault.authenticate(data.username, data.password, data.totp)
    except TotpRequired as exc:
        raise HTTPException(401, "totp_required") from exc
    except InvalidCredentials as exc:
        _failed(request, attempt)
        raise HTTPException(401, "Benutzername oder Passwort falsch") from exc
    vault.clear_failures(attempt)
    _start_session(request, response, user, data.remember)
    # Tell the user about failed attempts since the last login (someone guessing the password?).
    return {
        "ok": True,
        "failed_logins": user.get("failed_logins", 0),
        "last_failed_login": user.get("last_failed_login"),
    }


@router.post("/activate")
def activate(data: ActivateIn, request: Request, response: Response):
    """Invited user: set the own password with the invitation code."""
    attempt = _rate_limited(request, data.username)
    try:
        user, recovery = vault.accept_invite(data.username, data.code, data.password)
    except InvalidCredentials as exc:
        _failed(request, attempt)
        raise HTTPException(401, "Benutzername oder Einladungscode falsch") from exc
    except VaultError as exc:
        raise HTTPException(400, str(exc)) from exc
    vault.clear_failures(attempt)
    _start_session(request, response, user, remember=False)
    return {"recovery_key": recovery}


@router.post("/recover")
def recover(data: RecoverIn, request: Request, response: Response):
    """Forgotten password: set a new one with the recovery key."""
    attempt = _rate_limited(request, data.username)
    try:
        user, recovery = vault.recover(data.username, data.recovery_key, data.new_password)
    except InvalidCredentials as exc:
        _failed(request, attempt)
        raise HTTPException(401, "Benutzername oder Wiederherstellungsschlüssel falsch") from exc
    except VaultError as exc:
        raise HTTPException(400, str(exc)) from exc
    vault.clear_failures(attempt)
    _start_session(request, response, user, remember=False)
    return {"recovery_key": recovery}


@router.post("/logout")
def logout(request: Request, response: Response):
    """End the session. With the last session the user's key is wiped from memory."""
    vault.end_session(request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


# --------------------------------------------------------------------------- own account


@router.get("/me")
def get_me(user_id: str = Depends(current_user_id)):
    return me(user_id)


@router.put("/me/settings")
def update_settings(data: AccountSettingsIn, user_id: str = Depends(current_user_id)):
    from ..reminders import ntfy_url_allowed, refresh_outbox

    if data.ntfy_url and not data.ntfy_url.startswith(("https://", "http://")):
        raise HTTPException(400, "Die ntfy-Adresse muss mit https:// beginnen")
    if data.ntfy_url and not ntfy_url_allowed(data.ntfy_url, vault.user(user_id)["role"] == "admin"):
        raise HTTPException(400, "Adressen im internen Netz kann nur ein Administrator eintragen")
    vault.update_settings(user_id, data.model_dump())
    refresh_outbox(user_id)
    return me(user_id)


@router.post("/change-password")
def change_password(
    data: ChangePasswordIn, request: Request, response: Response, user_id: str = Depends(current_user_id)
):
    try:
        vault.change_password(user_id, data.old_password, data.new_password)
    except InvalidCredentials as exc:
        raise HTTPException(400, "Aktuelles Passwort ist falsch") from exc
    except VaultError as exc:
        raise HTTPException(400, str(exc)) from exc
    # Other sessions were ended; keep this one signed in.
    token, _ = vault.create_session(user_id, remember=False)
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", secure=request.url.scheme == "https")
    return {"ok": True}


@router.post("/recovery-key")
def new_recovery_key(data: PasswordIn, user_id: str = Depends(current_user_id)):
    try:
        return {"recovery_key": vault.regenerate_recovery_key(user_id, data.password)}
    except InvalidCredentials as exc:
        raise HTTPException(400, "Passwort ist falsch") from exc


_pending_totp: dict[str, str] = {}


@router.post("/2fa/setup")
def totp_setup(user_id: str = Depends(current_user_id)):
    """Start 2FA setup: returns the secret as QR code for an authenticator app."""
    import segno

    secret = new_totp_secret()
    _pending_totp[user_id] = secret
    name = vault.user(user_id)["username"]
    uri = f"otpauth://totp/Contractly:{name}?secret={secret}&issuer=Contractly&digits=6&period=30"
    qr = segno.make(uri, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=5, dark="#111827", light="#ffffff", border=2)
    return {"secret": secret, "uri": uri, "qr_svg": buf.getvalue().decode()}


@router.post("/2fa/enable")
def totp_enable(data: CodeIn, user_id: str = Depends(current_user_id)):
    secret = _pending_totp.get(user_id)
    if not secret:
        raise HTTPException(400, "Bitte die Einrichtung neu starten")
    try:
        vault.enable_totp(user_id, secret, data.code)
    except InvalidCredentials as exc:
        raise HTTPException(400, "Der Code stimmt nicht – Uhrzeit des Handys prüfen und neuen Code eingeben") from exc
    _pending_totp.pop(user_id, None)
    return me(user_id)


@router.post("/2fa/disable")
def totp_disable(data: PasswordIn, user_id: str = Depends(current_user_id)):
    try:
        vault.disable_totp(user_id, data.password)
    except InvalidCredentials as exc:
        raise HTTPException(400, "Passwort ist falsch") from exc
    return me(user_id)


@router.post("/api-token")
def create_api_token(user_id: str = Depends(current_user_id)):
    """Read-only token for Home Assistant & co. (shown once)."""
    token = vault.create_api_token(user_id)
    from ..reminders import refresh_outbox

    refresh_outbox(user_id)  # writes the summary for the integration
    return {"token": token}


@router.delete("/api-token")
def revoke_api_token(user_id: str = Depends(current_user_id)):
    vault.revoke_api_token(user_id)
    from ..reminders import refresh_outbox

    refresh_outbox(user_id)
    return me(user_id)


@router.get("/calendar")
def calendar_link(user_id: str = Depends(current_user_id)):
    return {"token": vault.calendar_token(user_id)}


@router.post("/calendar")
def regenerate_calendar_link(user_id: str = Depends(current_user_id)):
    return {"token": vault.regenerate_calendar_token(user_id)}


# --------------------------------------------------------------------------- admin: users


@users_router.get("")
def list_users(_admin: str = Depends(require_admin)):
    return [public_user(u) for u in vault.users()]


@users_router.post("", status_code=201)
def invite_user(data: InviteIn, _admin: str = Depends(require_admin)):
    try:
        user, code = vault.invite(data.username, data.role)
    except VaultError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"user": public_user(user), "code": code}


@users_router.post("/{user_id}/invite")
def renew_invite(user_id: str, _admin: str = Depends(require_admin)):
    try:
        code = vault.renew_invite(user_id)
    except VaultError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"user": public_user(vault.user(user_id)), "code": code}


@users_router.put("/{user_id}/role")
def set_role(user_id: str, data: RoleIn, admin: str = Depends(require_admin)):
    if user_id == admin:
        raise HTTPException(400, "Die eigene Rolle kann nicht geändert werden")
    vault.set_role(user_id, data.role)
    return public_user(vault.user(user_id))


@users_router.delete("/{user_id}", status_code=204)
def delete_user(user_id: str, admin: str = Depends(require_admin)):
    """Delete a user including all of their (encrypted) data."""
    if user_id == admin:
        raise HTTPException(400, "Du kannst dich nicht selbst löschen")
    try:
        vault.user(user_id)
    except VaultError as exc:
        raise HTTPException(404, str(exc)) from exc
    vault.delete_user(user_id)
    shutil.rmtree(database.user_dir(user_id), ignore_errors=True)
    return Response(status_code=204)
