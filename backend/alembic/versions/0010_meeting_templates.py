"""meeting_templates

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-14

M16 — recurring meeting templates. Adds the `meeting_templates` table and
a `template_id` FK column on `meetings` so spawned instances link back
to their blueprint.
"""

from pathlib import Path

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    op.execute(_SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("alter table public.meetings drop column if exists template_id;")
    op.execute("drop table if exists public.meeting_templates cascade;")
