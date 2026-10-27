"""fixed partner contribution instead of a percentage

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-27 18:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("contracts") as batch:
        batch.add_column(sa.Column("partner_amount", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("contracts") as batch:
        batch.drop_column("partner_amount")
