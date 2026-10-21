"""Alembic environment: migrations run programmatically on an already open (encrypted) connection."""

from alembic import context

from app import models  # noqa: F401  (register tables)
from app.db import Base

config = context.config
target_metadata = Base.metadata


def run_migrations_online() -> None:
    connection = config.attributes["connection"]
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


run_migrations_online()
