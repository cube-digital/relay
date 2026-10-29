# Maintained architecture documents

Use the target repository's existing conventions. Respect a supplied output path. Update an existing design in place when requested. Otherwise, for a requested new document, use `docs/relay/designs/YYYY-MM-DD-<topic>.md`. State the chosen path. A conversational comparison alone does not require files.

Use `design-template.md` as a guide. Remove inapplicable sections. A small change can fit on one page; a complex system needs enough detail to expose contracts and failures. Keep a plain explanation and a technical reference connected through the same example. Do not copy an implementation plan into the design.

Distinguish current behavior from proposed behavior. Use explicit status such as draft, accepted, implemented, or superseded. Record the basis for acceptance: the person's decision or authority they explicitly delegated. Record assumptions separately. Acceptance is not evidence of implementation. Include the source revision when known and the date of the latest review.

Keep consequential decisions as short records with stable identifiers, context, the choice, alternatives, consequences, and a condition for revisiting the choice. Reuse existing decision records. When a decision is replaced, link its replacement and retain its history. Do not create a separate record for every routine detail.

Keep each fact in one main document. The architecture overview describes the implemented system. The design describes the intended change. Decision records explain why. Plans reference those documents and add execution tasks. Link existing requirements and evidence instead of duplicating them.

## Handoff

Identify settled decisions, interfaces, data ownership, constraints, acceptance scenarios, and evidence needed to validate them. Name choices left to the planner or implementer. Distinguish blocking questions from deferred work. Link the exact design revision or dated state used by the plan when available.

Include suitable architectural checks where a property can be verified: dependency boundaries, interface compatibility, recovery behavior, or performance under stated conditions. State checks as future verification work unless they actually ran. A source review is not a runtime test.

When planning is requested, give the design to the existing `relay-plan` skill. Preserve its decisions instead of regenerating a smaller spec that loses constraints. When only design is requested, finish with a clear next step and do not start planning automatically.

When implementation changes a material assumption, record the discrepancy and resolve the affected decision. Update the current overview only from verified behavior. Include necessary documentation maintenance in the implementation plan. Preserve accepted intent until a change is agreed or falls within delegated authority.
