# Verified facts: relay routines

Method: read-only inspection on this machine (2026-10-21). Nothing under `~/.codex` or `~/.claude` was changed.

## Codex automations

Observed on disk: one folder, `~/.codex/automations/daily-1-hour-tech-learning-deep-down-deep-tech-concepts/`, holding `automation.toml` and `memory.md` (beside it). No `relay-*` folder exists yet.

Fields in `automation.toml` (names and types only):

- `version`: integer
- `id`: string
- `kind`: string
- `name`: string
- `prompt`: string
- `status`: string, value `"ACTIVE"`
- `rrule`: string
- `model`: string
- `reasoning_effort`: string
- `execution_environment`: string
- `target`: table
- `cwds`: array
- `created_at`: integer
- `updated_at`: integer

Status values seen: `ACTIVE` only (one automation).

`memory.md` sits beside the single `automation.toml` (present, non-empty).

`command -v codex`: no output, exit 1 (Codex CLI not on PATH).
`ls /Applications | grep -i codex`: no match, exit 1 (no Codex app in `/Applications`).

Unverified here: which fields Codex requires beyond those observed; other `status` values (for example a paused state); whether the Codex app watches `~/.codex/automations` or needs a restart to pick up a new folder.

## Claude scheduled tasks

This session has no scheduled-tasks tool (no tool with create, update, list or delete names is available here).
`~/.claude/scheduled-tasks/` does not exist on this machine.

Unverified here: tool names and parameters; commands/routine.md uses mcp__scheduled-tasks__create_scheduled_task, mcp__scheduled-tasks__update_scheduled_task and mcp__scheduled-tasks__list_scheduled_tasks.

## Rules for later tasks

1. Relay writes exactly the 14 fields observed (`version`, `id`, `kind`, `name`, `prompt`, `status`, `rrule`, `model`, `reasoning_effort`, `execution_environment`, `target`, `cwds`, `created_at`, `updated_at`), `status = "ACTIVE"` only, plus an empty `memory.md`.
2. Disable removes the folder; relay never writes a paused status.
3. `enable --harness codex` prints `note: Codex reads ~/.codex/automations itself; restart the Codex app if relay-<slug> does not show up.`
4. If the Claude tool names differ from the ones above, T8 uses the observed names.
