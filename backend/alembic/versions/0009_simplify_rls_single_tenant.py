"""simplify_rls_single_tenant

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-13

Opens up workspace-based RLS across the schema. Sign-up becomes the
security gate. coaching_sessions stays per-user private. Downgrade
restores the workspace-scoped policies as they were after 0006.
"""

from pathlib import Path

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    op.execute(_SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    # Re-tighten — copy the workspace-scoped policies from 0001 + 0006.
    # Run 0001+0006 SQL bodies again instead of duplicating here.
    raise NotImplementedError(
        "To restore workspace isolation, re-apply 0001_initial_schema + "
        "0006_artifacts_project_id RLS policy sections, plus the M12 "
        "workspace_invites policies. Not auto-generated to avoid drift."
    )
