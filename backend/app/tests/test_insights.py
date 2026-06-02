"""Unit tests for the insights helpers (C3 — Manager learning dashboard)."""

import json

from app.api.insights import _accept_rate, _collect_reason_chips


def test_accept_rate_basic():
    assert _accept_rate(3, 1) == 0.75
    assert _accept_rate(0, 0) is None  # nothing reviewed yet
    assert _accept_rate(1, 0) == 1.0
    assert _accept_rate(0, 2) == 0.0


def test_collect_reason_chips_from_flat_dict():
    chips: list[str] = []
    _collect_reason_chips({"reject_reason_chip": "too_coarse"}, chips)
    assert chips == ["too_coarse"]


def test_collect_reason_chips_from_nested_list():
    blob = {
        "records": [
            {"reject_reason_chip": "already_done"},
            {"reason_chip": "wrong_stage"},
            {"action": "accept"},  # no chip
        ]
    }
    chips: list[str] = []
    _collect_reason_chips(blob, chips)
    assert sorted(chips) == ["already_done", "wrong_stage"]


def test_collect_reason_chips_ignores_blank_and_non_string():
    chips: list[str] = []
    _collect_reason_chips({"reject_reason_chip": "  ", "x_reason_chip": None}, chips)
    assert chips == []


def test_collect_reason_chips_handles_empty():
    chips: list[str] = []
    _collect_reason_chips({}, chips)
    _collect_reason_chips([], chips)
    _collect_reason_chips(None, chips)
    assert chips == []


def test_collect_reason_chips_from_json_string():
    """Production shape: human_feedback is a TEXT column, so the value arrives
    as a JSON *string*, not a parsed dict. This is the path the endpoint hits."""
    blob = json.dumps(
        {"records": [{"reject_reason_chip": "too_coarse"}, {"reason_chip": "wrong_stage"}]}
    )
    chips: list[str] = []
    _collect_reason_chips(blob, chips)
    assert sorted(chips) == ["too_coarse", "wrong_stage"]


def test_collect_reason_chips_ignores_non_json_string():
    """Free-text or malformed feedback rows must not crash the walk."""
    chips: list[str] = []
    _collect_reason_chips("looks good to me", chips)
    _collect_reason_chips("{not valid json", chips)
    assert chips == []
