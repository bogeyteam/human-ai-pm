"""App configuration. Loads from .env at repo root and process env."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", REPO_ROOT / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── App
    app_env: str = "development"
    app_log_level: str = "INFO"
    backend_port: int = 8000
    # Comma-separated list of allowed frontend origins for CORS.
    # Set in production to "https://your-frontend.vercel.app,https://app.fanpo.co".
    # In development the localhost origin is added automatically.
    cors_origins: str = ""

    # ── Supabase
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    database_url: str = ""

    # ── LLM providers
    moonshot_api_key: str = ""
    moonshot_base_url: str = "https://api.moonshot.cn/v1"
    qwen_api_key: str = ""
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    anthropic_api_key: str = ""

    # ── Cost cap (per-workspace, per-day, USD). Default $2/day.
    default_daily_llm_budget_usd: float = Field(default=2.00, ge=0)

    # ── Rate limits on LLM-consuming endpoints (in-process counters).
    rate_limit_user_per_min: int = Field(default=10, ge=1)
    rate_limit_workspace_per_min: int = Field(default=30, ge=1)
    rate_limit_workspace_per_hour: int = Field(default=100, ge=1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
