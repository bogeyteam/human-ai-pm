"""initial_schema

Revision ID: 0001
Revises:
Create Date: 2026-05-13

Wraps the canonical SQL at `0001_initial_schema.sql` (read on disk so
the SQL file stays the single source of truth).

NOTE: at M1 these statements were applied directly via Supabase MCP.
Run `alembic stamp 0001` on a freshly-cloned dev DB to skip re-running.
"""

from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    sql = _SQL_FILE.read_text(encoding="utf-8")
    op.execute(sql)


def downgrade() -> None:
    # Destructive — drops everything. Only use on dev.
    op.execute(
        """
        drop table if exists public.manager_actions cascade;
        drop table if exists public.meetings cascade;
        drop table if exists public.coaching_sessions cascade;
        drop table if exists public.decisions cascade;
        drop table if exists public.messages cascade;
        drop table if exists public.artifacts cascade;
        drop table if exists public.task_dependencies cascade;
        drop table if exists public.tasks cascade;
        drop table if exists public.projects cascade;
        drop table if exists public.users cascade;
        drop table if exists public.workspaces cascade;
        drop function if exists public.current_workspace_id();
        drop function if exists public.handle_new_auth_user() cascade;
        """
    )
