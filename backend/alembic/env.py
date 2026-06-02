"""Alembic env — reads DATABASE_URL from app settings (which loads .env).

For migrations we use a synchronous psycopg connection (Alembic's
sync API is simpler and DDL doesn't need async). The runtime app
uses asyncpg via SQLAlchemy.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.settings import get_settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _sync_db_url() -> str:
    url = get_settings().database_url
    if not url:
        raise RuntimeError(
            "DATABASE_URL is empty. Set it in .env before running alembic."
        )
    # Alembic uses sync drivers. Swap asyncpg → psycopg if present.
    return url.replace("+asyncpg", "").replace("postgresql+psycopg", "postgresql")


def run_migrations_offline() -> None:
    context.configure(
        url=_sync_db_url(),
        target_metadata=None,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    cfg = config.get_section(config.config_ini_section) or {}
    cfg["sqlalchemy.url"] = _sync_db_url()
    connectable = engine_from_config(
        cfg,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
