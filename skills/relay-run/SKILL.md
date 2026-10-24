---
name: relay-run
description: Use to run a relay plan now — parallel worktree lanes, reviews, merges — while you keep working in this session.
---
# Relay run

Resolve this SKILL.md to its absolute real path; the installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`; substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Plan: the user’s arguments (when empty, run `ls -t docs/relay/plans` on its own and use the first file; say which).



1. `relay budget`. At critical, stop: say when the window resets and offer `/relay:marathon <plan> <hours>`, which waits for it.
2. `git status --porcelain`. If the only uncommitted files are this plan and its spec, commit them: `git add <plan> <spec>` then `git commit -m "relay: plan <slug>"`. Any other uncommitted change: stop and ask.
3. `relay forecast <plan>`. Show its usage, windows and time lines. If it needs more than one 5h window, say so and recommend `/relay:marathon <plan> <hours>`; continue here only if the user still wants to.
4. Dispatch the conductor agent using the active harness’s supported background or collaboration facility with: "Run the relay plan at <absolute plan path> with the run-lanes skill (`<relay-root>/skills/run-lanes/SKILL.md`), start to finish." The conductor coordinates on a mid-tier model and keeps this conversation small.
5. If background execution is supported, report its status and return. Otherwise follow the run-lanes skill in the current task and wait for the dispatched work to finish.
6. When the conductor returns, relay its report: integration branch, waves, per-lane status, tests added and removed, every ruling, and what the user must decide. Merging the integration branch is the user's call.
