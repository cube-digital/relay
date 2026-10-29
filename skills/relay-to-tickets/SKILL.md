---
name: relay-to-tickets
description: Use when an existing plan, specification, PRD, or agreed discussion needs implementable tickets or issues for people or agents.
---
# Relay to tickets

Convert existing requirements into self-contained tickets. Work in this conversation. Ticket preparation does not start implementation or require a second plan.

Resolve linked resources from this skill's real installed directory. Read the [language guide](../using-relay/references/language-guide.md) and [software glossary](../using-relay/references/software-glossary.md). Use short sentences and clear actors. Preserve exact requirements, identifiers, and evidence. If guidance is unavailable, report the limitation and retain these rules.

## Read the source

Use the supplied plan, specification, or agreed conversation. Read named references and relevant issue comments when accessible. Inspect code only to resolve a concrete uncertainty. Preserve agreed decisions. Identify inaccessible sources and conflicting requirements. Ask about decisions that prevent a useful breakdown; otherwise mark affected tickets blocked. Do not silently choose a conflicting value or turn an assumption into a requirement.

## Divide by outcome

Each ticket delivers a bounded, independently verifiable outcome across the relevant layers. Include its tests and necessary documentation. Group source tasks by outcome rather than copying each layer into a ticket. For example, combine export schema, CSV formatting, and the authenticated endpoint into a usable API download; page controls can be a later outcome.

Size each ticket for a person or agent starting without the conversation history. Keep only true prerequisite dependencies. For a broad compatibility migration, sequence compatible expansion, named caller batches, and removal after every batch. If batch scope is unknown, draft the discovery work and mark dependent batch tickets blocked until their members are known. Add preparatory changes only when the source or evidence requires them.

## Write and check

Use [ticket-template.md](ticket-template.md). Repeat the applicable global constraints in each ticket. Keep source references for traceability; do not make readers recover essential decisions from them. Retain exact interfaces or code only when needed to preserve an agreed decision.

Check requirement coverage, bounded scope, observable acceptance, and dependency cycles. State assumptions and open decisions. No ticket is ready while essential decisions or prerequisites remain unresolved. File overlap alone is not a delivery dependency; Relay considers it when scheduling implementation.

Show a short overview of ticket IDs, outcomes, and blockers, followed by the tickets. Honor requests to review before saving or publishing. Reuse approval already given.

## Deliver

Return drafts in chat when no destination is specified. When local files are requested, write one file per ticket in dependency order under the requested directory, or `docs/relay/tickets/<feature-slug>/` by default.

Publish to a tracker only when requested. Use available tracker tools, the chosen project, real identifiers, and native dependency links where supported. Reuse known ticket IDs on retries; report partial failures. Do not change parent issues or start implementation unless requested. An assigned ticket can use the existing Relay implementation workflow without a mandatory new plan.

Adapted from Matt Pocock's `to-tickets` skill. See [NOTICE.md](NOTICE.md).
