---
description: Run a relay plan now — parallel worktree lanes, reviews, merges — while you keep working in this session.
argument-hint: "[plan.md]"
allowed-tools: Bash(relay *) Bash(ls *) Bash(git status*) Bash(git add *) Bash(git commit *)
disable-model-invocation: true
---
Plan: $ARGUMENTS (when empty, run `ls -t docs/relay/plans` on its own and use the first file; say which).

`relay` is on your PATH: run it by name, one command per call.

1. `relay budget`. At critical, stop: say when the window resets and offer `/relay:marathon <plan> <hours>`, which waits for it.
2. `git status --porcelain`. If the only uncommitted files are this plan and its spec, commit them: `git add <plan> <spec>` then `git commit -m "relay: plan <slug>"`. Any other uncommitted change: stop and ask.
3. `relay forecast <plan>`. Show its usage, windows and time lines. If it needs more than one 5h window, say so and recommend `/relay:marathon <plan> <hours>`; continue here only if the user still wants to.
4. Dispatch the conductor agent in the background with: "Run the relay plan at <absolute plan path> with the run-lanes skill (`${CLAUDE_PLUGIN_ROOT}/skills/run-lanes/SKILL.md`), start to finish." The conductor coordinates on a mid-tier model and keeps this conversation small.
5. Tell the user in two lines: it is running in the background; `/relay:status` shows where it is. Then stop; do not poll.
6. When the conductor returns, relay its report: integration branch, waves, per-lane status, tests added and removed, every ruling, and what the user must decide. Merging the integration branch is the user's call.
