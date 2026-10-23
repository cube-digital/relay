# Codex plugin integration implementation plan

Goal: deliver the same local development workflows in Claude Code and Codex from one Relay source tree, on the existing `relay/codex-plugin-integration` branch. The user authorized implementation and a local commit; pushing remains theirs. After inspecting the uncommitted diff, they requested a descriptive title: `feat(codex): add shared workflows, budget routing and marathon support`. Keep the current 0.1.3 manifests.

## Constraints and decisions

- Plain Node >=20, no added dependencies. Preserve existing Claude behavior.
- Edit roles/routing/build sources; regenerate agents and `codex/**` with `node bin/relay build`.
- Keep hooks fail-open on errors; intentional guard decisions may exit 2.
- Bundle executable resources and resolve them from the installed plugin, not the target repository or PATH.
- Shared workflows expose plan, run, status, board, lanes, forecast, calibrate, budget and marathon. Keep existing engine skills and aliases.
- Local Codex app/CLI are the acceptance targets. Native hook trust remains a user action; no global settings, account resets, pushes, or releases are authorized.
- Use documented Codex command hooks and account-rate-limit RPCs. Do not assume fixed five-hour windows or per-thread speed overrides.
- Tests exercise real git repositories and process boundaries. Use small reproductions for discovered bugs, then one full integration run.

## Tasks and ownership

### T1: Hook and filesystem reliability

Owner: hook worker. Files: `lib/git.mjs`, `lib/hookio.mjs`, `lib/fingerprint.mjs`, `hooks/retest-guard.mjs`, `hooks/protect-tests.mjs`, related tests. Do not own session-start, generated hook configurations, or routing.

- [x] First demonstrate documented `{command: patch}` protection, symlink-cwd protection/cleanup, cwd-separated test runs, Node/multiline detection, and concurrent history persistence failures.
- [x] Canonicalize path identity, normalize documented tool envelopes, and serialize retest state writes with bounded fail-open locking.
- [x] Run focused hooks/units/worktree tests, reporting red/green evidence. Do not commit.

### T2: Native Codex usage and routing

Owner: budget worker. Files: budget/RPC/harness helpers, `scripts/relay-budget.mjs`, forecast/calibrate/ledger integration, `hooks/session-start.mjs`, new `hooks/codex-spawn.mjs`, Codex budget tests. Do not edit workflow skills, roles, build/setup scripts, or marathon.

- [x] Define/export harness resolution and snapshot interfaces before consumers are integrated; report exact signatures.
- [x] Keep account snapshots and calibration separate per harness; map real window durations and prefer a bounded documented app-server reading with rollout fallback.
- [x] Connect the tested Codex math to forecast and calibration without using private database/account-credit APIs as required dependencies.
- [x] Add a spawn hook using documented permissionDecision/updatedInput, preserving all unrelated spawn input, enforcing model/effort policy and critical denials.
- [x] Prove protocol behavior using a fake Codex executable; no paid model calls or reset credits.

### T3: Complete portable plugin workflows and installation

Owner: packaging worker. Files: `skills/**`, `commands/**`, `roles/**`, `scripts/build.mjs`, `scripts/relay-setup.mjs`, new doctor/package helpers and CLI registration, `.codex-plugin/plugin.json`, local marketplace metadata, README and installation/package tests. Do not edit budget/hook implementations or marathon.

- [x] Expose the nine user actions through shared skills; make Claude commands thin wrappers.
- [x] Add per-harness references and resolve helper/reviewer resources from the installed plugin root. Permit assigned reports while preventing production-code edits in read-only roles.
- [x] Generate explicitly declared plugin Codex hooks using `${PLUGIN_ROOT}`, including spawn routing; avoid also installing duplicate project hooks.
- [x] Make model precedence compatible with routing: Codex role profiles must not pin a stronger model over the spawn hook's choice. Keep mid-tier defaults and explicit dispatch model/effort.
- [x] Provide repeatable project setup, native onboarding and a read-only doctor; preserve existing user/project settings.
- [x] Verify a copied/installed payload without the source checkout or Relay on PATH. Document local install/cache refresh and new-session/hook-trust steps.

