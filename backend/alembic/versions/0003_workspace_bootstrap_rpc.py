"""workspace_bootstrap_rpc

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-13
"""

from pathlib import Path

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    op.execute(_SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("drop function if exists public.bootstrap_workspace(text, text);")
