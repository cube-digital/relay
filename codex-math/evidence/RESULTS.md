# RESULTS: live readings, priced runs and the two compiled defaults

Collected 2026-10-22 (UTC) by a Claude Code agent on Marius's machine, following `codex-math/harness/AGENT-PLAN.md`. Every number below is in a file under `codex-math/evidence/live/` or `codex-math/evidence/decompile/`; nothing lives only in the chat. Marius allowed installing tools mid-run, which is why Codex was updated and REA/Ghidra were installed (details in A).

## A. Environment

Full table: `evidence/live/environment.md`.

- Codex was **0.146.0** at the start. On 0.146.0 `account/usage/read {threadId}` fails with `invalid type: map, expected unit` (no per-thread estimate), `model/list` shows only `gpt-5.6-sol/terra/luna` and `account/read` says `planType: "unknown"` (`probe-baseline.json`, `probe-baseline-threads.json`). It was updated with `codex update` to **0.163.0**; phases C–E ran on 0.163.0. The installed 0.163.0 binary has SHA-256 `399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215`, the hash the plan expects, so phase G used it directly (the `npm pack` copy is byte-identical).
- Auth: ChatGPT (`auth mode chatgpt`, file storage). Account `c***@narrio.app`, **planType `self_serve_business_prolite`**. One usage window: `primary { windowDurationMins: 10080 }`, `secondary: null`, `limitId: "codex"`, `credits { hasCredits: false, unlimited: false }`, one unused "Full reset" credit (not used).
- Node v22.23.4. REA: not installed at start → `rea-agents` 6.7.0 installed under `~/.local`. IDA: not installed (only `~/.idapro/ida.reg` remnants). Ghidra 12.1.4 + OpenJDK 21 installed for REA's Ghidra provider (`rea doctor`: ghidra healthy).
- `features.txt` (0.163.0) and `features-0.146.0.txt`; `config.toml.redacted` (one `api_key` line redacted). No `[agents]` table, no `max_concurrent_threads_per_session`, no `model_auto_compact_token_limit` in the user config.
- `~/.codex/hooks.json` exists but was not read (the agent's permission classifier refused every read of it); nothing from it is in the evidence.
- Field names on 0.163.0 that differ from or extend `harness/FINDINGS.md`: `turn.completed.usage` carries `cache_write_input_tokens` (always 0 in the runs); `account/read` adds `workspaceRouting { chatgptAccountId, backendOrigin, accountRoutingOverride }`; `account/rateLimits/read` has `individualLimit: null` and `rateLimitReachedType: null` next to the documented fields; `model/list` entries carry `serviceTiers[{id:"priority", name:"Fast", description}]`, `defaultServiceTier`, `additionalSpeedTiers`, `availabilityNux`, `upgrade`/`upgradeInfo`. Fast is described as "2x speed, increased usage" on gpt-6.1-sol and gpt-6-astra and "1.5x speed" on gpt-6-sol and gpt-6-luna, as FINDINGS says. Every `codex exec` run logs two `error` items that are only the warning "Codex is ignoring 1 unrecognized configuration setting … `model_providers.nvidia.api_key` is ignored" (counted below as "2 error events"; harmless).

## B. Mined sessions (`extract-readings.mjs`)

Printed: `114 rollouts, 10068 token_count readings (5212 with rate limits; plan types: pro, team, self_serve_business_prolite), 214 threads, 42 spawn edges`. After phase E it was run again (counts below in E). Files: `readings.json`, `threads.json`, `sessions.json`.

- Readings span 2026-10-01 → 2026-10-22. Rate-limited readings by plan: pro 1219, team 447, self_serve_business_prolite 3546. Window shapes seen: **pro: primary 10080 min, no secondary**; **team: primary 300 min + secondary 10080 min**; **self_serve_business_prolite: primary 10080 min, no secondary** (3 team readings had no primary). Distinct `window_minutes`: **10080, 300**. `limit_id` values: `codex`, `premium`.
- Readings by model: gpt-6.1-sol 8170, codex-auto-review 903, gpt-6-sol 505, gpt-6-luna 317, gpt-6-astra 173.
- Threads (state_5.sqlite): 214 rows, 42 `thread_spawn_edges`, 0 goals. Model/effort mix: gpt-6.1-sol/high 42, gpt-6.1-sol/medium 21, gpt-6.1-sol/xhigh 5, gpt-6-luna low/medium/high 3/3/9, gpt-6-astra/high 1, codex-auto-review/low 116, gpt-5.6-* 14. Rollout `cli_version`s: 0.159.2 … 0.163.0-alpha.11.1.

## C. Live account probe (`app-server-probe.mjs`)

Summary line (0.163.0, `probe-baseline-0163.json`): `plan self_serve_business_prolite · primary {"usedPercent":24,"windowDurationMins":10080,"resetsAt":1793089926} · secondary null · credits {"hasCredits":false,"unlimited":false,"balance":null} · reset credits {"availableCount":1, …"Full reset"…}`. The 0.146.0 probes (`probe-baseline.json`, `probe-baseline-threads.json`) show the same window with `plan unknown`.

`account/usage/read` without a thread returns `summary { lifetimeTokens 437 380 201, peakDailyTokens 185 680 274, longestRunningTurnSec 2941, currentStreakDays 3 }` and `dailyUsageBuckets` (2026-09-28 → 2026-10-21). **With a `threadId` it returns `threadUsage: null` for every thread tried** — the three most recent threads, and later every calibration thread, re-queried minutes after the run. In the 0.163.0 source (`app-server/src/request_processors/account_processor.rs:1332-1372`) `None` is returned only when the backend's `/wham/usage/thread_usage/query` answers 403 or 404, so **this plan (self_serve_business_prolite) does not expose per-thread credit estimates**; the backend check of the published rates in D could not be made.

## D. Controlled calibration runs (`calibration-run.sh`, `calibrate-live.mjs`)

All nine runs were made, in order, on Codex 0.163.0, with a probe before each run (`usedPercent` gate: start only below 60 % primary / 70 % secondary; it was 24 % / none throughout) and 60 s between runs. The optional Fast run was made because every model lists the `priority` ("Fast") tier; the optional astra run was made because the weekly window was 24 % (below the plan's 40 % line for Business plans). Scratch repo: `make-scratch-repo.sh /tmp/relay-scratch`, reset after every run. Every run exited 0 with a `turn.completed` line and finished the task (tests green in the scratch repo; `last-message.md` in each run folder). Per run: `probe-before.json`, `events.jsonl`, `stderr.log`, `last-message.md`, `probe-after.json`, `meta.json` under `evidence/live/runs/<label>/`.

| run | model | effort | speed | units | exit | wall s | backend credits | input | cached | output | reasoning | cache-write | weekly before→after | turn.completed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01-luna-low-mid | gpt-6-luna | low | standard | 3 | 0 | 17 | null | 84541 | 64256 | 955 | 0 | 0 | 24% → 24% | yes (2 error events) |
| 02-luna-low-cheap | gpt-6-luna | low | standard | 1 | 0 | 9 | null | 48699 | 46976 | 194 | 0 | 0 | 24% → 24% | yes (2 error events) |
| 03-sol61-medium-mid | gpt-6.1-sol | medium | standard | 3 | 0 | 34 | null | 70323 | 48256 | 943 | 40 | 0 | 24% → 24% | yes (2 error events) |
| 04-luna-low-mid | gpt-6-luna | low | standard | 3 | 0 | 17 | null | 84496 | 74240 | 927 | 0 | 0 | 24% → 24% | yes (2 error events) |
| 05-sol61-medium-mid | gpt-6.1-sol | medium | standard | 3 | 0 | 38 | null | 72915 | 63232 | 1079 | 68 | 0 | 24% → 24% | yes (2 error events) |
| 06-sol61-high-mid | gpt-6.1-sol | high | standard | 3 | 0 | 38 | null | 67001 | 45184 | 1123 | 148 | 0 | 24% → 24% | yes (2 error events) |
| 07-sol61-medium-fast | gpt-6.1-sol | medium | fast | 3 | 0 | 27 | null | 70684 | 64512 | 939 | 27 | 0 | 24% → 24% | yes (2 error events) |
| 08-astra-high-mid | gpt-6-astra | high | standard | 3 | 0 | 44 | null | 70498 | 64256 | 1009 | 34 | 0 | 24% → 24% | yes (2 error events) |
| 09-spawn-limit | gpt-6-luna | low | standard | 0 | 0 | 22 | null | 198678 | 179840 | 362 | 0 | 0 | 24% → 24% | yes (2 error events) |

"backend credits" is `threadUsage` from `account/usage/read {threadId}` 20 s after the run: **null for every run** (see C: the backend answers 403/404 for this plan), so the published-rate check ("backend X credits vs published rates Y") could not be made and `calibrate-live` used credits at the published rates (`lib/pricing.mjs`) for every sample. Tokens are `turn.completed.usage` (input includes the cached part; reasoning tokens are inside output). The "2 error events" are the config warning described in A.

Credits at published rates per run (`calibration-summary.json` → `runs[].ratedCredits`; the per-unit figure divides by the run's units):

| run | rated credits | per unit |
|---|---|---|
| 01-luna-low-mid | 0.079 | 0.026 |
| 02-luna-low-cheap | 0.018 | 0.018 |
| 03-sol61-medium-mid | 1.460 | 0.487 |
| 04-luna-low-mid | 0.056 | 0.019 |
| 05-sol61-medium-mid | 0.912 | 0.304 |
| 06-sol61-high-mid | 1.485 | 0.495 |
| 07-sol61-medium-fast | 1.762 | 0.587 |
| 08-astra-high-mid | 4.428 | 1.476 |
| 09-spawn-limit (root thread only) | 0.097 | – |

**The weekly window never moved**: `usedPercent` is an integer and stayed at 24 before and after every run, so no `Q̂` sample could be taken from the runs (the notes below say so for every interval, with the credits carried forward). Nine runs ≈ 10.3 credits at published rates moved the window by < 1 point; a weekly Business window is therefore worth more than ~1 000 credits by this bound, consistent with the rollout-derived estimate below. The calibration-run harness as written cannot calibrate `Q̂` on a plan with a single weekly integer-percent window unless the runs are much larger or an `account/rateLimits/updated` stream with finer resolution exists.

`calibrate-live.out` (also `calibration-summary.json`):

```
runs 9, readingsFromRollouts 5286, samples 238 (nCapacity primary 209, secondary 21; nTier cheap 3, mid 4, strong 1), planType self_serve_business_prolite
windowCapacityCredits: primary 22026.16, secondary 19714.92 credits   (range primary 27.6 – 1 117 710, secondary 61.2 – 307 336)
creditsPerUnit: cheap 0.02185 (gpt-6-luna low standard), mid 0.46815 (gpt-6.1-sol medium; the summary labels the tier with its last sample, the fast run), strong 1.47605 (gpt-6-astra high standard)
notes: intervals 1,3,5,…,17: "the primary window did not move; N credits carried to the next reading" (every calibration run); "rollouts: readings of models without published rates skipped: codex-auto-review"; "rollouts: plan types pro, team, self_serve_business_prolite; window minutes seen: 10080, 300"
```

The window capacities come entirely from the mined rollouts (B): consecutive `token_count` readings within one thread, credits from the published rates. The wide ranges show how noisy single-thread deltas are (the account runs several threads at once, so one thread's credits do not explain the whole window's movement); the medians are what `summarize` keeps. Script fix made (plan rule "fix the script, keep the behaviour"): `calibrate-live.mjs` crashed on readings whose model has no published rates (`codex-auto-review`, 903 readings); it now skips those readings and reports the skipped models in `notes` (diff: a `try/catch` around `creditsForTokens` in the rollout loop plus one note line; nothing under `lib/`, `config/`, `test/` changed).

Observations useful for the model: luna low used **0 reasoning tokens** on this task; sol 6.1 medium 27–68, high 148, astra high 34; the cached share of input was 57–88 %; wall time 9–44 s; Fast (priority) on sol 6.1 medium took 27 s against 34–38 s standard and was rated 2.5× (the harness's Fast multiplier) — the backend's own Fast charge could not be checked.

## E. Subagent concurrency limit (`09-spawn-limit`)

`[agents].max_concurrent_threads_per_session` is unset in the user config (A). Run: `gpt-6-luna` low, prompt `spawn-limit.md`, exit 0, 22 s. The agent's final message (`last-message.md`): **"Successful spawns: 3 — First error: `collab spawn failed: agent thread limit reached` — Agent IDs: `/root/explorer1`, `/root/explorer2`, `/root/explorer3`"**. In `events.jsonl` the spawn calls are not emitted as items on 0.163.0 (`collab_tool_call` items appear only for the three `wait` calls; no `spawn_agent` item, no `AgentLimitReached` text — the error reaches the stream only through the agent's message). After the second `extract-readings` pass (`131 rollouts, 10220 token_count readings (5289 with rate limits), 231 threads, 45 spawn edges`), `threads.json` has the three child threads of root `01a163ab-9609-74b2-9558-8c830b4bf773`: `thread_source: subagent`, `agent_path /root/explorer1..3`, nicknames Archimedes/Kant/Planck, `gpt-6-luna`/`low`, `tokens_used` 32 050 / 32 056 / 32 088 (root 199 040), and three `thread_spawn_edges` with `status: open`.

Result: **3 concurrent child threads by default, the 4th spawn fails with "agent thread limit reached"**. This matches G: the compiled default is 4 counted on the registry's total thread count (root + children), and a user-set `[agents] max_concurrent_threads_per_session = N` becomes N + 1 internally, so N is the number of children. The default is therefore equivalent to `agents.max_concurrent_threads_per_session = 3`.

## F. Compaction threshold by observation

Skipped: the plan makes it conditional on G not being possible, and G recovered the number from the binary (below).

## G. The two compiled defaults

Full write-up with the disassembly: `evidence/decompile/README.md`; files listed there and in H. REA 6.7.0 and Ghidra 12.1.4 were installed for this (IDA is not on the machine), but the REA/Ghidra session over the 297 MB binary had to be aborted when the JVM passed 5.3 GB RSS with < 1 GB of memory left on this 13 GB machine (`rea-attempt-aborted-oom/`); REA was bypassed and the lookups were done at the instruction level (byte scans for the string references and for the arithmetic, `objdump` windows) and cross-checked against the Apache-2.0 source at tag `rust-v0.163.0`, which matches the binary instruction for instruction.

| number | function / address | decompiled expression | constant | confidence |
|---|---|---|---|---|
| `model_auto_compact_token_limit` default | `ModelInfo::auto_compact_token_limit` (`protocol/src/openai_models.rs:529`), inlined at 0x68aa194–0x68aa1ed (+ 0x68aa1fe, 0x75e395c, 0x75e3b4f, 0x762316d) | `min(catalog.auto_compact_token_limit, resolved_context_window * 9 / 10)`; with the catalog value null (every model): `context_window * 9 / 10` | **90 % of the context window → 244 800 tokens** for the 272 000-token gpt-6 models (the 95 % `effective_context_window_percent` cap, 258 400, is a separate hard limit, not the compaction trigger) | high |
| `agents.max_concurrent_threads_per_session` default | `resolve_multi_agent_v2_config` (`core/src/config/mod.rs:2813`) at 0x75950f0; the default literal at 0x759522f `mov esi,0x4` | `features.multi_agent_v2.max_concurrent_threads_per_session ?? (agents.max_concurrent_threads_per_session + 1, saturating) ?? 4`, enforced on the registry's total thread count (`agent/registry.rs:90,333`) | **4 total threads = 3 children**; confirmed by E | high |

## H. Hand-back

1. Redaction check: both commands of the plan print nothing for `evidence/live` and `evidence/decompile`. On the whole `evidence/` the first command prints the pre-existing `evidence/captures/exec-json.capture.json`, a false positive: path names containing "risk" followed by "-assessment" or "-management" match the `sk-…` pattern; that file was not produced by this run and was left as is. What was redacted in the live files (`redact.sh`, applied to 35 files): plugin ids of the form `plugins.<name>@<marketplace>.enabled` in the `config/read` responses and one `…-tor[at]default.service` directory name (shown here already redacted) in a run's command output were rewritten with `[at]` (they match the e-mail pattern but are not addresses), and `/home/<user>` became `$HOME`. The probes had already shortened the account e-mail (`c***@…`) and ids; no token or key was copied.
2. This file.
3. `node --test codex-math/test/*.test.mjs`: **11 tests, 11 pass, 0 fail** (nothing under `lib/`, `config/`, `test/` changed).
4. `codex-math/evidence/live/`, `codex-math/evidence/decompile/` and this `RESULTS.md` are ready to hand over.

### Files produced

`evidence/live/`: `environment.md`, `features.txt` (0.163.0), `features-0.146.0.txt`, `config.toml.redacted`, `readings.json`, `threads.json`, `sessions.json` (second pass), `probe-baseline.json`, `probe-baseline-threads.json` (0.146.0), `probe-baseline-0163.json` (0.163.0, with three thread queries), `runs/01-luna-low-mid` … `runs/09-spawn-limit` (each: `probe-before.json`, `events.jsonl`, `stderr.log`, `last-message.md`, `probe-after.json`, `meta.json`), `calibrate-live.out`, `calibration-summary.json`.

`evidence/decompile/`: `README.md`, `lea-hits.json`, `mul9div10-hits.json`, `const-cluster-hits.json`, `objdump-windows.txt`, `objdump-windows-validation.txt`, `objdump-windows-resolve-v2.txt`, `source-rust-v0.163.0-excerpts.md`, `rea-attempt-aborted-oom/` (driver.log, open_binary.json, rea-stderr.log).

`scripts/decompile/` (new, so the runbook can be re-run elsewhere): `lea-scan.py`, `mul9div10-scan.py`, `const-cluster-scan.py`, `rea-driver.mjs` (REA MCP driver: open_binary → search/xrefs/resolve/pseudo-code → close with snapshot), `run-rea.sh` (environment: Ghidra dir, 5 G heap, 4 h startup deadline, six heavy analyzers disabled). `scripts/calibrate-live.mjs` was patched as described in D.

Changes outside `codex-math/` on this machine: Codex updated 0.146.0 → 0.163.0 (`codex update`; 0.146.0 kept under `~/.codex/packages/standalone/releases/`), `rea-agents` 6.7.0 installed under `~/.local`, Ghidra 12.1.4 extracted to `~/Installs/ghidra/`, a scratch repo at `/tmp/relay-scratch`, a shallow clone of `openai/codex` at `rust-v0.163.0` in the agent's scratchpad. One "Full reset" credit remains unused; nothing was purchased.

## Addendum: verification and re-analysis (2026-10-22, from the sandbox side)

Everything above was checked against an independent copy of the same binary (SHA-256 identical) and re-computed from the files in `live/`:

- **G verified.** The disassembly at 0x68aa194–0x68aa1ed reads `lea rax,[rax+rax*8]; movabs rcx,0x6666666666666667; imul rcx; sar rdx,2; add` (×9, signed ÷10), then `cmp rdx,r11; cmovl` (min with the catalog value) and `cmp byte [rsi+0x20],0; cmove` (catalog None → the context limit): `context_window × 9 / 10`. At 0x759522f `mov esi,0x4`, then `cmp r13,1; jne` (agents value absent → 4) and `inc r15; mov rsi,-1; cmovne rsi,r15` (present → saturating +1); the wait-timeout literals 0x2710 / 0x36ee80 / 0x7530 follow at 0x759526b–0x7595283. Both match the excerpts in `decompile/source-rust-v0.163.0-excerpts.md`.
- **D re-priced.** Every `ratedCredits` in the table reproduces from `turn.completed.usage` and the published rates (e.g. 01: 0.078714, 07: 1.761575 at Fast 2.5×, 08: 4.42815).
- **The capacity estimate in D was wrong in method, not in data.** `calibrate-live.mjs` took consecutive readings *within one thread*, so every other thread's usage inflated ΔU, and a thread whose cumulative total falls (a review stream logged under the same thread id; 89 such drops in thread `01a153ea…`) was counted as new usage: hence 22,026 credits with a range of 27 – 1,117,710. The readings also mix three plan types (the machine's rollouts carry `pro`, `team` and `self_serve_business_prolite` windows), which were pooled into one "primary". The script now pools the account's credit timeline over threads per plan type (`lib/calibration.mjs` `accountTimeline`: per-thread monotone streams, deltas summed over threads) and reads it against each window's high-water mark (`capacitySamples`: interleaved stale snapshots such as 5 → 4 → 5 are no longer taken for resets). Result for `self_serve_business_prolite`: **Q̂ = 6,176 credits per weekly window** (29 integer steps over two windows; 6,239 / 6,146 / 6,077 / 6,679 by day; the regenerated `live/calibration-summary.json` and `live/calibrate-live.out`). A per-model fit over the same steps (residual 0.19 points) gives gpt-6.1-sol 6,454, gpt-6-sol 6,872, gpt-6-astra 13,442 — Astra counts about half its published rate on this meter, now `pricing.includedMeterWeight` in `config/codex-harness.json`. Team (212 / 277 per 5-hour window, 1,300 / 1,640 per week) and Pro (12,600 – 18,100 per week) are weaker and carried as priors only. Details: `harness/FINDINGS.md` §9.
- **Context window.** `model_context_window` is 475,000 (= 500,000 × 95%) in every `gpt-6.1-sol` reading from 2026-10-14T07:15Z on and 258,400 before, on all three plans: the remote model catalog overrides the binary's static 272,000. Folded into `config/codex-harness.json` (`models[gpt-6.1-sol].observedContextWindow`) and `lib/harness.mjs`.
- **Token mix.** The account's sessions are 97.1% cached input, 2.6% uncached input, 0.3% output by tokens (window 2, 326 M tokens); the routing priors now use this mix, at which `tokensPerUnit = 70,000` reproduces the per-unit credits of the scratch runs.
