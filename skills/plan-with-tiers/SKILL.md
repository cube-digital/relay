---
name: plan-with-tiers
description: Use when turning a spec or agreed design into an implementation plan, before any code is written. Produces a relay plan with a model tier, risk, files, dependencies, test budget and done check per task.
---
# Plan with tiers

Write the plan for engineers who know the language but not this codebase or spec. Decide everything that needs judgment now (files, names, signatures, exact values, which tests), so execution is mechanical and can run on cheaper models.

Save to `docs/relay/plans/YYYY-MM-DD-<slug>.md`. Use scout agents to look things up; do not read the codebase file by file. Copy the format in [template.md](template.md).

## Tasks

A task is the smallest unit with its own `done` check that a reviewer could reject on its own. Fold setup and scaffolding into the task that needs them. Same-shape micro-edits across many files are one task.

For every task write a `### <id>: <title>` section (what to build, interfaces, exact values, edge cases) and one entry in the `relay-plan` block:

| field | rule |
|---|---|
| `tier` | `cheap`: the plan holds the complete code, or a one/two-file mechanical edit. `mid`: multi-file, integration, debugging, prose instructions. `strong`: design judgment, subtle concurrency, broad refactor. Cheap models take 2–3× the turns on prose; when unsure, mid. |
| `code` | `"complete"` when the section contains the full code to write; otherwise `"prose"`. |
| `risk` | `low`: internal, easy to revert. `medium`: user-visible behavior. `high`: money, data loss, security, concurrency, migrations. |
| `files` | Every path the task creates or changes, including tests, lockfiles, migrations, route and index files. Lanes are computed from overlaps, so a missing file causes merge conflicts. |
| `deps` | Task ids that must land first. Only real dependencies. |
| `behaviors` | The observable behaviors this task adds or changes, one short line each, from the spec. |
| `tests` | Budget of NEW tests (qa-mindset): low risk 0–1, medium one per behavior, high one per behavior plus boundaries or one property test. 0 is right when existing tests or the type checker cover it. |
| `done` | The narrowest command that proves the task: the related tests, a typecheck of the touched package. Never the full suite. |

Plan-level fields: `slug` (kebab-case), `suite` (full test command, run once per wave by the CLI), `setup` (dependency install for a fresh worktree, optional).

## Before handing over

1. Run `relay lanes <plan>`. Fix every ✗ error. Treat each ! warning as a question: fix it or say in the task why it stands.
2. Look at the lanes: if one lane holds most tasks, the files are too entangled; consider splitting a module or accept fewer parallel lanes.
3. Run `relay forecast <plan>` and hand the human the plan path, the lane/wave summary and the forecast: how many agents start, how many worktrees, how much of the 5-hour window and how long. Say plainly when the rates are placeholders. Then use the run-lanes skill (or dispatch the conductor agent) when they say go; for a run longer than one window, suggest `relay marathon <plan> --hours N` from their terminal.
