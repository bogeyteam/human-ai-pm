"""workspace_invites

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-13
"""

from pathlib import Path

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    op.execute(_SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        """
        drop function if exists public.accept_workspace_invite(text);
        drop table if exists public.workspace_invites cascade;
        """
    )
