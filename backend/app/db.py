"""Per-user encrypted SQLite (SQLCipher) databases.

Every user has an own database file and documents folder below
``<data>/users/<user id>/``. A database can only be opened with that user's key,
i.e. while the user is logged in.
"""

import threading
from collections.abc import Iterator
from contextvars import ContextVar
from pathlib import Path

import sqlcipher3.dbapi2 as sqlcipher
from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import QueuePool

from . import migrate
from .config import settings

SQLITE_HEADER = b"SQLite format 3\x00"

# The user whose data the current request / background job works on.
current_user: ContextVar[str | None] = ContextVar("current_user", default=None)


class Base(DeclarativeBase):
    pass


class DatabaseLocked(Exception):
    pass


# --------------------------------------------------------------------------- paths


def user_dir(user_id: str | None = None) -> Path:
    uid = user_id or current_user.get()
    if not uid:
        raise DatabaseLocked()
    return settings.data_dir / "users" / uid


def db_path(user_id: str | None = None) -> Path:
    return user_dir(user_id) / "contractly.db"


def require_user() -> str:
    uid = current_user.get()
    if not uid:
        raise DatabaseLocked()
    return uid


def file_key(user_id: str | None = None) -> bytes:
    """Document encryption key of the (current) user."""
    from .security import vault

    return vault.file_key(user_id or require_user())


def documents_dir(user_id: str | None = None) -> Path:
    path = user_dir(user_id) / "documents"
    path.mkdir(parents=True, exist_ok=True)
    return path


# --------------------------------------------------------------------------- connections


def connect(path: Path, key: bytes | None):
    """DB-API connection; ``key`` = raw 256-bit SQLCipher key, ``None`` = plaintext (migration only)."""
    conn = sqlcipher.connect(str(path), check_same_thread=False)
    if key is not None:
        conn.execute(f"PRAGMA key = \"x'{key.hex()}'\"")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def is_plaintext(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size == 0:
        return False
    with path.open("rb") as fh:
        return fh.read(16) == SQLITE_HEADER


def encrypt_plaintext_database(source: Path, target: Path, key: bytes) -> None:
    """Write an encrypted copy of an unencrypted database (older Contractly versions)."""
    tmp = target.with_name(target.name + ".encrypting")
    tmp.unlink(missing_ok=True)
    conn = connect(source, None)
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute(f"ATTACH DATABASE '{tmp}' AS encrypted KEY \"x'{key.hex()}'\"")
        conn.execute("SELECT sqlcipher_export('encrypted')")
        conn.execute("DETACH DATABASE encrypted")
    finally:
        conn.close()
    for suffix in ("-wal", "-shm"):
        Path(str(target) + suffix).unlink(missing_ok=True)
    tmp.replace(target)


# --------------------------------------------------------------------------- engines

_engines: dict[str, object] = {}
_makers: dict[str, sessionmaker] = {}
_lock = threading.RLock()


def open_database(user_id: str, key: bytes) -> None:
    from . import models  # noqa: F401  (register tables)

    with _lock:
        if user_id in _engines:
            return
        path = db_path(user_id)
        path.parent.mkdir(parents=True, exist_ok=True)

        def creator():
            conn = connect(path, key)
            conn.execute("PRAGMA journal_mode=WAL")
            return conn

        engine = create_engine("sqlite://", creator=creator, poolclass=QueuePool, pool_size=5, max_overflow=10)
        migrate.upgrade(engine)
        _engines[user_id] = engine
        _makers[user_id] = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def close_database(user_id: str) -> None:
    with _lock:
        engine = _engines.pop(user_id, None)
        _makers.pop(user_id, None)
    if engine is not None:
        # Checkpoint the WAL so the encrypted file is complete on its own.
        with engine.connect() as conn:
            conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
        engine.dispose()


def close_all() -> None:
    for uid in list(_engines):
        close_database(uid)


def is_open(user_id: str | None = None) -> bool:
    uid = user_id or current_user.get()
    return bool(uid) and uid in _engines


def open_users() -> list[str]:
    return list(_engines)


def session(user_id: str | None = None) -> Session:
    uid = user_id or current_user.get()
    maker = _makers.get(uid) if uid else None
    if maker is None:
        raise DatabaseLocked()
    return maker()


def get_db(request: Request) -> Iterator[Session]:
    uid = getattr(request.state, "user_id", None)
    if not uid:
        raise DatabaseLocked()
    current_user.set(uid)
    db = session(uid)
    try:
        yield db
    finally:
        db.close()
