---
name: relay-status
description: Use to where a relay plan's run is — ledger, lanes, budget, and the marathon if one is running.
---
# Relay status

Resolve this SKILL.md to its absolute real path; the installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`; substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Plan: the user’s arguments (when empty, run `ls -t docs/relay/plans` on its own and use the first file; say which).

Run, one per call: `relay board <plan>`, `relay budget`, `relay marathon <plan> --status`. Show the board's output unchanged, in a code block. Then at most five lines: what is in progress or blocked and why (from the lane notes), rulings so far, the budget level, and whether a marathon is running or waiting for a reset. For details run `relay ledger <plan>`. Do not dispatch or change anything.
