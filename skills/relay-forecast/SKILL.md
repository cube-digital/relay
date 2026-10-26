---
name: relay-forecast
description: Use before running a plan to estimate agents, worktrees, usage windows, and time.
---

Resolve this SKILL.md to its absolute real path. The installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`. Substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Write instructions as strict STE-style drafts. Use short sentences, clear actors, and consistent terms. Keep code, commands, paths, identifiers, output markers, quotations, and evidence exact. For teacher explanations, adapt the words and detail to the learner. Use examples, analogies, and diagrams when they help.

Read `<absolute-relay-root>/skills/using-relay/references/language-guide.md` and `<absolute-relay-root>/skills/using-relay/references/software-glossary.md`. Substitute the resolved installed root for `<absolute-relay-root>` in actual reads. If the references are unavailable, keep the inline policy. Report unavailable language guidance. Do not claim that the full language review passed. Do not load an unrelated coding workflow as a fallback. Load these references directly. Do not run the `using-relay` workflow to load language rules.

# Relay forecast

Use the user’s arguments as the plan path. If no path is supplied, run `ls -t docs/relay/plans` on its own. Use the first file. State which file you selected.

Run `relay forecast <plan>`. Show its output unchanged in a code block. Use at most three more lines. State how many 5-hour windows the run needs. State whether it fits the remaining weekly limit. If the rates say PLACEHOLDER, explain that `/relay:calibrate <plan>` records real rates after the first run.
