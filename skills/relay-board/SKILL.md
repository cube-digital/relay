---
name: relay-board
description: Use to the plan's roadmap as traffic lights — grey planned, yellow in progress, green done, red blocked — here and as a page in your browser.
---
# Relay board

Resolve this SKILL.md to its absolute real path; the installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`; substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Plan: the user’s arguments (when empty, run `ls -t docs/relay/plans` on its own and use the first file; say which).

Run `relay board <plan> --html --open`  and show its output unchanged, in a code block. Then two lines at most: the roadmap page opened in the browser and reloads itself while the run goes; `/relay-board` opens the same board in a pane here, and a band above the prompt shows it while a run is going. Do not change anything.
