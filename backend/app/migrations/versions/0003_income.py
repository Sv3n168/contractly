"""income sources and entries

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-22 12:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "income_sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("payer", sa.String(length=200), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "income_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("net", sa.Float(), nullable=False),
        sa.Column("gross", sa.Float(), nullable=True),
        sa.Column("interval", sa.String(length=20), nullable=False),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.ForeignKeyConstraint(["source_id"], ["income_sources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("income_entries", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_income_entries_source_id"), ["source_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("income_entries", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_income_entries_source_id"))
    op.drop_table("income_entries")
    op.drop_table("income_sources")
