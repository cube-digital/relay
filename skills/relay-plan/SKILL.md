---
name: relay-plan
description: Use when turning a requested feature, specification, or agreed architecture design into a Relay implementation plan.
---

Resolve this SKILL.md to its absolute real path. The installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`. Substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Write instructions as strict STE-style drafts. Use short sentences, clear actors, and consistent terms. Keep code, commands, paths, identifiers, output markers, quotations, and evidence exact. For teacher explanations, adapt the words and detail to the learner. Use examples, analogies, and diagrams when they help.

Read `<absolute-relay-root>/skills/using-relay/references/language-guide.md` and `<absolute-relay-root>/skills/using-relay/references/software-glossary.md`. Substitute the resolved installed root for `<absolute-relay-root>` in actual reads. If the references are unavailable, keep the inline policy. Report unavailable language guidance. Do not claim that the full language review passed. Do not load an unrelated coding workflow as a fallback. Load these references directly. Do not run the `using-relay` workflow to load language rules.

# Relay plan

Goal: the user’s arguments

Produce a plan. Do not write code.

1. **Understand.** If the goal is empty, ask what to build and stop. If it is a path, read that spec or design and its relevant linked requirements. Preserve decisions already agreed in the conversation. Dispatch scout agents (cheap) for missing file, convention, and test-command evidence. If dispatch is unavailable, inspect only the relevant sources directly. Reuse existing findings.
2. **Ask once, briefly.** Ask at most three questions, together, only where the answer changes scope, acceptance behavior, or a risky choice. Do not reopen settled design decisions. For routine reversible details, state sensible assumptions and continue. If a material design decision is unresolved, identify the affected work and resolve that decision before planning dependent tasks; silence is not agreement.
3. **Source.** Use a supplied spec or agreed design as the source. Keep its path, revision when known, decisions, contracts, and acceptance scenarios. Do not compress a design into a replacement one-page spec. If neither was supplied, write `docs/relay/specs/YYYY-MM-DD-<slug>.md`: goal, observable behaviors, out of scope, constraints, and assumptions. Keep this new spec under a page.
4. **Plan.** Dispatch the existing architect with the source paths, settled decisions, builder discretion, and scout findings (paths and one-line notes, not file contents). Instruct it to use its plan responsibility, read `<relay-root>/skills/plan-with-tiers/SKILL.md` and `template.md`, write `docs/relay/plans/YYYY-MM-DD-<slug>.md`, run `relay lanes <plan>` until it has no errors, and return the path. If dispatch is unavailable, follow that same procedure in the current conversation.
5. **Check.** Run `relay lanes <plan>`, `relay forecast <plan>` and `relay board <plan>` (it writes the board the run will light up) yourself. If lanes still reports errors, resume the architect with them once. After that fix small issues in the plan directly.
6. **Hand over** in this order: the plan path. One line per task (`T3 · mid · high risk · 2 tests — title`). The lanes and waves from `relay lanes` and the forecast, both in code blocks, unchanged. The assumptions. End with the next step: `/relay:run <plan>` to run it here (`/relay:board` then shows its progress), `/relay:marathon <plan> <hours>` when it spans more than one 5h window, or changes in plain words (then update the plan and show lanes and forecast again).
