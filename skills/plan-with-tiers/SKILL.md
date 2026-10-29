---
name: plan-with-tiers
description: Use when turning a spec or agreed design into an implementation plan, before writing code.
---

Resolve this SKILL.md to its absolute real path. The installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`. Substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Write instructions as strict STE-style drafts. Use short sentences, clear actors, and consistent terms. Keep code, commands, paths, identifiers, output markers, quotations, and evidence exact. For teacher explanations, adapt the words and detail to the learner. Use examples, analogies, and diagrams when they help.

Read `<absolute-relay-root>/skills/using-relay/references/language-guide.md` and `<absolute-relay-root>/skills/using-relay/references/software-glossary.md`. Substitute the resolved installed root for `<absolute-relay-root>` in actual reads. If the references are unavailable, keep the inline policy. Report unavailable language guidance. Do not claim that the full language review passed. Do not load an unrelated coding workflow as a fallback. Load these references directly. Do not run the `using-relay` workflow to load language rules.

# Plan with tiers

Write the plan for engineers who know the language. Assume they do not know this codebase or spec. Decide the files, names, signatures, exact values, and tests now. Make execution mechanical so cheaper models can do it.

When a design is supplied, link its path and revision or dated state when known. Preserve its settled decisions, contracts, acceptance scenarios, and constraints. Decide details explicitly left to the builder. Do not silently replace architectural decisions. Flag unresolved material conflicts before dependent tasks. Include architecture checks and documentation maintenance in the tasks that need them.

Save to `docs/relay/plans/YYYY-MM-DD-<slug>.md`. Use scout agents for bounded search when available. Otherwise inspect the relevant files directly. Reuse evidence; do not read the codebase file by file. Copy the format in [template.md](template.md).

## Tasks

Give each task its own `done` check. Each task must be small enough for independent review. Include setup and scaffolding in the task that needs them. Group repeated mechanical edits across files into one task.

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
2. Look at the lanes: if one lane holds most tasks, the files are too entangled. Consider splitting a module or accept fewer parallel lanes.
3. Run `relay forecast <plan>` and hand the human the plan path, the lane/wave summary and the forecast: how many agents start, how many worktrees, how much of the 5-hour window and how long. Say plainly when the rates are placeholders. Then use the run-lanes skill (or dispatch the conductor agent) when they say go. In Claude Code the next steps are `/relay:run <plan>`, or `/relay:marathon <plan> <hours>` for a run longer than one window. Elsewhere, `relay marathon <plan> --hours N` from a terminal.
