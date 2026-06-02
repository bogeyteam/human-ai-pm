"""FastAPI entry point.

Routes wire up incrementally per milestone:
  M2 — /healthz, /llm/ping
  M3 — /workspaces, /projects, /users (CRUD)
  M4 — /tasks, /artifacts, /decisions
  M5 — POST /projects/:id/generate_tasks
  M6 — /findings
  M7 — /optimizer
  M8 — /integrations/feishu/webhook
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    artifacts,
    brief,
    coaching,
    findings,
    generate,
    healthz,
    insights,
    llm_ping,
    meetings,
    optimizer,
    questions,
)
from app.middleware.logging import StructuredLoggingMiddleware, configure_json_logging
from app.middleware.rate_limit import RateLimitMiddleware
from app.settings import get_settings
from app.workers.weekly_optimizer import make_scheduler

# Install the JSON formatter on the root logger before any other module
# emits its first log line.
configure_json_logging(level=get_settings().app_log_level)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # APScheduler (M7). `make_scheduler()` is prod-gated internally — no cron
    # jobs are registered outside production, so `.start()` is a no-op there.
    scheduler = make_scheduler()
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


def _allowed_origins() -> list[str]:
    s = get_settings()
    extra = [o.strip() for o in s.cors_origins.split(",") if o.strip()]
    if s.app_env == "development":
        return ["http://localhost:3000", *extra]
    return extra


def create_app() -> FastAPI:
    app = FastAPI(
        title="AI Manager Platform",
        version="0.1.0",
        lifespan=lifespan,
    )

    # Middleware order (Starlette runs them outside-in, so the LAST added
    # wraps the request first — but we declare them top-down here for
    # readability). Effective request flow:
    #   client → CORS → StructuredLogging → RateLimit → routers
    # Logging records the 429 response correctly because it wraps RateLimit.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(StructuredLoggingMiddleware)
    app.add_middleware(RateLimitMiddleware)

    app.include_router(healthz.router)
    app.include_router(llm_ping.router)
    app.include_router(generate.router)
    app.include_router(findings.router)
    app.include_router(optimizer.router)
    app.include_router(meetings.router)
    app.include_router(coaching.router)
    app.include_router(artifacts.router)
    app.include_router(brief.router)
    app.include_router(insights.router)
    app.include_router(questions.router)

    return app


app = create_app()
