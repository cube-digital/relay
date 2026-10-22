---
description: Run a relay plan now — parallel worktree lanes, reviews, merges — while you keep working in this session.
argument-hint: "[--unattended] [plan.md]"
allowed-tools: Bash(relay *) Bash(ls *) Bash(git status*) Bash(git add *) Bash(git commit *)
disable-model-invocation: true
---
Plan: $ARGUMENTS (when empty, run `ls -t docs/relay/plans` on its own and use the first file; say which).

`relay` is on your PATH: run it by name, one command per call.

**Unattended.** When the arguments start with `--unattended` (a launch from relay HQ: nobody can answer, and the process ends with your turn), drop that flag and never ask: at critical in step 1, end with `RELAY_LEG: PAUSED — budget critical`; any other uncommitted change in step 2 ends with `RELAY_LEG: BLOCKED — uncommitted changes`; in step 3 go on. In step 4 dispatch the conductor in the foreground, tell it the run is unattended, and wait for it; skip step 5. Relay its report as in step 6 and end your final message with the conductor's `RELAY_LEG: DONE | PAUSED | BLOCKED — <reason>` line.

1. `relay budget`. At critical, stop: say when the window resets and offer `/relay:marathon <plan> <hours>`, which waits for it.
2. `git status --porcelain`. If the only uncommitted files are this plan, its spec and its requirements document (`docs/relay/requirements/<slug>.md`, when there is one), commit them: `git add <those files>` then `git commit -m "relay: plan <slug>"`. Any other uncommitted change: stop and ask.
3. `relay forecast <plan>`. Show its usage, windows and time lines. If it needs more than one 5h window, say so and recommend `/relay:marathon <plan> <hours>`; continue here only if the user still wants to.
4. Dispatch the conductor agent in the background with: "Run the relay plan at <absolute plan path> with the run-lanes skill (`${CLAUDE_PLUGIN_ROOT}/skills/run-lanes/SKILL.md`), start to finish." The conductor coordinates on a mid-tier model and keeps this conversation small.
5. Tell the user in two lines: it is running in the background; `/relay:status` shows where it is. Then stop; do not poll.
6. When the conductor returns, relay its report: integration branch, waves, per-lane status, tests added and removed, every ruling, and what the user must decide. Merging the integration branch is the user's call.
