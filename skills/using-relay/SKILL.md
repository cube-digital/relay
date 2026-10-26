---
name: using-relay
description: Use at the start of Relay implementation, teaching, research, or delegated work.
---
# Relay rules

Resolve this SKILL.md to its absolute real path. The installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`. Substitute the resolved root in calls, reads, and briefs. Resolve bundled files from that root. Do not require `relay` on PATH or use target-project copies.

Write instructions as strict STE-style drafts. Use short sentences, clear actors, and consistent terms. Keep code, commands, paths, identifiers, output markers, quotations, and evidence exact. For teacher explanations, adapt the words and detail to the learner. Use examples, analogies, and diagrams when they help.

Read `<absolute-relay-root>/skills/using-relay/references/language-guide.md` and `<absolute-relay-root>/skills/using-relay/references/software-glossary.md` directly. If unavailable, keep the inline policy. Report unavailable guidance. Do not claim a full language review or activate unrelated workflows as a fallback.

## Research

For teaching, load `<absolute-relay-root>/skills/relay-teach/SKILL.md`. For reconstruction, load `<absolute-relay-root>/skills/relay-reverse-engineer/SKILL.md`. Both use `research-and-explain`. Act as the lead here. Do not start coding plans, lanes, worktrees, tests, installation, commits, or persistence. Lead answers follow requested depth, without the coding worker's eight-line limit.

## Implementation

1. **Plan first.** Use `plan-with-tiers` for multi-step implementation. Decide each task's tier, risk, files, deps, test budget, and `done` check at plan time.
2. Use `run-lanes` for plans. Related tasks share a lane and worktree. Use one implementer and one commit per task. Coding workers write reports and return at most 8 lines.
3. Follow `qa-mindset`. Respect test budgets. Use narrow checks first. Never rerun unchanged tests or edit protected tests.

## Dispatch

Use Relay roles: scout for search; implementer-fast / implementer / implementer-deep to build; test-author for spec-derived tests; reviewer for review; architect for plans/final review; conductor for whole plans; teacher for independent teaching/research; reverse-engineer for independent reconstruction. Research helpers use `mode=research-only` and cannot delegate.

Claude names are `relay:<role>`. Codex names are `relay-<role>`. Use the host reference's supported custom-type fallback when needed. Set Codex model and reasoning effort from the routing table on each supported clean spawn. Supply the absolute installed root when task context is supported. Do not paste file contents or session history into briefs, except source role instructions for a supported fallback.

## Budget and cache

Read `relay budget --harness <harness>` for the 5-hour/7-day level. At normal, use plan tiers. At tight, keep Opus for final review. Prefer cheap tiers when the plan contains complete code. At unknown, act as tight.

At critical during implementation, finish the current wave. Commit. Write a handoff with `handoff`. Start nothing new. During research at critical, start no helpers. Finish the bounded answer and disclose gaps. Do not commit or start an implementation handoff.

Keep the main model and effort selected at session start. A mid-session switch reads the conversation again without the cache. Use `/clear` between unrelated tasks.
