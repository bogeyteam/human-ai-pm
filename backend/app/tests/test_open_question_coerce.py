"""M21 Open Question Engine — pins the tolerant parse + routing/prompt registration.

Pure-function tests (no DB/LLM) for _coerce_questions, plus guards that the
routing entry and prompt file exist so the recent_feedback exact-string filter
and generate() call site can't silently drift.
"""

from __future__ import annotations

import json
from typing import get_args

from app.llm.prompts import load as load_prompt
from app.llm.routing import ROUTING, TaskType
from app.workers.derive_open_questions import _coerce_questions


def _payload(questions: list[dict]) -> str:
    return json.dumps({"questions": questions, "overall_reasoning": "…"})


def test_coerce_orders_by_rank_and_nulls_missing_fields():
    out = _coerce_questions(
        _payload(
            [
                {
                    "candidate_index": 0,
                    "rank": 2,
                    "question": "q0",
                    "question_zh": "z0",
                    "question_en": "e0",
                    "drafted_message_zh": "mz",
                    "drafted_message_en": "me",
                },
                {"candidate_index": 1, "rank": 1, "question": "q1"},
            ]
        ),
        n_candidates=3,
    )
    assert [o["candidate_index"] for o in out] == [1, 0]  # sorted by rank asc
    assert out[0]["question_zh"] is None  # missing bilingual → null, no crash
    assert out[1]["question_zh"] == "z0"


def test_coerce_drops_out_of_range_index():
    out = _coerce_questions(
        _payload([{"candidate_index": 5, "rank": 1, "question": "q"}]), n_candidates=2
    )
    assert out == []


def test_coerce_drops_empty_question():
    out = _coerce_questions(
        _payload(
            [
                {"candidate_index": 0, "rank": 1, "question": "   "},
                {"candidate_index": 1, "rank": 2, "question": "real"},
            ]
        ),
        n_candidates=2,
    )
    assert [o["question"] for o in out] == ["real"]


def test_coerce_truncates_to_three_by_rank():
    items = [{"candidate_index": i, "rank": 5 - i, "question": f"q{i}"} for i in range(5)]
    out = _coerce_questions(_payload(items), n_candidates=5)
    assert len(out) == 3
    # lowest ranks survive (ranks 1,2,3 → candidate_index 4,3,2)
    assert [o["candidate_index"] for o in out] == [4, 3, 2]


def test_coerce_one_per_candidate_keeps_best_rank():
    out = _coerce_questions(
        _payload(
            [
                {"candidate_index": 0, "rank": 3, "question": "worse"},
                {"candidate_index": 0, "rank": 1, "question": "better"},
            ]
        ),
        n_candidates=1,
    )
    assert len(out) == 1
    assert out[0]["question"] == "better"


def test_coerce_handles_empty_and_garbage():
    assert _coerce_questions(json.dumps({}), 3) == []
    assert _coerce_questions("not json{", 3) == []
    assert _coerce_questions(json.dumps({"questions": "nope"}), 3) == []


def test_routing_has_open_question():
    assert "open_question" in get_args(TaskType)
    choice = ROUTING["open_question"]
    assert choice.provider == "moonshot"
    assert choice.model.startswith("moonshot-v1-")


def test_open_question_prompt_loads():
    content = load_prompt("open_question_system")
    assert isinstance(content, str)
    assert len(content) > 500
    lowered = content.lower()
    assert "feedback" in lowered, "Feedback-loop section missing"
    assert "questions" in lowered and "candidate_index" in lowered
