"""Migration 0006: '<provider> <category>' names become just the provider."""

import sqlalchemy as sa
from alembic import command

from app.migrate import alembic_config


def test_auto_names_lose_the_category(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path}/t.db")
    with engine.begin() as conn:
        cfg = alembic_config(conn)
        command.upgrade(cfg, "0005")
        conn.execute(
            sa.text(
                "INSERT INTO contracts (id, name, provider, category, start_date, notice_unit, attributes, created_at, updated_at) VALUES "
                "(1, 'Barmenia Zahnzusatz Sonstige Versicherung', 'Barmenia Zahnzusatz', 'insurance',"
                " '2025-01-01', 'months', '{}', '2025-01-01', '2025-01-01'),"
                "(2, 'MagentaMobil M', 'Telekom', 'mobile', '2025-01-01', 'months', '{}', '2025-01-01', '2025-01-01'),"
                "(3, 'Telekom Mobilfunk Extra', 'Telekom', 'mobile', '2025-01-01', 'months', '{}', '2025-01-01', '2025-01-01')"
            )
        )
        command.upgrade(cfg, "head")
        names = dict(conn.execute(sa.text("SELECT id, name FROM contracts")).fetchall())
    assert names == {1: "Barmenia Zahnzusatz", 2: "MagentaMobil M", 3: "Telekom Mobilfunk Extra"}
