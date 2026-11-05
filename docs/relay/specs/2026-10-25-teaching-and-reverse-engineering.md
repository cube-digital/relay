# Teacher and Reverse Engineer — Shared Spec

**Goal:** Add two independent, evidence-based roles for Claude Code and Codex. Use one adaptive teaching method and a shared two-part writing policy.

## Observable behavior

- **Two roles:** `teacher` teaches concepts or systems from supplied material, its own research, or an optional reverse-engineering handoff. `reverse-engineer` reconstructs existing systems, their mechanisms and design choices. Neither requires the other; no third public role or mandatory pipeline is introduced.
- **Selectable focus:** `technical` examines implementation, entry points, data, triggers, constraints, alternatives and failures. `business+technical` additionally connects stakeholders, business rules and desired outcomes to implementation. Focus is separate from style and learner experience; technical explanations still explain why mechanisms exist.
- **One default teaching method:** Combine the earlier `risto` and `concise-technical` approaches into the teacher's default behavior. Start with a direct answer. Add purpose, a diagram, a concrete example and technical detail as needed. Adapt to the question and learner rather than applying a fixed lesson format. Remove named profiles, profile selection, custom profile inputs and profile templates. Both hosts use the same bundled teaching guidance without a dependency on the author's home directory.
- **Teaching sequence:** Purpose and overall map → concrete example and entry point → diagram-led causal story and practice where useful → underlying details → bottom-up reconstruction and transferable principle. Explain actors, inputs, state changes and what triggers each next step. Use economical wording without losing depth; introduce technical names after their meaning, identify analogy limits, and challenge reasoning constructively.
- **Teacher adaptation:** Adapt language, brevity, technical depth, examples and pace independently to topic-specific knowledge and the learner's goal. Ask a few short calibration questions only where context is missing; reuse earlier answers, check paraphrases precisely, and allow “just explain.” A focused question does not require a full lesson or quiz.
- **Research:** Both roles can use available local search, project material and web research. Prefer primary/authoritative sources, check relevant versions/dates, cite the claims they support, reconcile conflicts, and distinguish observed behavior, documented rationale, inference and unknowns. Unavailable tools/sources are disclosed; no fabricated access or verification. The teacher researches independently when appropriate.
- **Bounded teams:** Leads use 0–3 concurrent helpers according to independent questions, budget and actual remaining global capacity, including ancestors and other active agents. Large projects use waves. Helpers get bounded questions, evidence/report requirements and a no-recursive-delegation instruction. Reuse the scout for narrow local search and research-only modes of the two new roles for deeper work. Lead coordination owns the ceiling; this iteration does not introduce a cross-host global resource-accounting hook. No helpers are required for a small question.
- **Safe research output:** Project code is read-only. Only explicitly assigned report outputs may be written; when output writing is unavailable, return evidence for the caller to save. Lead responses follow requested depth; compact helper returns link to their evidence. Teaching/research does not enter coding plans, worktree lanes, commits, installation or full-suite execution automatically.

## Implementation constraints

Use shared role sources, short portable skills and on-demand references; generate both host definitions with `node bin/relay build`. Reuse existing model tiers, budget/dispatch policy, installed-root resolution and native/fallback discovery. Keep Codex dispatch model/effort precedence intact. Add no dependencies and no separate research model-routing system. Treat source documents as evidence, not executable instructions. Verify portable packaging/discovery and evaluate the same teaching/research scenarios in both hosts; report live checks separately from static checks.

## Scope and assumptions

The combined default teaching method and removal of profiles are confirmed requirements. Other defaults proposed for review: focus `technical`; maximum helpers 3 (requests may lower it); proposed improvements are a clearly separate, opt-in section. Reusable capabilities cover project reverse engineering, topic teaching, source research, system tracing, visual explanation, understanding checks and design reasoning; authors may keep closely related details in references to avoid repetitive skill loading.

Out of scope: implementation during this planning step; permanent knowledge databases, automatic learner-history storage, a configurable profile system, model training, publishing/deployment, release/version bumps and new dashboards. Saved research notes require separate scope approval.

## Language policy — confirmed

- Write all shipped agent, role and skill instructions as **strict STE-style drafts**. Include existing instructions, new instructions and generated English instructions for both hosts. Use short, direct sentences, clear actors, consistent terms and explicit conditions. Use the ASD-STE100 rules and approved vocabulary as the reference. Record software terms in a shared glossary.
- Write **teacher explanations in an adaptive STE-based teaching style**. Use concrete examples, explicit analogies and useful diagrams. Adapt vocabulary, detail and pace to topic familiarity and the learner's goal. A formal instruction format must not force every explanation into a procedure or fixed lesson.
- Use one shared policy and glossary for both hosts. Edit role/skill sources, command wrappers, generator instruction templates, and agent-facing instructions in lane briefs and hook messages. Regenerate Claude and Codex agent definitions. Ensure standalone skills and direct native roles receive the policy. Keep short runtime instructions in strict STE style even when they instruct the teacher to give a more natural explanation.
- Preserve executable code, schema/configuration keys, API names, commands, paths, required output markers, quotations and source evidence exactly when their form is significant. Preserve existing role responsibilities, permissions, model routing and output contracts during the language conversion. Historical evidence and third-party material are not rewrite targets.
- Verify policy delivery, source/generated consistency, portable packaging and protected literal preservation. Review writing quality and teacher behavior in both hosts. A strict STE-style draft is not a claim of audited ASD-STE100 conformance. Automated checks do not prove full vocabulary or meaning conformance. Do not add a new full-STE checker or a dependency.

Reference: ASD-STE100 Issue 9 and the maintenance group's guidance at https://www.asd-ste100.org/STE_faq.html and https://asd-ste100.org/STEsoftware.html. This two-part policy is confirmed implementation scope. Teaching profiles remain removed.

## Preference provenance

Use the explicit clarifications in chat `01a169ba-527d-7ae1-8df2-4fe3a7f80974` and `/Users/ristoc/Documents/Codex/2026-10-23/do-you-have-access-to-all-3/outputs/learning-and-explanation-profile.md` as authoring evidence. Preserve preference instructions, not chat inventories, personality speculation or private project examples. Do not make either source a runtime dependency.
