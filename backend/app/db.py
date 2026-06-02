"""Async SQLAlchemy engine + session factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.settings import get_settings


def _engine_url() -> str:
    url = get_settings().database_url
    if not url:
        # M1 left this blank — user must fetch DB password from
        # Supabase dashboard before any endpoint that touches the
        # DB will work. /healthz and /llm/ping don't need it.
        raise RuntimeError(
            "DATABASE_URL is empty. Set it in .env — see comments in .env for the URL "
            "(reset DB password at supabase dashboard → settings → database)."
        )
    return url


_engine = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _ensure_engine() -> None:
    global _engine, _session_factory
    if _engine is None:
        _engine = create_async_engine(
            _engine_url(),
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            echo=False,
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Context-managed session — commits on exit, rolls back on error."""
    _ensure_engine()
    if _session_factory is None:  # pragma: no cover — _ensure_engine guarantees this
        raise RuntimeError("Session factory failed to initialize.")
    async with _session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency — yields a session, handles commit/rollback."""
    async with session_scope() as session:
        yield session
