"""Users, login sessions and encryption at rest.

Every user owns a completely separate, separately encrypted area (own SQLCipher
database, own documents). Key hierarchy per user (envelope encryption):

* a random 256-bit data key (DEK) encrypts the user's database and documents,
* the DEK is stored only *wrapped* in ``users.json`` – once with a key derived from
  the user's password (scrypt) and once with the user's recovery key.

The DEK is held in memory only while the user is logged in. Logging out (last
session) or a restart removes it; from then on nobody – not even an admin or the
server – can read the user's data until the user logs in again.

Admins invite users with a one-time code; the user sets the password (and thus the
key) on first login, so an admin never gets access to another user's data.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from .config import settings

STORE_VERSION = 2
SCRYPT_N = 2**16  # ~64 MB memory, ~0.3 s – fine for a login, expensive for brute force
DOC_MAGIC = b"CTLYDOC1"
MIN_PASSWORD_LENGTH = 10
INVITE_DAYS = 7
ROLES = ("admin", "member")


class VaultError(Exception):
    pass


class InvalidCredentials(VaultError):
    def __init__(self, msg: str = "invalid credentials"):
        super().__init__(msg)


# --------------------------------------------------------------------------- primitives


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _unb64(text: str) -> bytes:
    return base64.b64decode(text)


def _kdf(secret: str, salt: bytes, n: int = SCRYPT_N) -> bytes:
    return Scrypt(salt=salt, length=32, n=n, r=8, p=1).derive(secret.encode("utf-8"))


def _wrap(dek: bytes, secret: str) -> dict:
    salt, nonce = os.urandom(16), os.urandom(12)
    ct = AESGCM(_kdf(secret, salt)).encrypt(nonce, dek, b"contractly-dek")
    return {"kdf": "scrypt", "n": SCRYPT_N, "salt": _b64(salt), "nonce": _b64(nonce), "ct": _b64(ct)}


def _unwrap(wrapped: dict, secret: str) -> bytes:
    key = _kdf(secret, _unb64(wrapped["salt"]), wrapped.get("n", SCRYPT_N))
    try:
        return AESGCM(key).decrypt(_unb64(wrapped["nonce"]), _unb64(wrapped["ct"]), b"contractly-dek")
    except InvalidTag as exc:
        raise InvalidCredentials() from exc


def subkey(dek: bytes, purpose: str) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=purpose.encode()).derive(dek)


def _random_code(nbytes: int) -> str:
    raw = base64.b32encode(secrets.token_bytes(nbytes)).decode().rstrip("=")
    return "-".join(raw[i : i + 5] for i in range(0, len(raw), 5))


def new_recovery_key() -> str:
    return _random_code(25)


def normalize_code(text: str) -> str:
    raw = "".join(ch for ch in (text or "").upper() if ch.isalnum())
    return "-".join(raw[i : i + 5] for i in range(0, len(raw), 5))


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def validate_password(password: str) -> None:
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise VaultError(f"Das Passwort muss mindestens {MIN_PASSWORD_LENGTH} Zeichen lang sein")


def validate_username(username: str) -> str:
    name = (username or "").strip()
    if not (1 <= len(name) <= 60) or any(ch in name for ch in "/\\\n\r\t"):
        raise VaultError("Ungültiger Benutzername")
    return name


# --------------------------------------------------------------------------- file encryption


def encrypt_bytes(data: bytes, key: bytes, aad: bytes = b"") -> bytes:
    nonce = os.urandom(12)
    return DOC_MAGIC + nonce + AESGCM(key).encrypt(nonce, data, aad)


def decrypt_bytes(blob: bytes, key: bytes, aad: bytes = b"") -> bytes:
    if not blob.startswith(DOC_MAGIC):
        return blob  # legacy plaintext file (from before encryption was enabled)
    try:
        return AESGCM(key).decrypt(blob[8:20], blob[20:], aad)
    except InvalidTag as exc:
        raise VaultError("Datei konnte nicht entschlüsselt werden") from exc


def is_encrypted_file(path: Path) -> bool:
    with path.open("rb") as fh:
        return fh.read(len(DOC_MAGIC)) == DOC_MAGIC


# --------------------------------------------------------------------------- store


@dataclass
class Session:
    user_id: str
    expires: float
    ttl: float


class Vault:
    def __init__(self, path: Path | None = None):
        self._path = path
        self._keys: dict[str, bytes] = {}
        self._sessions: dict[str, Session] = {}
        self._lock = threading.RLock()
        self._failures: dict[str, list[float]] = {}
        # Called with a user id when that user's key is dropped (closes the database).
        self.on_lock: Callable[[str], None] | None = None

    # ----------------------------------------------------------------- persistence

    @property
    def path(self) -> Path:
        return self._path or settings.data_dir / "users.json"

    def _load(self) -> dict:
        if not self.path.is_file():
            return {"version": STORE_VERSION, "users": []}
        return json.loads(self.path.read_text())

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        os.chmod(tmp, 0o600)
        tmp.replace(self.path)

    def users(self) -> list[dict]:
        return self._load()["users"]

    def user(self, user_id: str) -> dict:
        for u in self.users():
            if u["id"] == user_id:
                return u
        raise VaultError("Benutzer nicht gefunden")

    def find(self, username: str) -> dict | None:
        name = (username or "").strip().lower()
        return next((u for u in self.users() if u["username"].lower() == name), None)

    def _update(self, user_id: str, fn: Callable[[dict], None]) -> dict:
        with self._lock:
            data = self._load()
            for u in data["users"]:
                if u["id"] == user_id:
                    fn(u)
                    self._save(data)
                    return u
        raise VaultError("Benutzer nicht gefunden")

    @property
    def initialized(self) -> bool:
        return any(u["role"] == "admin" and u.get("status") == "active" for u in self.users())

    # ----------------------------------------------------------------- keys

    def is_unlocked(self, user_id: str) -> bool:
        return user_id in self._keys

    def unlocked_users(self) -> list[str]:
        return list(self._keys)

    def key(self, user_id: str, purpose: str) -> bytes:
        dek = self._keys.get(user_id)
        if dek is None:
            raise VaultError("locked")
        return subkey(dek, purpose)

    def db_key(self, user_id: str) -> bytes:
        return self.key(user_id, "sqlcipher-database")

    def file_key(self, user_id: str) -> bytes:
        return self.key(user_id, "documents")

    def lock_user(self, user_id: str) -> None:
        """Forget the user's key and end all their sessions."""
        with self._lock:
            self._keys.pop(user_id, None)
            for token in [t for t, s in self._sessions.items() if s.user_id == user_id]:
                del self._sessions[token]
        if self.on_lock:
            self.on_lock(user_id)

    def lock_all(self) -> None:
        for uid in list(self._keys):
            self.lock_user(uid)
        with self._lock:
            self._sessions.clear()

    # ----------------------------------------------------------------- accounts

    def _new_user(self, username: str, role: str) -> dict:
        if role not in ROLES:
            raise VaultError("Unbekannte Rolle")
        username = validate_username(username)
        if self.find(username):
            raise VaultError("Benutzername ist bereits vergeben")
        return {
            "id": uuid.uuid4().hex[:12],
            "username": username,
            "role": role,
            "status": "invited",
            "created_at": int(time.time()),
            "settings": {"reveal_names": False, "notify_email": "", "ntfy_url": ""},
        }

    def _activate(self, user: dict, password: str) -> str:
        """Create the user's data key. Returns the recovery key."""
        validate_password(password)
        dek = secrets.token_bytes(32)
        recovery = new_recovery_key()
        calendar_token = secrets.token_urlsafe(24)
        user.update(
            {
                "status": "active",
                "password": _wrap(dek, password),
                "recovery": _wrap(dek, recovery),
                "calendar_token": _hash(calendar_token),
                "calendar_token_enc": _b64(encrypt_bytes(calendar_token.encode(), subkey(dek, "calendar"))),
                "activated_at": int(time.time()),
                "last_login": int(time.time()),
            }
        )
        user.pop("invite", None)
        self._keys[user["id"]] = dek
        return recovery

    def setup(self, username: str, password: str) -> tuple[dict, str]:
        """Create the first admin account."""
        with self._lock:
            if self.initialized:
                raise VaultError("already initialized")
            data = self._load()
            user = self._new_user(username, "admin")
            recovery = self._activate(user, password)
            data["users"].append(user)
            self._save(data)
        return user, recovery

    def invite(self, username: str, role: str = "member") -> tuple[dict, str]:
        """Admin: create a user that activates the account with a one-time code."""
        with self._lock:
            data = self._load()
            user = self._new_user(username, role)
            code = _random_code(10)
            user["invite"] = {"hash": _hash(normalize_code(code)), "expires": time.time() + INVITE_DAYS * 86400}
            data["users"].append(user)
            self._save(data)
        return user, code

    def renew_invite(self, user_id: str) -> str:
        code = _random_code(10)

        def fn(u):
            if u.get("status") != "invited":
                raise VaultError("Benutzer ist bereits aktiv")
            u["invite"] = {"hash": _hash(normalize_code(code)), "expires": time.time() + INVITE_DAYS * 86400}

        self._update(user_id, fn)
        return code

    def accept_invite(self, username: str, code: str, password: str) -> tuple[dict, str]:
        with self._lock:
            data = self._load()
            user = next((u for u in data["users"] if u["username"].lower() == username.strip().lower()), None)
            inv = (user or {}).get("invite")
            if not user or user.get("status") != "invited" or not inv:
                raise InvalidCredentials()
            if inv["expires"] < time.time():
                raise VaultError("Der Einladungscode ist abgelaufen – bitte beim Admin einen neuen anfordern")
            if not hmac.compare_digest(inv["hash"], _hash(normalize_code(code))):
                raise InvalidCredentials()
            recovery = self._activate(user, password)
            self._save(data)
        return user, recovery

    def delete_user(self, user_id: str) -> None:
        with self._lock:
            data = self._load()
            data["users"] = [u for u in data["users"] if u["id"] != user_id]
            self._save(data)
        self.lock_user(user_id)

    def set_role(self, user_id: str, role: str) -> None:
        if role not in ROLES:
            raise VaultError("Unbekannte Rolle")
        self._update(user_id, lambda u: u.__setitem__("role", role))

    def update_settings(self, user_id: str, values: dict) -> dict:
        def fn(u):
            u.setdefault("settings", {}).update(values)

        return self._update(user_id, fn)["settings"]

    # ----------------------------------------------------------------- login

    def authenticate(self, username: str, password: str) -> dict:
        user = self.find(username)
        if not user or user.get("status") != "active":
            # Spend the KDF time anyway so usernames can't be probed by timing.
            _kdf(password or "", b"0" * 16)
            raise InvalidCredentials()
        dek = _unwrap(user["password"], password)
        self._keys[user["id"]] = dek
        self._update(user["id"], lambda u: u.__setitem__("last_login", int(time.time())))
        return user

    def recover(self, username: str, recovery_key: str, new_password: str) -> tuple[dict, str]:
        """Forgotten password: set a new one with the recovery key. Returns a fresh recovery key."""
        validate_password(new_password)
        user = self.find(username)
        if not user or user.get("status") != "active":
            raise InvalidCredentials()
        dek = _unwrap(user["recovery"], normalize_code(recovery_key))
        new_recovery = new_recovery_key()

        def fn(u):
            u["password"] = _wrap(dek, new_password)
            u["recovery"] = _wrap(dek, new_recovery)

        self.lock_user(user["id"])  # end sessions that used the old password
        self._update(user["id"], fn)
        self._keys[user["id"]] = dek
        return user, new_recovery

    def change_password(self, user_id: str, old: str, new: str) -> None:
        validate_password(new)
        dek = _unwrap(self.user(user_id)["password"], old)
        self._update(user_id, lambda u: u.__setitem__("password", _wrap(dek, new)))
        with self._lock:
            for token in [t for t, s in self._sessions.items() if s.user_id == user_id]:
                del self._sessions[token]

    def regenerate_recovery_key(self, user_id: str, password: str) -> str:
        dek = _unwrap(self.user(user_id)["password"], password)
        recovery = new_recovery_key()
        self._update(user_id, lambda u: u.__setitem__("recovery", _wrap(dek, recovery)))
        return recovery

    # ----------------------------------------------------------------- calendar token

    def calendar_token(self, user_id: str) -> str:
        blob = _unb64(self.user(user_id)["calendar_token_enc"])
        return decrypt_bytes(blob, self.key(user_id, "calendar")).decode()

    def user_for_calendar_token(self, token: str) -> str | None:
        h = _hash(token)
        for u in self.users():
            if u.get("calendar_token") and hmac.compare_digest(u["calendar_token"], h):
                return u["id"]
        return None

    def regenerate_calendar_token(self, user_id: str) -> str:
        token = secrets.token_urlsafe(24)
        enc = _b64(encrypt_bytes(token.encode(), self.key(user_id, "calendar")))

        def fn(u):
            u["calendar_token"] = _hash(token)
            u["calendar_token_enc"] = enc

        self._update(user_id, fn)
        return token

    # ----------------------------------------------------------------- sessions

    def create_session(self, user_id: str, remember: bool) -> tuple[str, int]:
        ttl = settings.session_days_remember * 86400 if remember else settings.session_hours * 3600
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._sessions[_hash(token)] = Session(user_id, time.time() + ttl, ttl)
        return token, int(ttl) if remember else 0

    def session_user(self, token: str | None) -> str | None:
        """User id of a valid session (sliding expiry); None if invalid or the key is gone."""
        if not token:
            return None
        key = _hash(token)
        expired_user = None
        with self._lock:
            s = self._sessions.get(key)
            if s is None:
                return None
            now = time.time()
            if s.expires < now:
                del self._sessions[key]
                expired_user = s.user_id
            elif s.user_id in self._keys:
                s.expires = now + s.ttl
                return s.user_id
            else:
                return None
        self._drop_key_if_no_sessions(expired_user)
        return None

    def end_session(self, token: str | None) -> None:
        """Logout: end the session; the last session of a user also removes their key."""
        if not token:
            return
        with self._lock:
            s = self._sessions.pop(_hash(token), None)
        if s:
            self._drop_key_if_no_sessions(s.user_id)

    def _drop_key_if_no_sessions(self, user_id: str | None) -> None:
        if user_id is None:
            return
        with self._lock:
            if any(s.user_id == user_id for s in self._sessions.values()):
                return
        self.lock_user(user_id)

    def expire_sessions(self) -> None:
        now = time.time()
        with self._lock:
            expired = {s.user_id for s in self._sessions.values() if s.expires < now}
            for t in [t for t, s in self._sessions.items() if s.expires < now]:
                del self._sessions[t]
        for uid in expired:
            self._drop_key_if_no_sessions(uid)

    # ----------------------------------------------------------------- brute force protection

    def check_rate_limit(self, client: str) -> None:
        now = time.time()
        recent = [t for t in self._failures.get(client, []) if now - t < 900]
        self._failures[client] = recent
        if len(recent) >= 10:
            raise VaultError("too many attempts")

    def record_failure(self, client: str) -> None:
        self._failures.setdefault(client, []).append(time.time())
        time.sleep(min(len(self._failures[client]), 5) * 0.4)

    def clear_failures(self, client: str) -> None:
        self._failures.pop(client, None)


def public_user(u: dict) -> dict:
    return {
        "id": u["id"],
        "username": u["username"],
        "role": u["role"],
        "status": u.get("status", "active"),
        "created_at": u.get("created_at"),
        "last_login": u.get("last_login"),
        "invite_expires": int(u["invite"]["expires"]) if u.get("invite") else None,
    }


vault = Vault()
