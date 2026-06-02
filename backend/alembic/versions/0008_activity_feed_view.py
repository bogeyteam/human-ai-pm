"""activity_feed_view

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-13
"""

from pathlib import Path

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    op.execute(_SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("drop view if exists public.activity_feed;")
