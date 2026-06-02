"""artifact_tags

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-15

M20 — artifact organization. Adds `tags`, `artifact_tags`, `saved_views`
tables for flat-storage many-to-many tagging + user-saved filter views.
Strictly additive — existing data untouched.
"""

from pathlib import Path

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    op.execute(_SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("drop table if exists public.artifact_tags cascade;")
    op.execute("drop table if exists public.saved_views cascade;")
    op.execute("drop table if exists public.tags cascade;")
