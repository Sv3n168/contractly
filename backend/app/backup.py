"""Full backups (database + documents) with optional encryption and rclone cloud upload.

Backup file layout: a ZIP archive containing ``contractly.db``, ``documents/*`` and
``manifest.json``. Encrypted backups wrap that ZIP as::

    MAGIC (8 bytes) | salt (16) | nonce (12) | AES-256-GCM ciphertext

with the key derived from the passphrase via scrypt.
"""

import asyncio
import io
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from . import db as database
from .config import settings
from .security import encrypt_bytes, vault

log = logging.getLogger("contractly.backup")

MAGIC = b"CTLYENC1"
NAME_RE = re.compile(r"^contractly-backup-[0-9T\-]+(-auto|-pre-restore)?\.(zip|ctly)$")
APP_VERSION = "1.0.0"


class BackupError(Exception):
    pass


# --------------------------------------------------------------------------- crypto


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(passphrase.encode("utf-8"))


def encrypt(data: bytes, passphrase: str) -> bytes:
    salt, nonce = os.urandom(16), os.urandom(12)
    return MAGIC + salt + nonce + AESGCM(_derive_key(passphrase, salt)).encrypt(nonce, data, MAGIC)


def decrypt(blob: bytes, passphrase: str) -> bytes:
    if not blob.startswith(MAGIC):
        raise BackupError("Keine verschlüsselte Contractly-Sicherung")
    salt, nonce, body = blob[8:24], blob[24:36], blob[36:]
    try:
        return AESGCM(_derive_key(passphrase, salt)).decrypt(nonce, body, MAGIC)
    except InvalidTag as exc:
        raise BackupError("Falscher Schlüssel oder beschädigte Datei") from exc


def is_encrypted(blob: bytes) -> bool:
    return blob.startswith(MAGIC)


# --------------------------------------------------------------------------- paths


def backup_file(name: str) -> Path:
    if not NAME_RE.match(name):
        raise BackupError("Ungültiger Dateiname")
    path = settings.backup_dir / name
    if not path.is_file():
        raise BackupError("Sicherung nicht gefunden")
    return path


def list_backups() -> list[dict]:
    settings.backup_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for p in settings.backup_dir.iterdir():
        if p.is_file() and NAME_RE.match(p.name):
            stat = p.stat()
            items.append(
                {
                    "name": p.name,
                    "size": stat.st_size,
                    "created_at": datetime.fromtimestamp(stat.st_mtime).replace(microsecond=0),
                    "encrypted": p.suffix == ".ctly",
                    "automatic": "-auto" in p.name,
                }
            )
    return sorted(items, key=lambda i: i["created_at"], reverse=True)


# --------------------------------------------------------------------------- create / restore


