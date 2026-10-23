---
name: relay-calibrate
description: Use to teach relay's forecast your account's real usage and speed from a finished run, or show the current calibration.
---
# Relay calibrate

Resolve this SKILL.md to its absolute real path; the installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`; substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Plan: the user’s arguments

With a plan, run `relay calibrate <plan>`; without one, run `relay calibrate --show`. Show the output unchanged, in a code block, then one line on what it means for the next forecast.
