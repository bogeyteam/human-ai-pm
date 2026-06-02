"""open_questions_engine

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-30

M21 — BET #4. Two coupled capabilities:
  * Open Question Engine: persistent, deduplicated, owner-routed queue of the
    project's decision-blocking unknowns. New table `open_questions`, mirroring
    the M6 `findings` shape (stable dedupe identity via source_task_id /
    source_decision_id, bilingual outreach drafts, blast_radius jsonb,
    situation embedding for pgvector dedupe).
  * Decision Closer: one minimal additive provenance column on `decisions`
    (`source_manager_action_id`) so a Confirm-written decision can backlink to
    the advisory manager_actions.output draft it came from.

Strictly additive — one new table + one nullable column + indexes. No DROP,
no rewrite of existing rows. Idempotent (if not exists / add column if not exists).
"""

from pathlib import Path

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    op.execute(_SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("drop table if exists public.open_questions cascade;")
    op.execute(
        "alter table public.decisions drop column if exists source_manager_action_id;"
    )
