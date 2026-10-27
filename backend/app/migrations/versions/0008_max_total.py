"""agreed total of a contract

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-27 21:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("contracts") as batch:
        batch.add_column(sa.Column("max_total", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("contracts") as batch:
        batch.drop_column("max_total")