def build_archive() -> bytes:
    """ZIP of the whole instance: user list and every user's area (database, documents).

    The user areas stay encrypted with the users' own keys – making a backup does not
    require (or grant) access to anybody's data. A restored user logs in with the
    password that was valid when the backup was made.
    """
    buf = io.BytesIO()
    users_root = settings.data_dir / "users"
    with (
        tempfile.TemporaryDirectory(dir=settings.data_dir) as tmp,
        zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf,
    ):
        zf.write(vault.path, "users.json")
        doc_count = 0
        for user in vault.users():
            uid = user["id"]
            area = users_root / uid
            db_file = area / "contractly.db"
            if database.is_open(uid):
                # Consistent snapshot of a database that is in use.
                snapshot = Path(tmp) / f"{uid}.db"
                key = vault.db_key(uid)
                src, dst = database.connect(db_file, key), database.connect(snapshot, key)
                try:
                    src.backup(dst)
                finally:
                    dst.close()
                    src.close()
                zf.write(snapshot, f"users/{uid}/contractly.db")
            elif db_file.is_file():
                zf.write(db_file, f"users/{uid}/contractly.db")  # closed (checkpointed) file
            if (area / "outbox.json").is_file():
                zf.write(area / "outbox.json", f"users/{uid}/outbox.json")
            for f in sorted((area / "documents").glob("*")) if (area / "documents").is_dir() else []:
                if f.is_file():
                    zf.write(f, f"users/{uid}/documents/{f.name}")
                    doc_count += 1
        manifest = {
            "app": "contractly",
            "version": APP_VERSION,
            "format": 3,
            "encrypted_at_rest": True,
            "users": len(vault.users()),
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "documents": doc_count,
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
    return buf.getvalue()


def create_backup(passphrase: str | None = None, suffix: str = "") -> Path:
    settings.backup_dir.mkdir(parents=True, exist_ok=True)
    data = build_archive()
    ext = "zip"
    if passphrase:
        data = encrypt(data, passphrase)
        ext = "ctly"
    stamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    path = settings.backup_dir / f"contractly-backup-{stamp}{suffix}.{ext}"
    tmp = path.with_suffix(".partial")
    tmp.write_bytes(data)
    tmp.replace(path)
    return path


def _safe_member(name: str) -> bool:
    parts = Path(name).parts
    return not name.startswith("/") and ".." not in parts and all(p and not p.startswith(".") for p in parts)


def restore(blob: bytes, passphrase: str | None = None, restoring_user: str | None = None) -> dict:
    """Restore a backup.

    * Full instance backups (format 3) replace all users and their data. Afterwards everybody
      is logged out and logs in with the password valid at backup time.
    * Backups of the old single-user version without encryption are imported into the
      area of ``restoring_user`` and encrypted with their key.
    """
    if is_encrypted(blob):
        if not passphrase:
            raise BackupError("Diese Sicherung ist mit einem Backup-Schlüssel verschlüsselt – bitte angeben")
        blob = decrypt(blob, passphrase)
    try:
        zf = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as exc:
        raise BackupError("Datei ist keine gültige Contractly-Sicherung") from exc

    with zf, tempfile.TemporaryDirectory(dir=settings.data_dir) as tmp:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        if not all(_safe_member(n) for n in names):
            raise BackupError("Ungültige Dateinamen in der Sicherung")
        tmp_path = Path(tmp)

        if "users.json" in names:
            try:
                users = json.loads(zf.read("users.json"))["users"]
            except (KeyError, ValueError) as exc:
                raise BackupError("Benutzerliste der Sicherung ist beschädigt") from exc
            if not any(u.get("role") == "admin" and u.get("status") == "active" for u in users):
                raise BackupError("Sicherung enthält keinen aktiven Administrator")
            zf.extractall(tmp_path, [n for n in names if n.startswith("users/")])
            create_backup(suffix="-pre-restore")
            vault.lock_all()
            database.close_all()
            shutil.rmtree(settings.data_dir / "users", ignore_errors=True)
            if (tmp_path / "users").is_dir():
                shutil.move(str(tmp_path / "users"), settings.data_dir / "users")
            tmp_users = tmp_path / "users.json"
            tmp_users.write_bytes(zf.read("users.json"))
            os.chmod(tmp_users, 0o600)
            tmp_users.replace(vault.path)
            docs = sum(1 for n in names if "/documents/" in n)
            return {"documents": docs, "users": len(users), "relogin": True}

        if "contractly.db" not in names:
            raise BackupError("Sicherung enthält keine Datenbank")
        # Old single-user backup without encryption at rest
        if not restoring_user:
            raise BackupError("Bitte angemeldet wiederherstellen")
        new_db = tmp_path / "contractly.db"
        new_db.write_bytes(zf.read("contractly.db"))
        if not database.is_plaintext(new_db) or not _check_database(new_db, None):
            raise BackupError("Datenbank in der Sicherung ist beschädigt")
        create_backup(suffix="-pre-restore")
        uid = restoring_user
        database.close_database(uid)
        target = database.db_path(uid)
        database.encrypt_plaintext_database(new_db, target, vault.db_key(uid))
        docs_dir = database.documents_dir(uid)
        shutil.rmtree(docs_dir, ignore_errors=True)
        docs_dir.mkdir(parents=True)
        key = vault.file_key(uid)
        doc_count = 0
        for name in names:
            if name.startswith("documents/"):
                fname = Path(name).name
                (docs_dir / fname).write_bytes(encrypt_bytes(zf.read(name), key, fname.encode()))
                doc_count += 1
        database.open_database(uid, vault.db_key(uid))
        return {"documents": doc_count, "users": 1, "relogin": False}


def _check_database(path: Path, key: bytes | None) -> bool:
    try:
        conn = database.connect(path, key)
        try:
            ok = conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            has_table = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='contracts'").fetchone()
            return bool(ok and has_table)
        finally:
            conn.close()
    except Exception:  # noqa: BLE001 - wrong key surfaces as "file is not a database"
        return False


def migrate_legacy_data(user_id: str) -> bool:
    """Move data of the old single-user version (plaintext) into the first admin's encrypted area.

    The plaintext originals are removed afterwards.
    """
    legacy_db = settings.data_dir / "contractly.db"
    if not database.is_plaintext(legacy_db) or vault.user(user_id)["role"] != "admin":
        return False
    target = database.db_path(user_id)
    if target.exists():
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    log.info("migrating unencrypted data into the encrypted area of %s", user_id)
    database.encrypt_plaintext_database(legacy_db, target, vault.db_key(user_id))
    legacy_docs = settings.data_dir / "documents"
    if legacy_docs.is_dir():
        docs_dir = database.documents_dir(user_id)
        key = vault.file_key(user_id)
        for f in legacy_docs.iterdir():
            if f.is_file():
                data = f.read_bytes()
                if not data.startswith(b"CTLYDOC1"):
                    data = encrypt_bytes(data, key, f.name.encode())
                (docs_dir / f.name).write_bytes(data)
        shutil.rmtree(legacy_docs, ignore_errors=True)
    for suffix in ("", "-wal", "-shm"):
        Path(str(legacy_db) + suffix).unlink(missing_ok=True)
    return True


# --------------------------------------------------------------------------- cloud (rclone)


def rclone_available() -> bool:
    return shutil.which("rclone") is not None


def cloud_status() -> dict:
    return {
        "remote": settings.backup_remote or None,
        "rclone": rclone_available(),
        "configured": bool(settings.backup_remote and rclone_available()),
    }


def upload(path: Path) -> None:
    if not settings.backup_remote:
        raise BackupError("Kein Cloud-Ziel konfiguriert (CONTRACTLY_BACKUP_REMOTE)")
    if not rclone_available():
        raise BackupError("rclone ist nicht installiert")
    proc = subprocess.run(
        ["rclone", "copy", str(path), settings.backup_remote],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if proc.returncode != 0:
        log.error("rclone failed: %s", proc.stderr.strip())
        raise BackupError(f"Upload fehlgeschlagen: {proc.stderr.strip()[-300:]}")


def prune(keep: int) -> None:
    autos = [b for b in list_backups() if b["automatic"]]
    for old in autos[keep:]:
        (settings.backup_dir / old["name"]).unlink(missing_ok=True)


# --------------------------------------------------------------------------- schedule


def _due(now: datetime) -> bool:
    interval = {"daily": timedelta(days=1), "weekly": timedelta(days=7)}.get(settings.backup_schedule)
    if interval is None:
        return False
    autos = [b for b in list_backups() if b["automatic"]]
    return not autos or now - autos[0]["created_at"] >= interval


def run_scheduled(now: datetime | None = None) -> Path | None:
    # Works while users are logged out: their areas are copied in encrypted form.
    if not vault.initialized or not _due(now or datetime.now()):
        return None
    path = create_backup(settings.backup_passphrase or None, suffix="-auto")
    log.info("automatic backup created: %s", path.name)
    if settings.backup_remote:
        try:
            upload(path)
            log.info("automatic backup uploaded to %s", settings.backup_remote)
        except BackupError:
            log.exception("automatic backup upload failed")
    prune(max(settings.backup_keep, 1))
    return path


async def backup_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(run_scheduled)
        except Exception:  # noqa: BLE001 - never crash the app
            log.exception("scheduled backup failed")
        await asyncio.sleep(3600)
