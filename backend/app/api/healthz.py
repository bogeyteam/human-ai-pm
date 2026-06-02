"""Liveness + readiness probe. Always returns 200 unless the process is dead."""

from fastapi import APIRouter

from app.settings import get_settings

router = APIRouter(tags=["meta"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    s = get_settings()
    return {
        "status": "ok",
        "app_env": s.app_env,
        "supabase_url": s.supabase_url,
    }
