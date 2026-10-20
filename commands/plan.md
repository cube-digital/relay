---
description: Turn what you want built into a relay plan — spec, tasks with tiers and tests, lanes, forecast — ready to run.
argument-hint: "<what to build, or a spec path>"
allowed-tools: Bash(relay *) Bash(ls *) Bash(git status*) Bash(git log*) Bash(mkdir *)
disable-model-invocation: true
---
Goal: $ARGUMENTS

Produce a plan; do not write code. `relay` is on your PATH: run it by name, one command per call.

1. **Understand.** If the goal is empty, ask what to build and stop. If it is a path, read that spec. Dispatch scout agents (cheap) to find the files, conventions and test commands involved; do not read the codebase yourself.
2. **Ask once, briefly.** At most three questions, in one message, and only where the answer changes the plan (scope, acceptance behavior, a risky choice). For everything else, pick the sensible default and list it as an assumption. If the user does not answer, go on with the assumptions.
3. **Spec.** Unless a spec was given, write `docs/relay/specs/YYYY-MM-DD-<slug>.md`: goal, observable behaviors (these become the tests), out of scope, constraints, assumptions. Keep it under a page.
4. **Plan.** Dispatch the architect agent with the spec path, the scout findings (paths and one-line notes, not file contents) and this instruction: read `${CLAUDE_PLUGIN_ROOT}/skills/plan-with-tiers/SKILL.md` and its `template.md`, write the plan to `docs/relay/plans/YYYY-MM-DD-<slug>.md` following them, run `relay lanes <plan>` until it has no errors, return the path.
5. **Check.** Run `relay lanes <plan>`, `relay forecast <plan>` and `relay board <plan>` (it writes the board the run will light up) yourself. If lanes still reports errors, resume the architect with them once; after that fix small issues in the plan directly.
6. **Hand over** in this order: the plan path; one line per task (`T3 · mid · high risk · 2 tests — title`); the lanes and waves from `relay lanes` and the forecast, both in code blocks, unchanged; the assumptions. End with the next step: `/relay:run <plan>` to run it here (`/relay:board` then shows its progress), `/relay:marathon <plan> <hours>` when it spans more than one 5h window, or changes in plain words (then update the plan and show lanes and forecast again).
