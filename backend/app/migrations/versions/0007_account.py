"""account a contract is paid from

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-27 19:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("contracts") as batch:
        batch.add_column(sa.Column("account", sa.String(length=60), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("contracts") as batch:
        batch.drop_column("account")
