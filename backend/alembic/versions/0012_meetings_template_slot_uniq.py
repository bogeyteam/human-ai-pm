"""meetings_template_slot_uniq

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-29

A3 — idempotent recurring-meeting spawning. Adds a partial unique index on
(template_id, scheduled_at) so the spawner can `on conflict do nothing`,
collapsing duplicate ticks into a no-op. Strictly additive.
"""

from pathlib import Path

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    op.execute(_SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("drop index if exists public.meetings_template_slot_uniq;")
