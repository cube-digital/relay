---
name: qa-mindset
description: Use when writing, changing, running or reviewing tests, or deciding how to verify a change.
---
# QA mindset

Resolve this SKILL.md to its absolute real path; the installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`; substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.


A test is worth writing only if it would catch a real bug that nothing else catches. Every extra test is code to maintain, run and read. Agents over-test: most agent-written tests in studies had weak or no assertions, and repeated test runs on unchanged code are among the largest wastes in agent sessions.

## Decide what to test

1. List the behaviors the task changes (the plan's `behaviors`). Rank by risk: how likely to break × how bad if it does.
2. Respect the task's test budget. Defaults: low risk 0–1 new tests, medium one per behavior, high one per behavior plus boundary values and error cases (or one property-based test instead of many examples).
3. Before adding a test, check whether an existing test already fails when this behavior breaks. If yes, add nothing.
4. Push each test as low as it can go: a unit test over an integration test, an integration test over an end-to-end test. Types and lint catch some bugs for free.
5. One test per equivalence class and per boundary, not many similar examples.

## Write tests that catch bugs

- Expected values come from the spec or the brief. Never run the code to find out what to expect: that copies its bugs into the test.
- Test behavior through public interfaces. No assertions on private methods, call order or internal structure; a refactor must not break the test.
- Mock only at process boundaries (network, clock, randomness, filesystems you don't own). Never mock the unit under test.
- Strong assertions: exact values and states. No print-only tests, no `toBeTruthy` / not-null checks where a value is known, no loops or conditionals inside tests, no giant snapshots.
- See the new test fail once for the right reason (or break the code on purpose and see it fail) before trusting it.
- Never add code paths that special-case test inputs.

## Verify narrowly, once

Use the narrowest check that can fail, in this order, and stop at the first failure:
1. typecheck / lint of the touched files or package;
2. the tests related to the change: `pytest path::test` or `pytest --lf` / `--testmon`; `vitest related <files> --run`; `jest --findRelatedTests <files>`; `go test ./pkg/...`; `cargo test <module>`; `nx affected -t test`;
3. the task's `done` command.

The full suite runs once per wave on the integration branch (`relay worktrees merge --suite`), not in lanes.

Never rerun a test command when the code has not changed since it last ran: the result cannot change. Relay's retest guard blocks it. For a genuinely flaky test, prefix the command with `RELAY_RERUN=1` and say why in the report.

## Protected tests

Acceptance tests written by the test-author from the spec are protected. Never edit, weaken, skip or delete them to get green. If one looks wrong, stop and report BLOCKED with evidence: the spec line, what the test expects, what the code does.

## High-risk extra: mutation on the diff

For `risk: high` tasks only, after green: run mutation testing on the changed lines (Stryker `--incremental`, mutmut, cargo-mutants `--in-diff`, PIT with history). For each surviving mutant that is not equivalent, add one targeted test, once. Coverage percentage is never the goal.

## Report

In every report: `tests: +<added> -<removed>`, one line per added test saying which behavior it guards, and the commands you ran with their results. Delete tests you find that only mirror the code, assert nothing, or duplicate another test, and list them as removed.
