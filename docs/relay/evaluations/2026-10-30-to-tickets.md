# Ticket preparation evaluation — 30 October 2026

## Scope

The new `relay-to-tickets` skill converts an existing plan, specification, or
agreed discussion into tickets for people or agents. It shares one source between
Claude Code and Codex. The Claude wrapper loads that source. The shared session
rules include a ticket-preparation route.

## Behavioral trials

Two independent, clean-context `relay-reviewer` agents used `gpt-6.1-sol` with
medium reasoning effort. One produced a baseline without ticketing guidance.
The other used the new skill and its linked template. Both received the same
three source requests. Each wrote a report in an isolated temporary directory.
No project implementation, migration, or tracker operation was performed.

| Scenario | Baseline | With the skill |
|---|---|---|
| Invoice export plan with schema, formatter, endpoint, UI, and filters | Four tickets. The first isolated row/schema and CSV formatting from the download endpoint. | Three outcome tickets. The first included row contract, formatter, authenticated endpoint, tests, and documentation. Later tickets covered the page and filtering. |
| Public-field migration across 50 unnamed integrations | Compatible expansion, discovery, batch template, and removal. | Compatible expansion and discovery; unknown batch membership explicitly blocked assignment, and removal depended on every batch. |
| Password-reset plan with conflicting token lifetimes | Asked which lifetime applies. | Asked which lifetime applies; retained single-use behavior and left affected implementation blocked. |

The skill-guided feature drafts carried ownership filtering, authentication,
EUR/USD support, two-decimal formatting, UTC dates, and the 1,000-invoice rejection
rule. The agent identified unspecified date syntax instead of silently fixing
it. Dependency descriptions named the deliverable required from each blocker.

These are small behavioral samples, not a reliability rate. The migration and
conflicting-requirement baseline already behaved appropriately. The demonstrated
improvement was grouping technical steps into an independently usable outcome.

## Repository checks

- `npm test`: 93 passed, 0 failed.
- `node bin/relay build --check`: passed; generated files remained current and
  skill frontmatter remained portable.
- `git diff --check`: passed.
- Relative links in the new skill and updated getting-started guide resolved.
- `claude plugin validate .claude-plugin/plugin.json`: passed.
- `claude plugin validate .`: marketplace validation passed with the existing
  missing-description warning.
- The optional skill-creator Python validator could not start: PyYAML was absent
  from both the system and bundled Python runtimes. No dependency was installed.
  Relay's own portability validator ran successfully.

Instruction text received a strict STE-style draft review for short sentences,
clear actors, consistent terms, and preservation of exact source decisions.
This is not an audited ASD-STE100 conformance claim.

## Limits

The trials loaded the source skill explicitly. They do not establish live
implicit selection or installed-plugin discovery on either host. No real tracker
publication, partial-publication recovery, or complete implementation run was
tested. Local source changes require a refreshed plugin installation before an
installed session can discover them.
