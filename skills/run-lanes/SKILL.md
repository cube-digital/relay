---
name: run-lanes
description: Use when executing a Relay plan through worktree lanes.
---

Resolve this SKILL.md to its absolute real path. The installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/scripts/relay.mjs" <args>`. Substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Write instructions as strict STE-style drafts. Use short sentences, clear actors, and consistent terms. Keep code, commands, paths, identifiers, output markers, quotations, and evidence exact. For teacher explanations, adapt the words and detail to the learner. Use examples, analogies, and diagrams when they help.

Read `<absolute-relay-root>/skills/using-relay/references/language-guide.md` and `<absolute-relay-root>/skills/using-relay/references/software-glossary.md`. Substitute the resolved installed root for `<absolute-relay-root>` in actual reads. If the references are unavailable, keep the inline policy. Report unavailable language guidance. Do not claim that the full language review passed. Do not load an unrelated coding workflow as a fallback. Load these references directly. Do not run the `using-relay` workflow to load language rules.

# Run lanes

Coordinate the run. Never implement, test, or fix code in this context. Use the `relay` CLI for mechanical actions. Do not pause between tasks or waves to check in. Stop only for the reasons under **Stop**.

Record every event with `relay ledger <plan> "<line>"`. After compaction, trust `relay ledger <plan>` and `git log` over your recollection. Never re-dispatch a lane the ledger marks complete.

## 0. Setup (once)

1. `relay budget --harness <harness>`. If critical, stop and say so.
2. `relay lanes <plan> --write`. If it reports errors, the plan goes back to the plan-with-tiers skill. The command also prints the flow of the plan and the pieces that each lane can get.
3. Read the plan once. Ledger: `start: <n> tasks, <lanes> lanes, <waves> waves` (this exact line; `relay calibrate` reads it).

## 1. Each wave

1. `relay worktrees sync <plan> --wave N`. It prints each lane's worktree and its agents: usually one (`lane-<id>`). A lane holding a strong task, or a task with its own role (such as platform-engineer), is split into segments (`lane-<id>`, then `lane-<id>-s2`, ...). The segments run one after the other in the same worktree, each as its own role, so routine tasks stay off the most expensive model. It also writes the briefs and `.relay/lanes/active.json`.
2. **Pieces before each lane.** Run the piece rule (see **Pieces**) at `lane.before` for each lane of the wave. Run all lanes in parallel. A lane's implementer starts when its blocking `lane.before` pieces are DONE. The flow supplies tests first for risky lanes (the `acceptance-tests` piece).
3. **Dispatch all lanes of the wave in parallel** (each lane's first segment. A lane's next segment starts when the previous one returns DONE), with the role and agent name `sync` printed:
   - Claude Code: agent `relay:<role>` with `name` set to the printed agent name (`lane-<id>`, `lane-<id>-s2`, ...). Relay's mod moves any agent named `lane-<id>` or `lane-<id>-<suffix>` into that lane's worktree.
   - Codex: spawn `relay-<role>` with explicit model and reasoning effort, and start the prompt with `Work only in <worktree path>; cd there first.`
   - The dispatch holds: one line on where the lane fits, the brief path ("read this first. It is your requirements"), interface facts from earlier waves the brief cannot know, your ruling on any ambiguity you noticed, and the report path. Nothing else: no plan text, no history.
4. **Handle each return** as it arrives:
   - DONE / DONE_WITH_CONCERNS → `relay worktrees pack <plan> <lane>` and dispatch the reviewer with the brief, report and package paths. For lanes with risk high, or when the budget is tight, let Codex review instead: `codex exec --sandbox read-only -o <review path> "Review per <absolute-relay-root>/roles/reviewer.md: brief <path>, report <path>, package <path>"`. A different model family has different blind spots, and it spends the other subscription's window. Tell the reviewer its findings path: the package path with `.review.md` replaced by `.findings.md`. For Codex, that is the `-o` path. At the same time, run the piece rule at `lane.after` for the lane. Start the fix loop of the lane only after these steps: the reviewer returned, each `lane.after` piece returned, and `relay flow done` ran for each piece. A read-only piece that checks a lane after a fix commit reports a false `blocked`.
   - NEEDS_CONTEXT → answer from the plan and spec, resume the same agent.
   - BLOCKED → decide: missing context (resume with it), too hard (escalate, below), plan wrong (rule, ledger the ruling, resume with it).
