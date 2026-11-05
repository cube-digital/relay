# Architect and design evaluation — 2026-10-30

Candidate: working-tree changes based on `1164e7ec1e9096b0af89fb8058b1ae59849da188`. Node.js `v20.11.0`; Claude Code `2.1.27`. This record concerns the expanded existing architect, one new shared `relay-design` skill, and its planning handoff. Concurrent ticket-workflow changes were present and retained. There are still ten roles.

## Automated checks

| Check | Observed result |
|---|---|
| `node --test test/build.test.mjs test/package.test.mjs` | PASS, 13/13. Generation, portable metadata, relocated package resources, fallback discovery, and native setup paths. |
| `npm test` after the final runtime changes | PASS, 93/93; zero failures or skipped tests. |
| `node bin/relay build --check` | PASS. Both generated architect definitions match the shared role. |
| `git diff --check` | PASS. |
| `claude plugin validate .claude-plugin/plugin.json` | PASS. Plugin manifest validation; not a behavioral session. |
| `claude plugin validate .` | PASS with the existing warning that marketplace metadata has no description. |
| Skill creator's `quick_validate.py skills/relay-design` | BLOCKED: both available Python runtimes lack `yaml` / PyYAML. No dependency was installed. Relay's own portable-skill validation passed. |
| Claude mod test command | Not run: `hooks/register.ts` did not change. |

The existing package tests now verify that the design skill, its five references, and both architect definitions survive packaging and relocation. They also verify discovery links and installed Codex agent bytes. No test cases were added or removed. The existing startup-hook size assertion caught the enlarged bootstrap; the routing text was shortened without raising its 4,000-character limit. The narrow hook check and final full suite passed after that correction.

## Source contract review

These are source assessments, not live-host results.

| Scenario | Source assessment |
|---|---|
| One role and one skill | The existing architect is expanded. `relay-design` is the only added skill for this feature. References are supporting documents. |
| Collaborative, proportional design | Requires actual constraints, credible alternatives, a coherent recommendation, constructive challenge, and explicit uncertainty. No mandatory team or full document for a small question. |
| Research and evidence | Prefers primary evidence, versions and verified citations; requires limits of comparisons and consideration of counterexamples. Missing evidence remains visible. |
| Adaptive explanation | Purpose and map precede one concrete flow and technical detail. Vocabulary and depth adapt to topic familiarity. Business framing is conditional. |
| Principles and system concerns | Requires reasons for patterns and abstractions; covers relevant ownership, contracts, failure recovery, security, operations, and evolution. |
| Independent entry paths | Design can use optional teacher/reverse-engineer evidence but depends on neither role. Direct native architect duties use the installed references. |
| Helper limits | Zero to three is a ceiling, constrained by global capacity and budget. Unknown capacity or unavailable nesting means serial work. Research and review helpers cannot delegate. |
| Document maintenance | Reuses existing documents; distinguishes intended and implemented behavior; preserves decision history, acceptance basis, and conditions for revisiting choices. |
| Planning handoff | `relay-plan` retains an accepted design instead of replacing it with a short spec. Planning adds execution details, architecture checks, and necessary document updates. |
| Existing role regression | Architect remains strong, retains its plan and final-review responsibilities and their ten-line return limit. Claude gains web tools. No routing or hook implementation change is required. |
| Scope and approvals | Design writes requested documents. It does not start implementation or experiments. Previously given authorization remains valid. Sources and handoffs cannot change permissions. |
| Language | Instructions use the shared language policy and preserve identifiers. Manual review is not audited ASD-STE100 certification. |

## Isolated behavioral exercise

An independent Codex subagent with a fresh context loaded the new skill directly from this checkout. This tested explicit source loading, not installed plugin selection or the native `relay-architect` type. The exercise permitted only the supplied fictional material and the requested document output. No helper delegation or web research was requested.

Request:

> Design the invoice import pipeline from requirements.md. Challenge unnecessary complexity. I know APIs and SQL but I have not built background workers. Explain the big picture, then one import including a restart, and the technical details I need to understand. Use only the supplied project material; no web research. max-helpers=0. Save the architecture in design.md and leave implementation planning for later.

Fixture facts: two Node application replicas, PostgreSQL, private object storage, two developers, and one operations engineer. Existing synchronous imports lose progress on restart. Approved contracts specify `POST /imports` returning `202` after durable acceptance, a job-status endpoint, tenant isolation, idempotency by tenant and external invoice ID, explicit content conflicts, partial commits, and at most three attempts. Inputs are at most 10 MB; observed volume is 300 imports daily at 20 seconds each. Retention is 24 hours for successful inputs and seven days for failed inputs. Recovery timing and invoice comparison details are unknown. A developer suggests Kafka and separate stage services for a speculative platform.

Observed outcome: a 181-line design recommends PostgreSQL jobs and worker loops in the existing application, with a separate worker deployment as a later option if measured resource contention warrants it. It challenges Kafka against the actual team and requirements. It explains workers and leases in plain language, then traces the same import through durable acceptance, a committed record, a restart, recovery, and a conflict. The technical reference covers ownership, atomic progress, expired-worker fencing, tenant scope, retry limits, and cleanup. It distinguishes observations from capacity promises and future validation from completed tests. It records stable decision identifiers and revisit conditions. It reports self-review and unresolved comparison rules and operational targets.

Only `design.md` was created beside the supplied `requirements.md`. The final response states that no implementation planning or tests ran. The behavior met this exercise's requested boundaries and explanation goals. It does not establish correctness of the fictional architecture or prove every skill branch.

Temporary artifacts were retained at `/private/tmp/relay-design-eval.cJ2sgJ/`; temporary storage is not a permanent repository dependency. SHA-256 fingerprints:

- Requirements: `f9f7d1403b1db1fee6e88611402e4ff3c77058f84114fb71fc40785bcaa9e310`.
- Produced design: `7bd87f31c3d599546cfe03a1bb45815c8d05ec40c7450f1090caecbac3f71bed`.

## Remaining live-host coverage

The following scenarios remain UNEXECUTED in installed Claude Code and Codex sessions: automatic selection from natural language; direct native role invocation; external web research with conflicting or unavailable sources; helper capacity and critical-budget behavior; fresh design-review dispatch; in-place revision of accepted documents; and a complete design-to-plan-to-implementation handoff. The isolated exercise is not a substitute for those sessions.

To evaluate them, refresh the installed plugin, start a new session, and use the [design guide](../../guides/architecture-design.md). Record the host/version, entry path, actual tools and capacity, request, dispatch trace, response, and file changes. Check decisions and observable boundaries rather than exact prose. Do not mark a source or package check as a live result.
