---
description: Turn what you want built into a relay plan — spec, tasks with tiers and tests, lanes, forecast — ready to run.
argument-hint: "[--unattended] [--flow <flow>] <what to build, or a spec path>"
allowed-tools: Bash(relay *) Bash(ls *) Bash(git status*) Bash(git log*) Bash(mkdir *)
disable-model-invocation: true
---
Goal: $ARGUMENTS

Produce a plan; do not write code. `relay` is on your PATH: run it by name, one command per call.

**Unattended.** When the goal starts with `--unattended` (a launch from relay HQ: nobody can answer, and the process ends with your turn), drop that flag: skip step 2 and list the defaults you took as assumptions in the spec, and dispatch every agent in the foreground and wait for it. `--flow <name>` before the goal sets the flow in step 1.

1. **Understand.** If the goal is empty, ask what to build and stop. If it is a path, read that spec. Dispatch scout agents (cheap) to find the files, conventions and test commands involved; do not read the codebase yourself. Choose the flow: `bugfix` when the goal is to fix a defect, `feature` otherwise (`relay flow list` shows every flow).
2. **Ask once, briefly.** At most three questions, in one message, and only where the answer changes the plan (scope, acceptance behavior, a risky choice). For everything else, pick the sensible default and list it as an assumption. If the user does not answer, go on with the assumptions.
3. **Spec.** Unless a spec was given, write `docs/relay/specs/YYYY-MM-DD-<slug>.md`: goal, observable behaviors (these become the tests), out of scope, constraints, assumptions. Keep it under a page. The slug you pick here is the plan's slug.
4. **Pieces before the plan.** `relay flow at --flow <flow> --slug <slug> plan.before`. Dispatch every piece it lists as its role under the agent name it prints, with one line: "Read <brief>; it is your instruction. Write your report to <report>." Wait for each; a blocking piece must be DONE before the plan is written.
5. **Plan.** Dispatch the architect agent with the spec path, the flow, the reports from step 4 (such as docs/relay/requirements/<slug>.md), the scout findings (paths and one-line notes, not file contents) and this instruction: read `${CLAUDE_PLUGIN_ROOT}/skills/plan-with-tiers/SKILL.md` and its `template.md`, write the plan to `docs/relay/plans/YYYY-MM-DD-<slug>.md` with `"slug": "<slug>"` and `"flow": "<flow>"`, following them, run `relay lanes <plan>` until it has no errors, return the path.
6. **Check.** Run `relay lanes <plan>`, `relay forecast <plan>` and `relay board <plan>` (it writes the board the run will light up) yourself. If lanes still reports errors, resume the architect with them once; after that fix small issues in the plan directly. Then `relay flow at <plan> plan.after` and dispatch its pieces as in step 4. For every piece of steps 4 and 6: `relay flow done <plan> <piece> --status pass|findings|blocked --report <report>`.
7. **Hand over** in this order: the plan path; the flow and the pieces that ran; one line per task (`T3 · mid · high risk · 2 tests — title`); the lanes and waves from `relay lanes` and the forecast, both in code blocks, unchanged; the assumptions. End with the next step: `/relay:run <plan>` to run it here (`/relay:board` then shows its progress), `/relay:marathon <plan> <hours>` when it spans more than one 5h window, or changes in plain words (then update the plan and show lanes and forecast again).
