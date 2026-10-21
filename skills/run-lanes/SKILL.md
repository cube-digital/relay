---
name: run-lanes
description: Use when executing a relay plan. Runs its tasks as parallel worktree lanes in waves, with one implementer per lane, a review per lane, bounded fix loops and one full test run per wave.
---
# Run lanes

You coordinate. You never implement, test or fix code in this context: that keeps it small and cheap. Everything mechanical goes through the `relay` CLI. Do not pause between tasks or waves to check in; stop only for the reasons under **Stop**.

The ledger is your memory: `relay ledger <plan> "<line>"` after every event. After compaction, trust `relay ledger <plan>` and `git log` over your recollection; never re-dispatch a lane the ledger marks complete.

## 0. Setup (once)

1. `relay budget`. If critical, stop and say so.
2. `relay lanes <plan> --write`. If it reports errors, the plan goes back to the plan-with-tiers skill. It prints the plan's flow and the pieces each lane may get.
3. Read the plan once. Ledger: `start: <n> tasks, <lanes> lanes, <waves> waves` (this exact line; `relay calibrate` reads it).

## 1. Each wave

1. `relay worktrees sync <plan> --wave N`. It prints each lane's worktree and its agents: usually one (`lane-<id>`); a lane holding a strong task, or a task with its own role (such as platform-engineer), is split into segments (`lane-<id>`, then `lane-<id>-s2`, ...) that run one after the other in the same worktree, each as its own role, so routine tasks stay off the most expensive model. It also writes the briefs and `.relay/lanes/active.json`.
2. **Pieces before each lane.** Run the piece rule at `lane.before` for every lane of the wave, all lanes in parallel. A lane's implementer starts when its blocking `lane.before` pieces are DONE.
3. **Dispatch all lanes of the wave in parallel** (each lane's first segment; a lane's next segment starts when the previous one returns DONE), with the role and agent name `sync` printed:
   - Claude Code: agent `relay:<role>` with `name` set to the printed agent name (`lane-<id>`, `lane-<id>-s2`, ...). Relay's mod moves any agent named `lane-<id>` or `lane-<id>-<suffix>` into that lane's worktree.
   - Codex, or Claude Code without the mod: spawn `relay-<role>` with explicit model and reasoning effort, and start the prompt with `Work only in <worktree path>; cd there first.`
   - The dispatch holds: one line on where the lane fits, the brief path ("read this first; it is your requirements"), interface facts from earlier waves the brief cannot know, your ruling on any ambiguity you noticed, and the report path. Nothing else: no plan text, no history.
4. **Handle each return** as it arrives:
   - DONE / DONE_WITH_CONCERNS → `relay worktrees pack <plan> <lane>` and dispatch the reviewer with the brief, report and package paths. For lanes with risk high, or when the budget is tight, let Codex review instead: `codex exec --sandbox read-only -o <review path> "Review per roles/reviewer.md: brief <path>, report <path>, package <path>"`. A different model family has different blind spots, and it spends the other subscription's window. The reviewer writes its findings to the package path with `.review.md` replaced by `.findings.md` (for Codex that is the `-o` path); tell it so. At the same time run the piece rule at `lane.after` for the lane. Start the lane's fix loop only when the reviewer and every `lane.after` piece have returned and `relay flow done` ran for each: a read-only piece checked after a fix commit reports a false `blocked`.
   - NEEDS_CONTEXT → answer from the plan and spec, resume the same agent.
   - BLOCKED → decide: missing context (resume with it), too hard (escalate, below), plan wrong (rule, ledger the ruling, resume with it).