5. **Fix loop** when the review has spec ❌ or Critical/Important findings, or when a blocking `lane.after` piece reported them. Minor findings go to the ledger as `deferred minor` and never enter the loop.
   - Rounds 1–3: resume the same lane agent with the findings verbatim (from the reviewer and from the pieces). Its context is warm.
   - Rounds 4–5: dispatch implementer-deep (named `lane-<id>-r<round>`) with brief, report and findings: "a previous implementer tried <n> times. You own it now".
   - Each round: `relay worktrees pack <plan> <lane> --from <head the last review saw>` and a scoped re-review. The findings go to the `.findings.md` path of the new package. If a piece had findings in the round, run that piece again through the piece rule on the fixed lane.
   - After round 5, adjudicate each open finding yourself: park it (`Ruling: ...`) or, if later work builds on it, rule the smallest change and carry it into the next wave's dispatches.
6. **Merge the wave** when every lane is clean or parked: `relay worktrees merge <plan> --wave N --suite`. The full suite runs here once. A conflict or a red suite: resume the responsible lane with the exact failure, then merge again.
7. Ledger `wave N: merged @ <sha>, suite <pass/fail>` (this exact shape. It is a calibration sample). Run the piece rule at `wave.after`. `relay budget --harness <harness>`. Then the next wave.

## 2. Finish

1. `relay worktrees pack <plan> --final`. Dispatch the architect for the final review (findings to `final.findings.md`) with the package, the ledger's deferred minors and rulings, and the plan's Review Focus. At the same time, run the piece rule at `final`.
2. Findings (from the architect and from the blocking `final` pieces) → one fix dispatch with the whole list, one scoped re-review, adjudicate the rest. No second wave of fixes.
3. Ledger `plan: complete (relay/<slug>/integration @ <sha>)`, then `relay calibrate <plan>` so the next forecast uses this run's real rates. Report to the human: the integration branch, waves, per-lane status, tests added/removed, every line of `relay ledger <plan> --rulings`, and the findings of advisory pieces. Then `relay worktrees clean <plan>`. Merging into their branch is the human's call.

## Pieces

The data in `flows/` and `pieces/` sets which extra steps run, where, and when. The CLI resolves this data. Do not decide it yourself. The points are `lane.before` and `lane.after` for each lane, and `wave.after` and `final` for each plan. At a point:

1. Run `relay flow at <plan> <point> [--lane <id>]`. It lists each piece that applies, with its role, gate, agent name, brief path, and report path. It also lists the skipped pieces with the reason and records the skips in the ledger.
2. Dispatch each listed piece as its role, under the agent name that the command printed, with one line: "Read <brief>; it is your instruction. Write your report to <report>."
   - Claude Code: agent `relay:<role>` with `name` set to that agent name. The mod puts `lane-<id>-<piece>` in the worktree of the lane.
   - Codex: `relay-<role>` with explicit model and effort. For a lane piece, start the prompt with `Work only in <worktree path>; cd there first.`
   - Lane pieces of a wave run in parallel with the other lanes, as lane agents do.
3. When a piece returns, run `relay flow done <plan> <piece> [--lane <id>] --status pass|findings|blocked --report <report> [--protect <paths it listed>]`. Exit 1 for a read-only piece means that the piece committed. The ledger lists the commits. Rule on them. The CLI does not reset anything.
4. Gate `blocking`: handle Critical/Important findings as reviewer findings. For a lane, use the fix loop of the lane. At `final`, use the single fix dispatch. Gate `advisory`: ledger `deferred: <piece>: <finding>` and list these findings in the final report.
5. If a piece returns BLOCKED or NEEDS_CONTEXT, handle it as a return from a lane agent.

## Unattended runs

Inside `relay marathon`, and in a run started with `--unattended` (a launch from relay HQ), nobody can answer questions. Rule and continue on everything but the four reasons under **Stop**. At critical budget finish in-flight lanes, merge, write the handoff and end your turn. End your final message with one line, `RELAY_LEG: DONE | PAUSED | BLOCKED — <reason>`, so the marathon or HQ knows whether to wait for the next window, start the next leg, or hand the problem to the human.

## Budget during the run

Check `relay budget --harness <harness>` before each wave and after each merge. tight: implementer-deep only after round 3. Reviews on mid tier; Codex takes reviews. critical: finish in-flight lanes and their fix rounds, merge, write a handoff with the handoff skill, stop. Never start a wave at critical.

## Stop

Only for: an irreversible or destructive step, a security-sensitive action, a side effect outside the repository (push, publish, deploy), a plan so broken every path is a guess, or a critical budget. Everything else is a ruling you record and continue past.
