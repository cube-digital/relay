---
name: using-relay
description: Use at the start of Relay design, implementation, ticket preparation, teaching, research, or delegated work.
---
# Relay rules

Resolve this SKILL.md's real path. The installed root is two directories above its directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`. Use this root in reads, calls, and briefs; do not use target-project copies or require `relay` on PATH.

Write strict STE-style instruction drafts: short sentences, clear actors, consistent terms. Preserve code, commands, paths, identifiers, markers, quotations, and evidence. Adapt explanations to the learner; use examples, analogies, and diagrams when useful.

Read `language-guide.md` and `software-glossary.md` in that references directory. If unavailable, retain the inline policy and disclose the gap. Do not claim a full language review or activate unrelated workflows as fallback.

## Design

For architecture choices or documents, load `<relay-root>/skills/relay-design/SKILL.md` as the current lead. Concept questions can use teaching or a direct answer. Accepted designs go to `relay-plan` when planning is requested. Preserve decisions and authorization; design alone does not start planning or coding.

## Research

Load `<relay-root>/skills/relay-teach/SKILL.md` for teaching or `<relay-root>/skills/relay-reverse-engineer/SKILL.md` for reconstruction. Both use `research-and-explain` with the lead here. No coding plans, lanes, worktrees, tests, installation, commits, or persistence. Lead answers follow requested depth, without the worker's eight-line limit.

## Tickets

When an existing plan, specification, or agreed discussion needs implementable tickets, load `<relay-root>/skills/relay-to-tickets/SKILL.md`. Prepare tickets in the current conversation. Preserve the source decisions. Ticket preparation does not start implementation, create a second plan, or publish to a tracker without a request.

## Implementation

1. **Plan first.** Use `plan-with-tiers` for multi-step implementation. Decide each task's tier, risk, files, deps, test budget, and `done` check at plan time.
2. Use `run-lanes` for plans. Related tasks share a lane and worktree. Use one implementer and one commit per task. Coding workers write reports and return at most 8 lines.
3. Follow `qa-mindset`. Respect test budgets. Use narrow checks first. Never rerun unchanged tests or edit protected tests.

## Dispatch

Use Relay roles: scout for search; implementer-fast / implementer / implementer-deep to build; test-author for acceptance tests; reviewer for code review; architect for design, plans, and architectural review; conductor for whole plans; teacher for teaching/research; reverse-engineer for reconstruction. Helpers with `mode=research-only` or `mode=design-review` cannot delegate.

Claude names: `relay:<role>`. Codex names: `relay-<role>`. Follow the host reference for supported fallback and clean spawns. Set Codex model and effort from routing. Supply the installed root in task context. Briefs contain no file contents or session history except role instructions for supported fallback.

## Budget and cache

Read `relay budget --harness <harness>`. Normal: use plan tiers. Tight or unknown: keep Opus for final review. Prefer cheap tiers for complete planned code.

At critical during implementation, finish the current wave. Commit. Write a handoff with `handoff`. Start nothing new. During design or research at critical, start no helpers. Finish the bounded answer or requested document and disclose gaps. Do not commit or start an implementation handoff.

Keep the session's model and effort to retain its cache. Use `/clear` between unrelated tasks.
