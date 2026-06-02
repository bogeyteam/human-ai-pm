"""Structured JSON request logging middleware.

Production debugging on Railway needs correlation IDs and one-line JSON per
request. This middleware:

  * Generates a uuid4 `request_id` and exposes it as `X-Request-ID`
  * Pulls `sub` (user_id) from a Bearer JWT *without verification* — purely
    for log correlation. A malformed/missing token logs `user_id=null`.
  * Logs one JSON line to stdout per request with: timestamp, request_id,
    method, path, status, latency_ms, user_id, level.
  * Maps response status → log level: 5xx=error, 4xx=warning, else info.

No new deps. Uses stdlib `logging` + `json` + `uuid` + PyJWT (already pinned).
"""

from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from datetime import UTC, datetime

import jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

log = logging.getLogger("app.request")


class _JsonFormatter(logging.Formatter):
    """Emits each record as a single JSON line.

    The middleware stuffs the structured payload onto the record via
    ``extra={"payload": {...}}``; we surface that as the top-level body
    instead of formatter-string-interpolated `%(message)s`.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload = getattr(record, "payload", None)
        if isinstance(payload, dict):
            return json.dumps(payload, separators=(",", ":"), default=str)
        # Fallback for non-middleware logs — still emit JSON.
        return json.dumps(
            {
                "timestamp": datetime.now(UTC).isoformat(),
                "level": record.levelname.lower(),
                "logger": record.name,
                "message": record.getMessage(),
            },
            separators=(",", ":"),
            default=str,
        )


def configure_json_logging(level: str = "INFO") -> None:
    """Install the JSON formatter on the root logger.

    Idempotent: calling twice won't double-attach handlers. We replace any
    pre-existing handlers so uvicorn's default plaintext handler doesn't
    duplicate every line.
    """
    root = logging.getLogger()
    root.setLevel(level.upper())
    # Drop existing handlers (uvicorn installs its own) — we want JSON only.
    for h in list(root.handlers):
        root.removeHandler(h)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root.addHandler(handler)


def _extract_user_id(authorization: str | None) -> str | None:
    """Best-effort `sub` claim extraction. No signature verification — this
    is purely for log correlation, NOT auth. Returns None on any failure.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        # `verify_signature=False` + no audience check — we accept any
        # well-formed JWT and just read the claim.
        claims = jwt.decode(
            token,
            options={"verify_signature": False, "verify_aud": False, "verify_exp": False},
        )
    except Exception:  # noqa: BLE001 — malformed tokens must not crash logging.
        return None
    sub = claims.get("sub")
    return str(sub) if sub else None


class StructuredLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        request_id = str(uuid.uuid4())
        start = time.perf_counter()
        user_id = _extract_user_id(request.headers.get("authorization"))

        # Stash on request.state so downstream handlers can read the correlation ID.
        request.state.request_id = request_id
        request.state.user_id = user_id

        status_code = 500  # default in case call_next raises before producing a response
        response: Response | None = None
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            latency_ms = round((time.perf_counter() - start) * 1000, 2)
            if status_code >= 500:
                level = logging.ERROR
                level_name = "error"
            elif status_code >= 400:
                level = logging.WARNING
                level_name = "warning"
            else:
                level = logging.INFO
                level_name = "info"

            payload = {
                "timestamp": datetime.now(UTC).isoformat(),
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": status_code,
                "latency_ms": latency_ms,
                "user_id": user_id,
                "level": level_name,
            }
            log.log(level, "request", extra={"payload": payload})

            if response is not None:
                response.headers["X-Request-ID"] = request_id
