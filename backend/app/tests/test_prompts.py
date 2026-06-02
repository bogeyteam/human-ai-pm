"""Tests for the prompt loader (`app/llm/prompts/__init__.py`).

The feedback-loop pattern (design rule #2) lives in the prompts. If a
prompt loses its feedback section silently during an edit, the AI flow
stops learning from human verdicts — but nothing observable breaks.
These tests guard against that.
"""

from __future__ import annotations

import pytest

from app.llm.prompts import load

REQUIRED_PROMPTS = [
    "task_generation_system",
    "info_discovery_system",
    "backlog_optimizer_system",
    "meeting_pre_brief_system",
    "meeting_post_summary_system",
    "tag_suggestion_system",
]


@pytest.mark.parametrize("name", REQUIRED_PROMPTS)
def test_required_prompt_loads_non_empty(name: str):
    content = load(name)
    assert isinstance(content, str)
    assert len(content) > 50  # arbitrary floor — guards against blank/truncated files


@pytest.mark.parametrize("name", REQUIRED_PROMPTS)
def test_required_prompt_mentions_feedback(name: str):
    """Every system prompt must reference the feedback loop somewhere.
    If this fails, an edit silently dropped the feedback-loop section.
    """
    content = load(name).lower()
    assert "feedback" in content, (
        f"{name}.md no longer mentions 'feedback' — the feedback-loop pattern "
        f"is foundational (design rule #2 in CLAUDE.md). Restore it before merging."
    )


def test_missing_prompt_raises_file_not_found():
    with pytest.raises(FileNotFoundError):
        load("definitely_does_not_exist_prompt_name")
