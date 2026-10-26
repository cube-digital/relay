---
name: qa-mindset
description: Use when writing, changing, running or reviewing tests, or deciding how to verify a change.
---

Resolve this SKILL.md to its absolute real path. The installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`. Substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Write instructions as strict STE-style drafts. Use short sentences, clear actors, and consistent terms. Keep code, commands, paths, identifiers, output markers, quotations, and evidence exact. For teacher explanations, adapt the words and detail to the learner. Use examples, analogies, and diagrams when they help.

Read `<absolute-relay-root>/skills/using-relay/references/language-guide.md` and `<absolute-relay-root>/skills/using-relay/references/software-glossary.md`. Substitute the resolved installed root for `<absolute-relay-root>` in actual reads. If the references are unavailable, keep the inline policy. Report unavailable language guidance. Do not claim that the full language review passed. Do not load an unrelated coding workflow as a fallback. Load these references directly. Do not run the `using-relay` workflow to load language rules.

# QA mindset

Write a test only when it catches a real bug that other checks do not catch. Each extra test needs maintenance and execution. Avoid weak assertions and repeated runs on unchanged code.

## Decide what to test

1. List the changed behaviors from the plan's `behaviors`. Rank them by risk. Consider the likelihood and impact of failure.
2. Respect the task's test budget. For low risk, use 0–1 new tests. For medium risk, use one per behavior. For high risk, use one per behavior plus boundary values and error cases. One property-based test can replace many examples.
3. Before adding a test, check whether an existing test catches this failure. If it does, add no test.
4. Use the lowest test layer that can catch the bug. Prefer a unit test to an integration test. Prefer an integration test to an end-to-end test. Use type and lint checks where sufficient.
5. One test per equivalence class and per boundary, not many similar examples.

## Write tests that catch bugs

- Derive expected values from the spec or brief. Never run the code to determine the expected result.
- Test behavior through public interfaces. Do not assert private methods, call order, or internal structure. A refactor must not break the test.
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

Never rerun a test command on unchanged code. Reuse the previous result. Relay's retest guard blocks repeated runs. If the test is genuinely flaky, prefix the command with `RELAY_RERUN=1`. State the reason in the report.

## Protected tests

Acceptance tests written by the test-author from the spec are protected. Never edit, weaken, skip or delete them to get green. If one looks wrong, stop and report BLOCKED with evidence: the spec line, what the test expects, what the code does.

## High-risk extra: mutation on the diff

For `risk: high` tasks only, after green: run mutation testing on the changed lines (Stryker `--incremental`, mutmut, cargo-mutants `--in-diff`, PIT with history). For each surviving mutant that is not equivalent, add one targeted test, once. Coverage percentage is never the goal.

## Report

In every report: `tests: +<added> -<removed>`, one line per added test saying which behavior it guards, and the commands you ran with their results. Delete tests you find that only mirror the code, assert nothing, or duplicate another test, and list them as removed.
