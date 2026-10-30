---
name: using-relay
description: Use when starting a conversation or when the task changes.
---
# Relay rules

If you are an assigned worker, follow your role and task. Skip this lead workflow.

## Skill selection

Before responding or acting, check the request, context, and skill descriptions. Include clarification and source inspection. If a Relay skill may apply, load and follow it first. Users need not name Relay. Check again when the task changes. Reuse loaded instructions. Announce the skill and purpose.

User instructions take precedence. Preserve decisions, scope, and authorization. Continue the active workflow when applicable. If no skill applies, respond directly.

## Resources and language

Resolve this SKILL.md's real path. `<relay-root>` is two directories above its directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`. Resolve bundled resources there; do not use project copies or PATH.

Read `language-guide.md` and `software-glossary.md` there. Write short STE-style drafts with clear actors and consistent terms. Preserve code, commands, paths, identifiers, markers, quotations, and evidence. Adapt explanations to the learner. If references are unavailable, retain this policy and report the gap. Do not claim a full language review or load unrelated workflows.

## Design

For architecture choices or documents, load `relay-design` here. Concept questions can use teaching or a direct answer. Use `relay-plan` for requested planning of accepted designs. Design alone does not start planning or coding.

## Research

Load `relay-teach` for teaching or `relay-reverse-engineer` for reconstruction. Both use `research-and-explain` here. No coding plans, lanes, worktrees, tests, installation, commits, or persistence. Lead answers follow requested depth, without the worker's eight-line limit.

## Tickets

For tickets from an existing plan, specification, or agreed discussion, load `relay-to-tickets`. Preserve source decisions. Prepare tickets here. Ticket preparation does not start implementation, create a second plan, or publish without a request.

## Implementation

1. **Plan first.** Use `plan-with-tiers` for multi-step implementation. Set each task's tier, risk, files, deps, test budget, and `done` check.
2. Use `run-lanes` to execute an existing plan when authorized. Related tasks share a lane and worktree. Use one implementer and one commit per task. Workers write reports and return at most 8 lines.
3. Follow `qa-mindset`. Respect test budgets. Use narrow checks first. Never rerun unchanged tests or edit protected tests.

## Dispatch

Use Relay roles: scout for search; implementer-fast / implementer / implementer-deep to build; test-author for acceptance tests; reviewer for review; architect for design, plans, and architectural review; conductor for plans; teacher for teaching/research; reverse-engineer for reconstruction. Helpers with `mode=research-only` or `mode=design-review` cannot delegate.

Claude: `relay:<role>`. Codex: `relay-<role>`. Follow the host reference for fallback and clean spawns. Set Codex model and effort from routing on every clean spawn. Supply the installed root. Briefs contain no file contents or session history except role instructions for supported fallback.

## Budget and cache

Read `relay budget --harness <harness>`. Normal: use plan tiers. Tight or unknown: keep the strong tier for the final review. Prefer cheap tiers for complete planned code.

At critical during implementation, finish the wave, commit, and use `handoff`. Start nothing new. At critical during design or research, start no helpers. Finish the bounded answer or requested document and disclose gaps. Do not commit or start an implementation handoff.

Keep the session's model and effort to retain its cache. Use `/clear` between unrelated tasks.
