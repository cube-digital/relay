---
name: relay-lanes
description: Use to show a relay plan's blueprint — which tasks share a lane, which lanes run in parallel, wave by wave.
---
# Relay lanes

Resolve this SKILL.md to its absolute real path; the installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`; substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Plan: the user’s arguments (when empty, run `ls -t docs/relay/plans` on its own and use the first file; say which).

Run `relay lanes <plan>`  and show its output to the user unchanged, in a code block. If it reports errors, list each with the plan line to change. Do not run or write anything else.
