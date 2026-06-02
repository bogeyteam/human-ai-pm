"""FastAPI dependencies — auth (Supabase JWT verify) and workspace context.

Supabase migrated to asymmetric JWT signing (RS256/ES256) per project.
We verify against the project's published JWKS, falling back to the
legacy HS256 path if SUPABASE_JWT_SECRET is set AND no JWKS keys
resolve the token. That keeps both new (post-migration) and old
projects working.
"""

from dataclasses import dataclass
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.settings import get_settings


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: UUID
    email: str
    workspace_id: UUID | None


@lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    """One-shot JWKS client. PyJWKClient caches signing keys internally
    (default 300s TTL), so it's safe to re-use across requests.
    """
    base = get_settings().supabase_url.rstrip("/")
    return PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json")


def _decode_token(token: str) -> dict:
    """Try JWKS (asymmetric) first; fall back to legacy HS256 if configured.

    Order matters: JWKS lookup will fail fast if the token has no matching
    `kid` in the JWKS, which is the case for legacy HS256 tokens.
    """
    settings = get_settings()

    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience="authenticated",
        )
    except (jwt.PyJWKClientError, jwt.InvalidAlgorithmError, jwt.DecodeError) as jwks_exc:
        if not settings.supabase_jwt_secret:
            raise jwks_exc
        # Legacy HS256 fallback — projects that still use the symmetric secret.
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )


async def current_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = _decode_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user_id = claims.get("sub")
    email = claims.get("email") or ""
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing `sub` claim.",
        )

    row = (
        await session.execute(
            text("select workspace_id from public.users where id = :uid"),
            {"uid": user_id},
        )
    ).first()
    workspace_id = UUID(str(row[0])) if (row is not None and row[0] is not None) else None

    return CurrentUser(id=UUID(user_id), email=email, workspace_id=workspace_id)
