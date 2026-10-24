---
name: relay-budget
description: Use to show the 5-hour and weekly usage level relay is routing by — normal, tight or critical.
---
# Relay budget

Resolve this SKILL.md to its absolute real path; the installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`; substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Run `relay budget` and show its output unchanged, in a code block, then one line on what relay does at that level: normal routes by plan tier; tight keeps Opus for the final review only; critical finishes the current wave, writes a handoff and starts nothing new; unknown acts as tight.
