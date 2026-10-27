"""contract names without the category appended

Older versions named a contract without an own name "<provider> <category>", e.g.
"Barmenia Zahnzusatz Sonstige Versicherung". The category is shown next to the name anyway,
so such names become just the provider. Only names that match that pattern exactly change.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-27 18:30:00
"""

import sqlalchemy as sa
from alembic import op

from app.categories import CATEGORY_MAP

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, name, provider, category FROM contracts WHERE provider IS NOT NULL"))
    for cid, name, provider, category in rows.fetchall():
        label = CATEGORY_MAP.get(category, {}).get("label")
        provider = (provider or "").strip()
        if label and provider and name == f"{provider} {label}":
            conn.execute(sa.text("UPDATE contracts SET name = :n WHERE id = :i"), {"n": provider, "i": cid})


def downgrade() -> None:
    pass
