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
import sqlite3
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


def db_path() -> Path:
    if database.engine is None or database.engine.url.get_backend_name() != "sqlite":
        raise BackupError("Backups werden nur für SQLite unterstützt")
    return Path(database.engine.url.database)


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
    """Consistent ZIP of the database (via SQLite online backup) and all documents."""
    buf = io.BytesIO()
    with tempfile.TemporaryDirectory() as tmp:
        snapshot = Path(tmp) / "contractly.db"
        src = sqlite3.connect(db_path())
        dst = sqlite3.connect(snapshot)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(snapshot, "contractly.db")
            doc_count = 0
            for f in sorted(settings.documents_dir.glob("*")):
                if f.is_file():
                    zf.write(f, f"documents/{f.name}")
                    doc_count += 1
            manifest = {
                "app": "contractly",
                "version": APP_VERSION,
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


def restore(blob: bytes, passphrase: str | None = None) -> dict:
    """Replace database and documents with the content of a backup file."""
    if is_encrypted(blob):
        if not passphrase:
            raise BackupError("Diese Sicherung ist verschlüsselt – bitte Schlüssel angeben")
        blob = decrypt(blob, passphrase)
    try:
        zf = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as exc:
        raise BackupError("Datei ist keine gültige Contractly-Sicherung") from exc

    with zf, tempfile.TemporaryDirectory(dir=settings.data_dir) as tmp:
        names = zf.namelist()
        if "contractly.db" not in names:
            raise BackupError("Sicherung enthält keine Datenbank")
        tmp_path = Path(tmp)
        new_db = tmp_path / "contractly.db"
        new_db.write_bytes(zf.read("contractly.db"))
        check = sqlite3.connect(new_db)
        try:
            ok = check.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            has_table = check.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='contracts'").fetchone()
        finally:
            check.close()
        if not ok or not has_table:
            raise BackupError("Datenbank in der Sicherung ist beschädigt")

        new_docs = tmp_path / "documents"
        new_docs.mkdir()
        doc_count = 0
        for name in names:
            if name.startswith("documents/") and not name.endswith("/"):
                fname = Path(name).name
                if not fname or fname.startswith("."):
                    continue
                (new_docs / fname).write_bytes(zf.read(name))
                doc_count += 1

        # Safety net: keep the current state before overwriting it.
        create_backup(suffix="-pre-restore")

        target = db_path()
        database.engine.dispose()
        for extra in ("-wal", "-shm"):
            Path(str(target) + extra).unlink(missing_ok=True)
        shutil.copyfile(new_db, target)
        old_docs = settings.documents_dir
        shutil.rmtree(old_docs, ignore_errors=True)
        shutil.copytree(new_docs, old_docs)
        database.init_db(str(database.engine.url))
    return {"documents": doc_count}


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
    if not _due(now or datetime.now()):
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
