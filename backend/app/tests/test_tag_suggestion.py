"""Tests for M20 tag suggestion — prompt loading, routing, audit-row write,
ON CONFLICT semantics, and feedback verdict capture.

Mirrors the test style in test_coaching.py / test_manager.py — AsyncMock
sessions, monkeypatched `_client_for` for the LLM, no live DB or network.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from app.api import artifacts as artifacts_api
from app.llm import manager
from app.llm.prompts import load as load_prompt

# ── 1. Prompt loads ────────────────────────────────────────────────────


def test_tag_suggestion_prompt_loads():
    """The new prompt file must exist + be substantive (not blank/stub)."""
    content = load_prompt("tag_suggestion_system")
    assert isinstance(content, str)
    assert len(content) > 500, "tag_suggestion_system.md looks truncated"
    # Anchors that must be there for the contract to hold:
    lowered = content.lower()
    assert "feedback" in lowered, "Feedback-loop section missing (design rule #2)"
    assert "proposals" in lowered, "Output schema key 'proposals' not referenced"
    assert "rationale_en" in lowered and "rationale_cn" in lowered, (
        "Bilingual rationale fields missing from prompt"
    )


# ── 2. Routing entry exists ────────────────────────────────────────────


def test_routing_has_tag_suggestion():
    """tag_suggestion → moonshot. Catches accidental removals."""
    from app.llm.routing import ROUTING

    assert "tag_suggestion" in ROUTING
    choice = ROUTING["tag_suggestion"]
    assert choice.provider == "moonshot"
    assert choice.model.startswith("moonshot-v1-")


# ── 3. suggest_tags writes a manager_actions audit row ────────────────


def _fake_chat_response(content: str):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=20, completion_tokens=10),
    )


async def test_suggest_tags_writes_audit_row(monkeypatch, fake_session):
    """End-to-end shape: suggest_tags → manager.generate → manager_actions INSERT.

    We verify the audit insert by counting execute() calls and checking
    the INSERT SQL appears among them. The fake_session.execute mock
    returns the same default Result for every call — that's fine because
    we feed the route a controlled sequence via side_effect.
    """
    artifact_id = uuid4()
    project_id = uuid4()
    workspace_id = uuid4()
    action_id = uuid4()

    # The route makes these execute() calls, in order:
    #   1. _load_artifact → 1 row
    #   2. _existing_project_tags → 0 rows (empty vocab → keep it simple)
    #   3. _existing_artifact_tags → 0 rows
    #   4. recent_feedback (inside llm.recent_feedback) → 0 rows
    #   5. manager.generate's audit INSERT into manager_actions
    #   6. _latest_action_id-style lookup → 1 row with action_id
    #
    # Each result must be a Result-like object (with .first()/.all()).
    def _result(rows):
        # Synchronous .first() / .all() — match conftest._make_execute_result
        from unittest.mock import MagicMock

        m = MagicMock()
        m.first = MagicMock(return_value=(rows[0] if rows else None))
        m.all = MagicMock(return_value=rows)
        return m

    load_artifact_row = (
        artifact_id,
        project_id,
        "Yiwu 供应商对比表 v2",
        "spreadsheet",
        "Supplier A: MOQ 50, ¥38/串. Supplier B: MOQ 100, ¥52/串...",
        None,  # task_id
        "",  # task_title
        workspace_id,
    )
    fake_session.execute = AsyncMock(
        side_effect=[
            _result([load_artifact_row]),  # _load_artifact
            _result([]),  # _existing_project_tags
            _result([]),  # _existing_artifact_tags
            _result([]),  # recent_feedback
            _result([]),  # INSERT into manager_actions (no return)
            _result([(action_id,)]),  # lookup the new manager_action_id
        ]
    )

    async def fake_create(**_kwargs):
        return _fake_chat_response(
            json.dumps(
                {
                    "proposals": [
                        {
                            "tag_name": "供应商",
                            "kind": "topic",
                            "rationale_en": "Supplier comparison doc.",
                            "rationale_cn": "供应商对比文档。",
                        },
                        {
                            "tag_name": "定价",
                            "kind": "topic",
                            "rationale_en": "Pricing per MOQ included.",
                            "rationale_cn": "包含每个 MOQ 的价格。",
                        },
                    ]
                }
            )
        )

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=fake_create))
    )
    monkeypatch.setattr(manager, "_client_for", lambda _c: fake_client)
    monkeypatch.setattr(
        manager.budget, "assert_budget", AsyncMock(return_value=None)
    )

    # Fake CurrentUser dependency — call the route function directly.
    user = SimpleNamespace(id=uuid4(), email="t@t", workspace_id=workspace_id)

    out = await artifacts_api.suggest_tags(
        artifact_id=artifact_id, user=user, session=fake_session
    )

    assert len(out.proposals) == 2
    assert out.proposals[0].tag_name == "供应商"
    assert out.proposals[0].kind == "topic"
    assert out.manager_action_id == action_id

    # Verify the audit INSERT call happened.
    audit_call_found = False
    for call in fake_session.execute.await_args_list:
        sql = str(call.args[0]).lower()
        if "insert into public.manager_actions" in sql:
            params = call.args[1] if len(call.args) > 1 else call.kwargs
            assert params["atype"] == "tag_suggestion"
            assert params["pid"] == str(project_id)
            audit_call_found = True
            break
    assert audit_call_found, "No manager_actions INSERT found in execute() calls"


# ── 4. apply_tags uses ON CONFLICT semantics ──────────────────────────


async def test_apply_tags_inserts_idempotent(fake_session):
    """The apply_tags route must:
      - INSERT into tags with ON CONFLICT (project_id, name) DO UPDATE
      - INSERT into artifact_tags with ON CONFLICT (artifact_id, tag_id) DO NOTHING
    """
    from unittest.mock import MagicMock

    artifact_id = uuid4()
    project_id = uuid4()
    workspace_id = uuid4()
    user_id = uuid4()
    manager_action_id = uuid4()
    tag_id = uuid4()

    def _result(rows):
        m = MagicMock()
        m.first = MagicMock(return_value=(rows[0] if rows else None))
        m.all = MagicMock(return_value=rows)
        return m

    load_artifact_row = (
        artifact_id, project_id, "doc", "doc", "content", None, "", workspace_id,
    )
    # manager_actions.output is jsonb decoded — `{"content": "<json>"}`.
    original_output = {
        "content": json.dumps(
            {
                "proposals": [
                    {"tag_name": "供应商", "kind": "topic"},
                ]
            }
        )
    }

    fake_session.execute = AsyncMock(
        side_effect=[
            _result([load_artifact_row]),       # _load_artifact
            _result([(original_output,)]),      # manager_action lookup
            _result([(tag_id,)]),               # INSERT INTO tags ... RETURNING id
            _result([]),                        # INSERT INTO artifact_tags
            _result([]),                        # UPDATE manager_actions
        ]
    )

    user = SimpleNamespace(id=user_id, email="t@t", workspace_id=workspace_id)
    body = artifacts_api.ApplyTagsIn(
        manager_action_id=manager_action_id,
        decisions=[
            artifacts_api.TagProposalIn(proposal_index=0, action="accept"),
        ],
    )

    out = await artifacts_api.apply_tags(
        artifact_id=artifact_id, body=body, user=user, session=fake_session
    )

    assert out.tag_ids == [tag_id]
    assert out.summary == {"accepted": 1, "edited": 0, "rejected": 0}

    # Pull all SQL statements run.
    sql_seen = [str(c.args[0]).lower() for c in fake_session.execute.await_args_list]
    joined = " ||| ".join(sql_seen)

    assert any(
        "insert into public.tags" in s
        and "on conflict (project_id, name)" in s
        and "do update" in s
        for s in sql_seen
    ), f"tags upsert SQL missing or wrong ON CONFLICT clause. Got:\n{joined}"

    assert any(
        "insert into public.artifact_tags" in s
        and "on conflict (artifact_id, tag_id)" in s
        and "do nothing" in s
        for s in sql_seen
    ), f"artifact_tags link SQL missing or wrong ON CONFLICT clause. Got:\n{joined}"


# ── 5. apply_tags writes the verdict JSON into manager_actions ────────


async def test_apply_tags_records_human_feedback(fake_session):
    """The UPDATE on manager_actions must include:
      - accepted_by_human (bool)
      - a JSON-serialized human_feedback with summary + per-proposal verdict
    """
    from unittest.mock import MagicMock

    artifact_id = uuid4()
    project_id = uuid4()
    workspace_id = uuid4()
    user_id = uuid4()
    manager_action_id = uuid4()
    tag_id = uuid4()

    def _result(rows):
        m = MagicMock()
        m.first = MagicMock(return_value=(rows[0] if rows else None))
        m.all = MagicMock(return_value=rows)
        return m

    load_artifact_row = (
        artifact_id, project_id, "doc", "doc", "content", None, "", workspace_id,
    )
    original_output = {
        "content": json.dumps(
            {
                "proposals": [
                    {"tag_name": "供应商", "kind": "topic"},
                    {"tag_name": "low-priority-tag", "kind": "topic"},
                ]
            }
        )
    }

    fake_session.execute = AsyncMock(
        side_effect=[
            _result([load_artifact_row]),   # _load_artifact
            _result([(original_output,)]),  # manager_action lookup
            _result([(tag_id,)]),           # tags INSERT for the accepted proposal
            _result([]),                    # artifact_tags INSERT
            _result([]),                    # UPDATE manager_actions
        ]
    )

    user = SimpleNamespace(id=user_id, email="t@t", workspace_id=workspace_id)
    body = artifacts_api.ApplyTagsIn(
        manager_action_id=manager_action_id,
        decisions=[
            artifacts_api.TagProposalIn(proposal_index=0, action="accept"),
            artifacts_api.TagProposalIn(
                proposal_index=1, action="reject", reject_reason="太宽泛"
            ),
        ],
    )

    out = await artifacts_api.apply_tags(
        artifact_id=artifact_id, body=body, user=user, session=fake_session
    )

    assert out.summary == {"accepted": 1, "edited": 0, "rejected": 1}

    # Find the UPDATE manager_actions call and inspect its bound params.
    update_call = None
    for c in fake_session.execute.await_args_list:
        sql = str(c.args[0]).lower()
        if "update public.manager_actions" in sql and "human_feedback" in sql:
            update_call = c
            break
    assert update_call is not None, "No UPDATE on manager_actions found"

    params = update_call.args[1] if len(update_call.args) > 1 else update_call.kwargs
    assert params["aid"] == str(manager_action_id)
    # accepted_by_human is True because at least one accept happened.
    assert params["acc"] is True

    payload = json.loads(params["fb"])
    assert payload["summary"] == {"accepted": 1, "edited": 0, "rejected": 1}
    decisions = payload["decisions"]
    assert len(decisions) == 2
    # The reject verdict carried the user's reason chip into the feedback.
    rejects = [d for d in decisions if d["action"] == "reject"]
    assert len(rejects) == 1
    assert rejects[0]["reason"] == "太宽泛"
    # The accept verdict carried both the original proposal name and the
    # final inserted tag id so the next prompt has full context.
    accepts = [d for d in decisions if d["action"] == "accept"]
    assert len(accepts) == 1
    assert accepts[0]["original"]["tag_name"] == "供应商"
    assert accepts[0]["final"]["tag_id"] == str(tag_id)


# ── 6. apply_tags rate-limiter routing — sanity check ────────────────


def test_rate_limiter_matches_suggest_tags_only():
    """Rate-limit matcher must hit /suggest_tags but skip /apply_tags."""
    from app.middleware import rate_limit

    assert rate_limit._matches_ai_endpoint(
        "POST", "/api/artifacts/abc-123/suggest_tags"
    )
    # apply_tags is a trivial DB write — must NOT be rate-limited.
    assert not rate_limit._matches_ai_endpoint(
        "POST", "/api/artifacts/abc-123/apply_tags"
    )
