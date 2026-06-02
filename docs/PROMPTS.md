# Prompts in use

Human-readable mirror of every prompt template the Manager Agent calls. Source-of-truth files live in `backend/app/llm/prompts/`. This doc gets updated whenever a prompt changes, so reviewers can read flows without grepping `.txt`s.

## Status

Stub during M0. Prompts will be populated at:
- M5 — `task_generation.md` (per PRD Appendix A.1 + feedback-loop section)
- M6 — `info_discovery.md` (per PRD Appendix A.2 + feedback-loop section)
- M7 — `backlog_optimizer.md`

## Prompt shape (PRD §9.4)

All prompts are assembled as `[stable_system, project_state_snapshot, user_query]` so the first two segments stay cache-eligible across calls within a project.

## Feedback-loop injection

For `task_generation`, `info_discovery`, and `backlog_optimizer`, the system prompt also ingests a "Past feedback on your suggestions" section pulled from recent `manager_actions` rows of the same `action_type` for the same project. Format: accepted suggestions (positive signal), rejected suggestions with reason chip + free text, edited suggestions (with original-vs-final delta).
