"""artifacts_project_id

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-13
"""

from pathlib import Path

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

_SQL_FILE = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    op.execute(_SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        """
        drop policy if exists "members access workspace artifacts" on public.artifacts;
        create policy "members access workspace artifacts" on public.artifacts
          for all to authenticated
          using (
            task_id is null
            or task_id in (
              select t.id from public.tasks t
              join public.projects p on t.project_id = p.id
              where p.workspace_id = public.current_workspace_id()))
          with check (
            task_id is null
            or task_id in (
              select t.id from public.tasks t
              join public.projects p on t.project_id = p.id
              where p.workspace_id = public.current_workspace_id()));
        drop index if exists artifacts_project_id_idx;
        alter table public.artifacts drop column project_id;
        """
    )
