"""harden_security

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-13

Wraps `0002_harden_security.sql`.
"""

from pathlib import Path

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    sql = _SQL_FILE.read_text(encoding="utf-8")
    op.execute(sql)


def downgrade() -> None:
    op.execute("alter extension vector set schema public;")
    op.execute(
        'drop policy if exists "users without a workspace can create one" on public.workspaces;'
    )
    op.execute(
        """
        create policy "any authenticated user can insert a workspace" on public.workspaces
          for insert to authenticated with check (true);
        """
    )
    op.execute("grant execute on function public.handle_new_auth_user() to authenticated;")
    op.execute("grant execute on function public.current_workspace_id() to anon;")