### T4: Codex marathon backend

Owner: worker assigned after T1. Files: `scripts/relay-marathon.mjs`, `lib/marathon.mjs`, marathon tests/fixtures. Consume T2's harness/snapshot interface; do not edit it.

- [x] Retain the common deadline, ledger, stop, stall and restart controller.
- [x] Add a Codex backend using documented `codex exec` and resume behavior, explicit harness selection, real window resets and native approval/sandbox settings.
- [x] Test Codex dry-run, completion, pause/resume and stop through a fake executable; retain Claude tests.

### T5: Integration, review and commit

Owner: coordinator and a fresh reviewer.

- [x] Check interfaces between harness helpers, generated hooks, setup and long-run execution; regenerate outputs.
- [x] Review the complete diff for discovery gaps, unsafe settings writes, model-precedence mistakes, missing resources and duplicate hook execution.
- [x] Run `npm test`, `node --test codex-math/test/*.test.mjs`, and `node bin/relay build --check`. If `hooks/register.ts` changes, also run `claude plugin validate .` and `claude plugin test .`.
- [x] Exercise install/doctor/forecast/hooks/marathon in disposable targets; document that paid native feature runs remain user validation.
- [x] Prepare verified changes for a local commit on the requested branch with the descriptive title requested after review, without pushing.

## Evidence and progress

Baseline from the immediately preceding audit: 61/63 main tests pass; both failures are confirmed macOS path-alias defects in T1. The same two tests pass with canonical TMPDIR. Codex math 12/12 and generated-file check pass. This known baseline is included in the authorized fixes.

References: OpenAI plugin packaging, hooks, subagents and app-server documentation; upstream Superpowers shared skill/reference and package-test patterns; Compound Engineering's skill-local role dispatch pattern. Repository recipes do not override the active harness's actual tool capabilities.

## Final verification — 2026-10-23

- Main suite: `npm test`, **91/91 pass**. Codex math: `node --test codex-math/test/*.test.mjs`, **12/12 pass**. Generated resources: `node bin/relay build --check` passes; `git diff --check` passes.
- A fresh reviewer checked cross-component integration. All Important findings were repaired, including Claude forecast output, Codex clean-fork routing, reset dates and fresh ledger usage stamps, installed marathon resources, actual shell workdirs, copy/move destinations and per-segment fallback protection. Targeted final review is clear.
- A real npm package contains 112 files, including the CLI, native plugin hooks, skills and required Codex math configuration; research evidence is excluded. Copied-payload tests run outside the checkout without Relay on PATH.
- A bounded, read-only account/rateLimits/read request succeeded against the installed Codex app-server and returned the actual weekly window. Native executable discovery and doctor were exercised without modifying global settings or project configuration.
- Native Codex marathon execution and hook responses are covered at the process boundary using fake executables. No paid native model turns, account resets, plugin-trust bypasses or remote writes were performed. An actual Codex workflow after local installation remains user validation.
- The installed Claude CLI is 2.1.27: marketplace validation passes with an existing description warning; it lacks the plugin test command and its older manifest validator rejects the existing displayName field. Neither hooks/register.ts nor the Claude manifest changed. Current Claude-native plugin validation needs a newer user environment.
- Hook protection handles literal paths, aliases, recognized write commands and redirections, and retains legacy detection independently for unknown shell segments. It does not interpret arbitrary shell substitutions or opaque program code.
- Local testing does not require a push. The relay-local marketplace installs a copied payload; refresh/reinstall after edits and start a new chat, then approve hooks in Codex. Use one Relay hook installation to avoid duplicate execution.
- Keep manifest/package version 0.1.3. Use the descriptive commit title requested after review; no release or push is part of this task.
