---
name: relay-forecast
description: Use to forecast a relay plan before running it — agents, worktrees, parallel lanes, usage windows and hours.
---
# Relay forecast

Resolve this SKILL.md to its absolute real path; the installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`; substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Plan: the user’s arguments (when empty, run `ls -t docs/relay/plans` on its own and use the first file; say which).

Run `relay forecast <plan>`  and show its output to the user unchanged, in a code block. Then at most three lines: whether the run fits one 5-hour window or how many it spans, whether it fits what is left of the weekly limit, and, if the rates say PLACEHOLDER, that `/relay:calibrate <plan>` after the first real run makes them real.
