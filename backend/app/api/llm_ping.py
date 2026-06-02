"""LLM smoke-test endpoint. Round-trips Moonshot once."""

from fastapi import APIRouter, HTTPException

from app.llm import manager as llm

router = APIRouter(tags=["meta"], prefix="/llm")


@router.post("/ping")
async def ping() -> dict:
    """Returns provider, model, content, latency_ms. No auth, no DB writes —
    purely a smoke test that MOONSHOT_API_KEY is set and the model responds.
    Pull this from CI later (with a mock provider) for regression coverage.
    """
    try:
        return await llm.ping_provider()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
