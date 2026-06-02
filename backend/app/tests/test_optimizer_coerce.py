"""Tests for `_coerce_review` in `app/api/optimizer.py`.

The optimizer LLM output is parsed JSON. `_coerce_review` is intentionally
tolerant — it drops malformed individual items rather than 500'ing the
whole run. These tests pin that contract.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.api.optimizer import OptimizerReview, _coerce_review


def test_valid_payload_round_trips_cleanly():
    tid = str(uuid4())
    parsed = {
        "risks": [
            {
                "severity": "high",
                "title": "Vendor delay risk",
                "description": "Lead times slipping",
            }
        ],
        "reorder": [{"task_id": tid, "new_priority": 1, "reasoning": "blocker"}],
        "drops": [{"task_id": tid, "reason": "redundant"}],
        "adds": [{"title": "Audit packaging"}],
        "critical_path": [tid],
        "unknowns": ["Will the QA tool arrive in time?"],
        "overall_reasoning": "Tight week.",
    }
    out = _coerce_review(parsed)
    assert isinstance(out, OptimizerReview)
    assert len(out.risks) == 1
    assert out.risks[0].severity == "high"
    assert len(out.reorder) == 1
    assert len(out.drops) == 1
    assert len(out.adds) == 1
    assert len(out.critical_path) == 1
    assert out.overall_reasoning == "Tight week."


def test_missing_risks_returns_empty_list():
    out = _coerce_review({"reorder": [], "drops": [], "adds": []})
    assert out.risks == []


def test_missing_adds_returns_empty_list():
    out = _coerce_review({"risks": [], "reorder": [], "drops": []})
    assert out.adds == []


def test_completely_empty_object_yields_all_empty_lists():
    out = _coerce_review({})
    assert out.risks == []
    assert out.reorder == []
    assert out.drops == []
    assert out.adds == []
    assert out.critical_path == []
    assert out.unknowns == []
    assert out.overall_reasoning is None


def test_garbled_top_level_raises():
    """A string-shaped payload (not dict) must fail loudly — caller is
    expected to have already JSON-parsed the LLM response into a dict.
    """
    with pytest.raises(AttributeError):
        _coerce_review("not a dict")  # type: ignore[arg-type]


def test_extra_unknown_fields_are_ignored():
    parsed = {
        "risks": [],
        "adds": [],
        "drops": [],
        "reorder": [],
        "totally_unknown_field": {"foo": "bar"},
        "another_one": [1, 2, 3],
    }
    out = _coerce_review(parsed)
    # No explosion, and the unknown fields are not preserved on the model.
    assert not hasattr(out, "totally_unknown_field")


def test_malformed_reorder_item_is_dropped_not_raised():
    """Each reorder item is validated independently; bad ones silently drop."""
    good_tid = str(uuid4())
    parsed = {
        "reorder": [
            {"task_id": "not-a-uuid", "new_priority": 1},  # bad
            {"task_id": good_tid, "new_priority": "not-an-int"},  # bad
            {"task_id": good_tid, "new_priority": 2},  # good
        ],
    }
    out = _coerce_review(parsed)
    assert len(out.reorder) == 1
    assert str(out.reorder[0].task_id) == good_tid


def test_unknown_severity_normalizes_to_medium():
    parsed = {
        "risks": [{"severity": "spicy", "title": "Mystery risk"}],
    }
    out = _coerce_review(parsed)
    assert out.risks[0].severity == "medium"


def test_add_without_title_is_dropped():
    parsed = {"adds": [{"description": "no title"}, {"title": "real one"}]}
    out = _coerce_review(parsed)
    assert len(out.adds) == 1
    assert out.adds[0].title == "real one"
