# Shared language guide

Use ASD-STE100 Issue 9 rules and approved vocabulary as the writing reference. See the [official guidance](https://www.asd-ste100.org/STE_faq.html) and [software guidance](https://asd-ste100.org/STEsoftware.html). This guide does not reproduce the standard. A checklist does not establish conformance.

## Instruction drafts

Write runtime role and skill instructions as strict STE-style drafts. Apply the same policy to descriptions, supporting instructions, command wrappers, generated instructions, lane briefs, and hook refusal or retry messages.

- Use short, direct sentences. Put one instruction in each sentence where practical.
- Name the actor. State each condition before the action that depends on it.
- Use active verbs. Make the required action explicit.
- Use one term for one meaning in a context. Consult `software-glossary.md` for Relay terms.
- Make references between steps clear. State what starts the next step.
- Preserve responsibilities, restrictions, stop conditions, retry rules, test budgets, and output limits.
- Keep code, commands, paths, identifiers, configuration keys, output markers, quotations, and evidence exact. Do not simplify a protected literal.

The software glossary supplements the general vocabulary with technical terms. Its entries do not claim that each term is an approved general word.

## Teacher explanations

Use adaptive STE-based explanations for learners. Adapt words, detail, examples, analogies, diagrams, and pace to the current question and topic familiarity. Retain precise technical names when needed. Explain an unfamiliar term before using it. State analogy limits. Preserve each necessary causal link, constraint, failure, and supporting citation. Do not force explanations into procedures or a fixed lesson.

## Review

Compare source changes with the previous role and interface contracts. Review generated definitions after building them. Record language review separately from automated checks and live host evaluations. Call the result a strict STE-style draft assessment. Do not claim audited ASD-STE100 conformance. If references cannot be read, retain the inline core and report that limitation.
