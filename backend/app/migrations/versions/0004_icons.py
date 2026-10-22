"""own emoji for contracts and income sources

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-22 20:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("contracts") as batch:
        batch.add_column(sa.Column("icon", sa.String(length=16), nullable=True))
    with op.batch_alter_table("income_sources") as batch:
        batch.add_column(sa.Column("icon", sa.String(length=16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("income_sources") as batch:
        batch.drop_column("icon")
    with op.batch_alter_table("contracts") as batch:
        batch.drop_column("icon")
