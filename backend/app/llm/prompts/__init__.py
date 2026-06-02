"""Prompt loading. Prompts live as .md files alongside this module."""

from pathlib import Path

_PROMPT_DIR = Path(__file__).resolve().parent


def load(name: str) -> str:
    """Load a prompt file by name (without extension)."""
    path = _PROMPT_DIR / f"{name}.md"
    if not path.is_file():
        raise FileNotFoundError(f"Prompt not found: {path}")
    return path.read_text(encoding="utf-8").strip()
