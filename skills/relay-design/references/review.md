# Review a design for handoff

Use this assessment for consequential designs or when requested. A short, low-risk change can use a brief self-review. For a fresh review, follow the research reference's helper and host limits. Reuse an existing architect with `mode=design-review`; do not create a new reviewer role. If only self-review is possible, say so.

Give the reviewer the requirements, design, evidence references, and relevant constraints. Ask whether a capable engineer could plan from them without guessing a decision whose wrong answer would matter. Do not prime the reviewer with a desired verdict.

Check the design against the required behavior, including relevant failure and change scenarios. Examine boundaries, data ownership, interface consistency, unjustified complexity, source support, and validation. Check that the explanation and technical reference describe the same system. Check whether rollout, recovery, or migration needs affect this change.

Report only material gaps, contradictions, or risks. For each, name the document section or evidence, the consequence, and the decision or experiment needed. Do not demand details explicitly and reasonably left to the builder. Do not request unrelated design changes or polish as blockers.

Return `READY`, `READY_WITH_CONCERNS`, or `NEEDS_DECISION`, with concise findings and any assigned report link. `READY` means no material planning gap was found; it does not mean the architecture has been proved correct or implemented.

The lead resolves findings from existing evidence where possible. Ask the person only for consequential decisions not already answered or delegated. Record important accepted risks. Use one fresh review by default, then a focused follow-up only if material revisions need it. Do not run an unbounded review loop. A review result is not permission to implement.
