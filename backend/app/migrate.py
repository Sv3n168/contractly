"""Database schema migrations (Alembic), applied to every user database when it is opened."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import inspect

MIGRATIONS = Path(__file__).parent / "migrations"
BASELINE = "0001"


def alembic_config(connection=None) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


def upgrade(engine) -> None:
    """Bring a database to the newest schema.

    Databases created before migrations existed (tables present, no version) are
    stamped with the baseline first, then upgraded normally.
    """
    with engine.begin() as conn:
        current = MigrationContext.configure(conn).get_current_revision()
        cfg = alembic_config(conn)
        if current is None and inspect(conn).has_table("contracts"):
            command.stamp(cfg, BASELINE)
        command.upgrade(cfg, "head")
