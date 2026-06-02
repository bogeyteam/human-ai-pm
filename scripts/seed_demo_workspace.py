"""Seed a dogfooding workspace for the founder's fanpo team.

Loads .env via app.settings, talks to Supabase via service-role key (bypasses
RLS), and creates:
  * 1 workspace ("fanpo")
  * 3 users (must already exist in auth.users — the script links them via email)
  * 1 project ("fanpo 北美 launch", validation stage)
  * ~10 tasks across statuses
  * 3 decisions
  * 4 artifacts (with content; embeddings get generated on first discovery run)

Usage:
  cd backend && python ../scripts/seed_fanpo_workspace.py --email you@fanpo.co
                                                        [--email teammate@fanpo.co ...]

Idempotent at workspace level — if a workspace with this name already exists,
the script bails out so it doesn't double-seed. Drop the workspace from
Supabase Studio first if you want to re-seed.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

# Make `app` importable when running from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.settings import get_settings  # noqa: E402


WORKSPACE_NAME = "fanpo"
PROJECT_NAME = "fanpo 北美 launch"
PROJECT_VISION = (
    "把 fanpo 手串做成 US Gen-Z 的精神配饰品牌。先用 Shopify 跑通 PMF，"
    "然后 9 个月内进入 Urban Outfitters 这类买手店。"
)


SEED_TASKS: list[dict] = [
    {"title": "Source 3 mockup samples from Yiwu suppliers", "status": "done",
     "estimated_hours": 6, "actual_hours": 9, "description": "对比石材、绳线、五金件、做工"},
    {"title": "Pick Shopify theme + brand color palette", "status": "done",
     "estimated_hours": 4, "actual_hours": 5},
    {"title": "Write product copy for launch SKU (中英双语)", "status": "in_progress",
     "estimated_hours": 5, "description": "5 个手串系列各 200 字 + alt text"},
    {"title": "Apply for FDA + CPSC compliance review", "status": "blocked",
     "estimated_hours": 12, "description": "美国小商品准入；找熟悉饰品类目的合规顾问"},
    {"title": "Build 'About' page covering brand story", "status": "ready",
     "estimated_hours": 4, "description": "讲清楚手串文化 + 我们的差异化"},
    {"title": "Set up Klaviyo + welcome flow (3 emails)", "status": "ready",
     "estimated_hours": 6},
    {"title": "Hire customer support contractor for US TZ", "status": "backlog",
     "estimated_hours": 2, "description": "Upwork 找一个英文母语的 PT contractor"},
    {"title": "Investigate Temu vs Shopee for SEA secondary launch", "status": "backlog",
     "estimated_hours": 3},
    {"title": "Try TikTok creator partnership w/ spiritual/wellness niche", "status": "backlog",
     "estimated_hours": 8, "description": "list 20 个匹配创作者，发 3 个产品试用"},
    {"title": "Cancelled — bespoke leather pouch run", "status": "dropped",
     "estimated_hours": 4, "description": "成本压不下来，先用现成 jewelry box"},
]


SEED_DECISIONS: list[dict] = [
    {
        "question": "用 Shopify 还是 Squarespace 起步？",
        "decision": "Shopify Basic 起步，Klaviyo + Judge.me 三件套",
        "reasoning": "App ecosystem 远比 Squarespace 强，跨境支付/物流插件成熟。后期切 Plus 也容易。",
        "alternatives": "Squarespace, Shoplazza",
        "review_weeks": 12,
    },
    {
        "question": "美国第一批库存放哪？",
        "decision": "用 ShipBob 的 LA 仓",
        "reasoning": "西海岸到东海岸 3-5 天达，价格比 Amazon FBA 灵活，不锁库存。",
        "alternatives": "Amazon FBA, 4PX 自有仓",
        "review_weeks": 8,
    },
    {
        "question": "首批定价区间？",
        "decision": "$48-128 USD",
        "reasoning": "覆盖低门槛尝鲜款 + 主力收藏款。同 niche 竞品在 $35-$200，我们的差异化是 storytelling 不是价格战。",
        "alternatives": "$25-80, $80-250",
        "review_weeks": 6,
    },
]


SEED_ARTIFACTS: list[dict] = [
    {
        "type": "doc",
        "title": "Yiwu 供应商对比表 (drafted by Alice)",
        "linked_to_task_idx": 0,
        "content": (
            "Supplier A (王老板): MOQ 50, 起订价 ¥38/串，皮筋 + 银扣。样品 3 天发出。\n"
            "Supplier B (Lily): MOQ 100, ¥52/串，玛瑙原石，铜扣镀金。可定制激光刻字。\n"
            "Supplier C (赵姐): MOQ 30, ¥45/串，金刚菩提 + 925 银。月产能 5000。\n"
            "结论: 主推 Supplier B 做收藏款，Supplier C 做入门款。Supplier A 先不用。"
        ),
    },
    {
        "type": "link",
        "title": "Klaviyo 入门 docs 我们参考的",
        "linked_to_task_idx": 5,
        "content": "https://www.klaviyo.com/blog/welcome-email-series-best-practices — 重点看里面的 3-email cadence",
    },
    {
        "type": "decision",
        "title": "FDA 顾问 first call notes",
        "linked_to_task_idx": 3,
        "content": (
            "美国饰品类目核心合规点: 重金属含量 (Pb, Cd, Ni), CPSC 标签, Prop 65 警告. "
            "石材类首饰一般 exempt 但要走 ASTM-F2923 testing. 顾问报价 $2500 一轮 testing. "
            "建议 Supplier B 那批先测，Supplier C 等量产再测."
        ),
    },
    {
        "type": "doc",
        "title": "Brand voice guide v0.3",
        "linked_to_task_idx": 2,
        "content": (
            "Tone: warm, slightly mystical but not preachy. Avoid 'energy' and 'vibrations' as standalone words. "
            "Use specific imagery: '握在手里有沉甸甸的安全感', 'the stone remembers'. "
            "Bilingual rule: 中文 first on Chinese product pages, English first on US pages. "
            "Never machine-translate marketing copy — always hand-edited."
        ),
    },
]


async def main(emails: list[str]) -> None:
    settings = get_settings()
    if not settings.database_url:
        print("ERROR: DATABASE_URL is empty in .env. Reset the DB password in the Supabase dashboard and fill it in.")
        sys.exit(1)

    if len(emails) < 1:
        print("Provide at least one --email (must exist in auth.users). Sign in once via the app first.")
        sys.exit(1)

    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    async with engine.begin() as conn:
        # 0. Idempotency check.
        existing = (
            await conn.execute(
                text("select id from public.workspaces where name = :n"), {"n": WORKSPACE_NAME}
            )
        ).first()
        if existing is not None:
            print(f"Workspace '{WORKSPACE_NAME}' already exists (id={existing[0]}). Drop it first to re-seed.")
            return

        # 1. Workspace.
        ws_row = (
            await conn.execute(
                text("insert into public.workspaces (name) values (:n) returning id"),
                {"n": WORKSPACE_NAME},
            )
        ).first()
        assert ws_row is not None
        ws_id = UUID(str(ws_row[0]))
        print(f"✓ Workspace: {ws_id}")

        # 2. Link users (must already be in auth.users — sign in via the app first).
        user_ids: list[UUID] = []
        for i, email in enumerate(emails):
            row = (
                await conn.execute(
                    text("select id from public.users where email = :e"), {"e": email}
                )
            ).first()
            if row is None:
                print(f"  ✗ {email} not in public.users — sign in via the app first, then re-run.")
                continue
            uid = UUID(str(row[0]))
            await conn.execute(
                text(
                    """
                    update public.users
                      set workspace_id = :ws,
                          role = :role,
                          name = coalesce(name, split_part(email, '@', 1))
                      where id = :uid
                    """
                ),
                {"ws": str(ws_id), "role": "founder" if i == 0 else "member", "uid": str(uid)},
            )
            user_ids.append(uid)
            print(f"  ✓ {email} → workspace")

        if not user_ids:
            print("No users linked. Aborting seed.")
            return

        # 3. Project.
        prj_row = (
            await conn.execute(
                text(
                    """
                    insert into public.projects (workspace_id, name, vision, current_stage)
                    values (:ws, :n, :v, 'validation') returning id
                    """
                ),
                {"ws": str(ws_id), "n": PROJECT_NAME, "v": PROJECT_VISION},
            )
        ).first()
        assert prj_row is not None
        prj_id = UUID(str(prj_row[0]))
        print(f"✓ Project: {prj_id}")

        # 4. Tasks.
        task_ids: list[UUID] = []
        now = datetime.now(UTC)
        for i, t in enumerate(SEED_TASKS):
            owner = user_ids[i % len(user_ids)]
            row = (
                await conn.execute(
                    text(
                        """
                        insert into public.tasks
                          (project_id, title, description, owner_id, status,
                           estimated_hours, actual_hours, created_by, completed_at)
                        values (:p, :title, :desc, :owner, :status,
                                :est, :act, 'human', :done)
                        returning id
                        """
                    ),
                    {
                        "p": str(prj_id),
                        "title": t["title"],
                        "desc": t.get("description"),
                        "owner": str(owner),
                        "status": t["status"],
                        "est": t.get("estimated_hours"),
                        "act": t.get("actual_hours"),
                        "done": now - timedelta(days=2) if t["status"] == "done" else None,
                    },
                )
            ).first()
            assert row is not None
            task_ids.append(UUID(str(row[0])))
        print(f"✓ {len(task_ids)} tasks")

        # 5. Decisions.
        for d in SEED_DECISIONS:
            await conn.execute(
                text(
                    """
                    insert into public.decisions
                      (project_id, question, decision, reasoning,
                       alternatives_considered, decided_by, review_at)
                    values (:p, :q, :d, :r, :alt, :who, :review)
                    """
                ),
                {
                    "p": str(prj_id),
                    "q": d["question"],
                    "d": d["decision"],
                    "r": d["reasoning"],
                    "alt": d["alternatives"],
                    "who": str(user_ids[0]),
                    "review": now + timedelta(weeks=d["review_weeks"]),
                },
            )
        print(f"✓ {len(SEED_DECISIONS)} decisions")

        # 6. Artifacts.
        for a in SEED_ARTIFACTS:
            target_task = task_ids[a["linked_to_task_idx"]]
            await conn.execute(
                text(
                    """
                    insert into public.artifacts (project_id, task_id, type, title, content)
                    values (:pid, :t, :type, :title, :content)
                    """
                ),
                {
                    "pid": str(prj_id),
                    "t": str(target_task),
                    "type": a["type"],
                    "title": a["title"],
                    "content": a["content"],
                },
            )
        print(f"✓ {len(SEED_ARTIFACTS)} artifacts")

        print(
            f"\nDone. Visit http://localhost:3000/projects/{prj_id} after signing in as one of: "
            + ", ".join(emails)
        )

    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--email",
        action="append",
        required=True,
        help="Email of a user that has already signed in once via the app (can be repeated)",
    )
    args = parser.parse_args()
    asyncio.run(main(args.email))
