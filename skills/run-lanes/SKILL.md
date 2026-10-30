---
name: run-lanes
description: Use when executing a Relay plan through worktree lanes.
---

Resolve this SKILL.md to its absolute real path. The installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`. Substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Write instructions as strict STE-style drafts. Use short sentences, clear actors, and consistent terms. Keep code, commands, paths, identifiers, output markers, quotations, and evidence exact. For teacher explanations, adapt the words and detail to the learner. Use examples, analogies, and diagrams when they help.

Read `<absolute-relay-root>/skills/using-relay/references/language-guide.md` and `<absolute-relay-root>/skills/using-relay/references/software-glossary.md`. Substitute the resolved installed root for `<absolute-relay-root>` in actual reads. If the references are unavailable, keep the inline policy. Report unavailable language guidance. Do not claim that the full language review passed. Do not load an unrelated coding workflow as a fallback. Load these references directly. Do not run the `using-relay` workflow to load language rules.

# Run lanes

Coordinate the run. Never implement, test, or fix code in this context. Use the `relay` CLI for mechanical actions. Do not pause between tasks or waves to check in. Stop only for the reasons under **Stop**.

Record every event with `relay ledger <plan> "<line>"`. After compaction, trust `relay ledger <plan>` and `git log` over your recollection. Never re-dispatch a lane the ledger marks complete.

## 0. Setup (once)

1. `relay budget --harness <harness>`. If critical, stop and say so.
2. `relay lanes <plan> --write`. If it reports errors, the plan goes back to the plan-with-tiers skill.
3. Read the plan once. Ledger: `start: <n> tasks, <lanes> lanes, <waves> waves` (this exact line; `relay calibrate` reads it).

## 1. Each wave

1. `relay worktrees sync <plan> --wave N`. It prints each lane's worktree and its agents: usually one (`lane-<id>`). A lane holding a strong task is split into segments (`lane-<id>`, then `lane-<id>-s2`, ...) that run one after the other in the same worktree, so routine tasks stay off the most expensive model. It also writes the briefs and `.relay/lanes/active.json`.
2. **Tests first for risky lanes.** For each lane with risk medium or high whose tasks budget new tests: dispatch the test-author (named `lane-<id>-tests`) with the brief path and the spec. When it returns, `relay protect add <the paths it lists>`. Ledger it.
3. **Dispatch all lanes of the wave in parallel** (each lane's first segment. A lane's next segment starts when the previous one returns DONE), with the role and agent name `sync` printed:
   - Claude Code: agent `relay:<role>` with `name` set to the printed agent name (`lane-<id>`, `lane-<id>-s2`, ...). Relay's mod moves any agent named `lane-<id>` or `lane-<id>-<suffix>` into that lane's worktree.
   - Codex: spawn `relay-<role>` with explicit model and reasoning effort, and start the prompt with `Work only in <worktree path>; cd there first.` Keep at most three agents open; close each finished agent you will not resume (host reference).
   - The dispatch holds: one line on where the lane fits, the brief path ("read this first. It is your requirements"), interface facts from earlier waves the brief cannot know, your ruling on any ambiguity you noticed, and the report path. Nothing else: no plan text, no history.
4. **Handle each return** as it arrives:
   - DONE / DONE_WITH_CONCERNS → `relay worktrees pack <plan> <lane>` and dispatch the reviewer with the brief, report and package paths. For lanes with risk high, or when the budget is tight, let Codex review instead: `codex exec --sandbox read-only -o <review path> "Review per <absolute-relay-root>/roles/reviewer.md: brief <path>, report <path>, package <path>"`. A different model family has different blind spots, and it spends the other subscription's window.
   - NEEDS_CONTEXT → answer from the plan and spec, resume the same agent.
   - BLOCKED → decide: missing context (resume with it), too hard (escalate, below), plan wrong (rule, ledger the ruling, resume with it).
5. **Fix loop** when the review has spec ❌ or Critical/Important findings. Minor findings go to the ledger as `deferred minor` and never enter the loop.
   - Rounds 1–3: resume the same lane agent with the findings verbatim. Its context is warm.
   - Rounds 4–5: dispatch implementer-deep (named `lane-<id>-r<round>`) with brief, report and findings: "a previous implementer tried <n> times. You own it now".
   - Each round: `relay worktrees pack <plan> <lane> --from <head the last review saw>` and a scoped re-review.
   - After round 5, adjudicate each open finding yourself: park it (`Ruling: ...`) or, if later work builds on it, rule the smallest change and carry it into the next wave's dispatches.
6. **Merge the wave** when every lane is clean or parked: `relay worktrees merge <plan> --wave N --suite`. The full suite runs here once. A conflict or a red suite: resume the responsible lane with the exact failure, then merge again.
7. Ledger `wave N: merged @ <sha>, suite <pass/fail>` (this exact shape. It is a calibration sample). `relay budget --harness <harness>`. Then the next wave.

## 2. Finish

1. `relay worktrees pack <plan> --final`. Dispatch the architect for the final review with the package, the ledger's deferred minors and rulings, and the plan's Review Focus.
2. Findings → one fix dispatch with the whole list, one scoped re-review, adjudicate the rest. No second wave of fixes.
3. Ledger `plan: complete (relay/<slug>/integration @ <sha>)`, then `relay calibrate <plan>` so the next forecast uses this run's real rates. Report to the human: the integration branch, waves, per-lane status, tests added/removed, and every line of `relay ledger <plan> --rulings`. Then `relay worktrees clean <plan>`. Merging into their branch is the human's call.

## Unattended runs

Inside `relay marathon` nobody can answer questions. Rule and continue on everything but the four reasons under **Stop**. At critical budget finish in-flight lanes, merge, write the handoff and end your turn. End your final message with one line, `RELAY_LEG: DONE | PAUSED | BLOCKED — <reason>`, so the marathon knows whether to wait for the next window, start the next leg, or hand the problem to the human.

## Budget during the run

Check `relay budget --harness <harness>` before each wave and after each merge. tight: implementer-deep only after round 3. Reviews on mid tier; Codex takes reviews. critical: finish in-flight lanes and their fix rounds, merge, write a handoff with the handoff skill, stop. Never start a wave at critical.

## Stop

Only for: an irreversible or destructive step, a security-sensitive action, a side effect outside the repository (push, publish, deploy), a plan so broken every path is a guess, or a critical budget. Everything else is a ruling you record and continue past.
