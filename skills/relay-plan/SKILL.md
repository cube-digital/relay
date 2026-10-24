---
name: relay-plan
description: Use to turn what you want built into a relay plan — spec, tasks with tiers and tests, lanes, forecast — ready to run.
---
# Relay plan

Resolve this SKILL.md to its absolute real path; the installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`; substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Goal: the user’s arguments

Produce a plan; do not write code.

1. **Understand.** If the goal is empty, ask what to build and stop. If it is a path, read that spec. Dispatch scout agents (cheap) to find the files, conventions and test commands involved; do not read the codebase yourself.
2. **Ask once, briefly.** At most three questions, in one message, and only where the answer changes the plan (scope, acceptance behavior, a risky choice). For everything else, pick the sensible default and list it as an assumption. If the user does not answer, go on with the assumptions.
3. **Spec.** Unless a spec was given, write `docs/relay/specs/YYYY-MM-DD-<slug>.md`: goal, observable behaviors (these become the tests), out of scope, constraints, assumptions. Keep it under a page.
4. **Plan.** Dispatch the architect agent with the spec path, the scout findings (paths and one-line notes, not file contents) and this instruction: read `<relay-root>/skills/plan-with-tiers/SKILL.md` and its `template.md`, write the plan to `docs/relay/plans/YYYY-MM-DD-<slug>.md` following them, run `relay lanes <plan>` until it has no errors, return the path.
5. **Check.** Run `relay lanes <plan>`, `relay forecast <plan>` and `relay board <plan>` (it writes the board the run will light up) yourself. If lanes still reports errors, resume the architect with them once; after that fix small issues in the plan directly.
6. **Hand over** in this order: the plan path; one line per task (`T3 · mid · high risk · 2 tests — title`); the lanes and waves from `relay lanes` and the forecast, both in code blocks, unchanged; the assumptions. End with the next step: `/relay:run <plan>` to run it here (`/relay:board` then shows its progress), `/relay:marathon <plan> <hours>` when it spans more than one 5h window, or changes in plain words (then update the plan and show lanes and forecast again).
