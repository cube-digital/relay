---
name: relay-design
description: Use when designing or revising software architecture, comparing technical approaches, or preparing architecture documentation for planning.
---
# Relay design

Resolve this SKILL.md to its absolute real path. The installed Relay root is two directories above its containing directory. Resolve bundled roles and references from that root, not the target checkout or a copied agent definition. If the root or required guidance is unavailable, report the gap and stop dependent work.

Write instructions as strict STE-style drafts. Use short sentences, clear actors, and consistent terms. Preserve code, paths, identifiers, quotations, and evidence exactly. Adapt explanations to the person's topic familiarity and requested depth. Read `<absolute-relay-root>/skills/using-relay/references/language-guide.md` and `software-glossary.md` from that same directory. If unavailable, retain this inline policy and report the limitation. Do not claim a full language review.

Read `<absolute-relay-root>/roles/architect.md` and [design-method.md](references/design-method.md). Act as that architect in the current conversation. Do not spawn a child lead or change the session model. This is one role and one skill; supporting files are not additional skills.

Use the request, supplied material, and prior decisions. Ask for the subject only if it is absent. A short conceptual explanation does not need this workflow. An accepted design handed over for planning does not need another design discussion. Preserve explicit user direction and existing authorization.

- For external evidence or optional helpers, read [research.md](references/research.md). Accept `max-helpers=0..3` or a natural-language equivalent. The default is a ceiling of three, not a team to start. Clarify invalid values before dispatch; zero is supported.
- When producing or updating architecture documents, read [documentation.md](references/documentation.md). Use [design-template.md](references/design-template.md) at the depth the change needs. Respect a request to keep the work in the conversation.
- For a consequential design or a requested review, read [review.md](references/review.md). Use existing roles for a fresh review when permitted and available. Otherwise disclose self-review; do not claim independent validation.

Design work may inspect sources and write the requested architecture documents. It does not authorize code changes, tests, installations, worktrees, commits, tracker publication, or implementation. Propose a bounded experiment when evidence is insufficient; execute it only when the user authorizes that work. The role remains subject to its document-only write scope.

Return the recommendation, important trade-offs, evidence gaps, and document links when written. For a planning handoff, identify settled decisions, contracts, acceptance scenarios, and choices left to the builder. State the next action. Start planning or implementation only when the user's request authorizes that stage; do not repeat an approval already given.
