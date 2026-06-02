"""storage_buckets

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-13
"""

from pathlib import Path

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    op.execute(_SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        """
        drop policy if exists "workspace members can delete their own artifact files" on storage.objects;
        drop policy if exists "workspace members can upload artifact files" on storage.objects;
        drop policy if exists "workspace members can read artifact files" on storage.objects;
        delete from storage.buckets where id = 'artifacts';
        """
    )
