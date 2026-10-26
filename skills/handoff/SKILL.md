---
name: handoff
description: Use when usage turns critical, context is getting long, or work must continue in a fresh session or another harness.
---

Resolve this SKILL.md to its absolute real path. The installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`. Substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Write instructions as strict STE-style drafts. Use short sentences, clear actors, and consistent terms. Keep code, commands, paths, identifiers, output markers, quotations, and evidence exact. For teacher explanations, adapt the words and detail to the learner. Use examples, analogies, and diagrams when they help.

Read `<absolute-relay-root>/skills/using-relay/references/language-guide.md` and `<absolute-relay-root>/skills/using-relay/references/software-glossary.md`. Substitute the resolved installed root for `<absolute-relay-root>` in actual reads. If the references are unavailable, keep the inline policy. Report unavailable language guidance. Do not claim that the full language review passed. Do not load an unrelated coding workflow as a fallback. Load these references directly. Do not run the `using-relay` workflow to load language rules.

# Handoff

Write `HANDOFF.md` at the repository root (or `.relay/runs/<slug>/HANDOFF.md` during a plan run). At most 60 lines:

1. **Goal**: one sentence, and the plan or spec path.
2. **State**: branch and HEAD sha. For a plan run, `relay worktrees status` and the last 10 lines of `relay ledger <plan>`.
3. **Done**: what is finished and verified, with the command that verified it.
4. **In flight**: what is half done, where (files, lane), and what is uncommitted. Commit work in progress first, with `WIP:` in the message, so nothing lives only in a worktree's working tree.
5. **Next**: the next three concrete steps, the first one doable without reading anything else.
6. **Decisions**: every ruling made, with why (copy `relay ledger <plan> --rulings`).
7. **Don't**: approaches that were tried and failed, so nobody retries them.

Then tell the human: the file path, when the budget window resets (`relay budget --harness <harness>`), and the one line to start the next session: `Read HANDOFF.md and continue from "Next".` Recommend `/clear` (or a new session) over continuing in a long context.