5. **Fix loop** when the review has spec ❌ or Critical/Important findings, or a blocking `lane.after` piece reported them. Minor findings go to the ledger as `deferred minor` and never enter the loop.
   - Rounds 1–3: resume the same lane agent with the findings verbatim (the reviewer's and the pieces'). Its context is warm.
   - Rounds 4–5: dispatch implementer-deep (named `lane-<id>-r<round>`) with brief, report and findings: "a previous implementer tried <n> times; you own it now".
   - Each round: `relay worktrees pack <plan> <lane> --from <head the last review saw>` and a scoped re-review (findings go to the new package's `.findings.md` path). A piece whose findings were in the round runs again through the piece rule on the fixed lane.
   - After round 5, adjudicate each open finding yourself: park it (`Ruling: ...`) or, if later work builds on it, rule the smallest change and carry it into the next wave's dispatches.
6. **Merge the wave** when every lane is clean or parked: `relay worktrees merge <plan> --wave N --suite`. The full suite runs here once. A conflict or a red suite: resume the responsible lane with the exact failure, then merge again.
7. Ledger `wave N: merged @ <sha>, suite <pass/fail>` (this exact shape; it is a calibration sample). Run the piece rule at `wave.after`. `relay budget`; then the next wave.

## 2. Finish

1. `relay worktrees pack <plan> --final`; dispatch the architect for the final review (findings to `final.findings.md`) with the package, the ledger's deferred minors and rulings, and the plan's Review Focus. At the same time run the piece rule at `final`.
2. Findings (the architect's and the blocking `final` pieces') → one fix dispatch with the whole list, one scoped re-review, adjudicate the rest. No second wave of fixes.
3. Ledger `plan: complete (relay/<slug>/integration @ <sha>)`, then `relay calibrate <plan>` so the next forecast uses this run's real rates. Report to the human: the integration branch, waves, per-lane status, tests added/removed, and every line of `relay ledger <plan> --rulings`, and the findings of advisory pieces. Then `relay worktrees clean <plan>`. Merging into their branch is the human's call.

## Pieces

Which extra steps run, where and when, is data in `flows/` and `pieces/`; the CLI resolves it, you never decide it. At a point (`lane.before` and `lane.after` per lane, `wave.after` and `final` per plan):

1. `relay flow at <plan> <point> [--lane <id>]`. It lists each piece that applies with its role, gate, agent name, brief and report paths, and the skipped ones with the reason (it ledgers skips itself).
2. Dispatch each listed piece as its role under the agent name it printed, with one line: "Read <brief>; it is your instruction. Write your report to <report>." Claude Code: agent `relay:<role>` with `name` set to that agent name (the mod puts `lane-<id>-<piece>` in the lane's worktree). Codex: `relay-<role>` with explicit model and effort, and for a lane piece start with `Work only in <worktree path>; cd there first.` Lane pieces of a wave run in parallel with the other lanes, as lane agents do.
3. When it returns: `relay flow done <plan> <piece> [--lane <id>] --status pass|findings|blocked --report <report> [--protect <paths it listed>]`. Exit 1 for a read-only piece means it committed: the ledger lists the commits; rule on them. Nothing is reset for you.
4. Gate `blocking`: Critical/Important findings are handled like a reviewer's (the lane's fix loop; at `final`, the single fix dispatch). Gate `advisory`: ledger `deferred: <piece>: <finding>` and list them in the final report.
5. BLOCKED or NEEDS_CONTEXT from a piece: handle it as from a lane agent.

## Unattended runs

Inside `relay marathon` nobody can answer questions. Rule and continue on everything but the four reasons under **Stop**; at critical budget finish in-flight lanes, merge, write the handoff and end your turn. End your final message with one line, `RELAY_LEG: DONE | PAUSED | BLOCKED — <reason>`, so the marathon knows whether to wait for the next window, start the next leg, or hand the problem to the human.

## Budget during the run

Check `relay budget` before each wave and after each merge. tight: implementer-deep only after round 3; reviews on mid tier; Codex takes reviews. critical: finish in-flight lanes and their fix rounds, merge, write a handoff with the handoff skill, stop. Never start a wave at critical.

## Stop

Only for: an irreversible or destructive step, a security-sensitive action, a side effect outside the repository (push, publish, deploy), a plan so broken every path is a guess, or a critical budget. Everything else is a ruling you record and continue past.
