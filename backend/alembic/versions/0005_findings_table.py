"""findings_table

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-13
"""

from pathlib import Path

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    op.execute(_SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("drop table if exists public.findings cascade;")
