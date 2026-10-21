"""Database schema migrations (Alembic), applied to every user database when it is opened."""

from functools import cache
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

MIGRATIONS = Path(__file__).parent / "migrations"
BASELINE = "0001"


def alembic_config(connection=None) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


@cache
def _baseline_schema() -> dict[str, tuple[str, dict[str, str]]]:
    """Tables of the baseline revision: name -> (CREATE statement, {column: type})."""
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        command.upgrade(alembic_config(conn), BASELINE)
        rows = conn.execute(text("SELECT name, sql FROM sqlite_master WHERE type='table'")).all()
        insp = inspect(conn)
        schema = {
            name: (sql, {c["name"]: str(c["type"]) for c in insp.get_columns(name)})
            for name, sql in rows
            if name != "alembic_version"
        }
    engine.dispose()
    return schema


def _complete_to_baseline(conn) -> None:
    """Databases from versions before migrations may lack tables/columns of the baseline."""
    insp = inspect(conn)
    existing = set(insp.get_table_names())
    for table, (create_sql, columns) in _baseline_schema().items():
        if table not in existing:
            conn.exec_driver_sql(create_sql)
            continue
        have = {c["name"] for c in insp.get_columns(table)}
        for column, type_ in columns.items():
            if column not in have:
                conn.exec_driver_sql(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {type_}')


def upgrade(engine) -> None:
    """Bring a database to the newest schema.

    Databases created before migrations existed (tables present, no version) are
    stamped with the baseline first, then upgraded normally.
    """
    with engine.begin() as conn:
        current = MigrationContext.configure(conn).get_current_revision()
        cfg = alembic_config(conn)
        if current is None and inspect(conn).has_table("contracts"):
            _complete_to_baseline(conn)
            command.stamp(cfg, BASELINE)
        command.upgrade(cfg, "head")
