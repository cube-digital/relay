# codex-math: relay's model for the Codex harness

The math behind relay (`lib/forecast.mjs`, `lib/calibration.mjs`, `lib/budget.mjs`) was built for Claude Code: a 5-hour and a weekly window read by a mod, one usage rate for every tier, tier weights 1 : 3 : 7. This folder is the same model rebuilt for the Codex harness (the ChatGPT coding agent: CLI, `exec`, app-server, desktop app), on facts read from the Codex 0.163.0 binary with REA rather than assumed. It is the math only; wiring it into relay's commands, skills and `relay budget --codex` is the next step and is described at the end.

- `harness/FINDINGS.md` — what the harness meters, stores and exposes, with the evidence for every fact. Read this first; it is the document that replaces reverse engineering.
- `config/codex-harness.json` — the same facts, machine-readable (model catalog, credit rates, windows per plan, protocol field names, config keys, hook events, store layout), each with its evidence.
- `config/codex-routing.json` — relay's policy on Codex: tiers → model/effort/speed, per-window stop lines, the degrade order, the reset-credit rule, the forecast priors.
- `lib/` — the model: `pricing.mjs` (tokens → credits, tier prices), `windows.mjs` (one snapshot shape for every reading source), `walk.mjs` (the multi-window walk), `forecast.mjs`, `calibration.mjs`, `budget.mjs`, `harness.mjs`.
- `test/` — `node --test codex-math/test/*.test.mjs` (uses relay's `lib/plan.mjs` and `lib/lanes.mjs` for the example plan).
- `docs/whitepaper/` — the one-page whitepaper, its data and figure, rebuildable.
- `evidence/` — the REA captures, schemas, catalog and string table the findings cite; `evidence/live/` (probes, nine priced runs, 10,220 mined readings) and `evidence/decompile/` (the two compiled defaults with their disassembly) from the live run of 2026-10-22, written up in `evidence/RESULTS.md`.
- `harness/AGENT-PLAN.md` + `scripts/` — the plan a Claude Code agent runs on a machine with a logged-in Codex and REA to collect live readings, priced runs and the two compiled defaults (executed once; re-run it on another plan to measure that plan's windows); `harness/DECOMPILE.md` is its decompilation runbook.

## What is different on Codex, in one paragraph

The account's windows are plan-shaped (Plus/Business: 5-hour + weekly; Pro: weekly only) and come from `account/rateLimits/read` or the rollout's `token_count` event, never from a hardcoded 5h/7d; usage is metered in credits with published per-model rates (astra : sol 6.1 : luna ≈ 62 : 15 : 1 per relay unit at the prior token mix on the included meter (tier efforts applied, Astra at half weight; per token at published rates 100 : 14 : 1), which is 97% cached input; the included meter counts Astra at half its published rate; a Business weekly window measured ≈ 6,200 credits, a Team 5-hour window measured 212 and 277 (prior 210)); Fast mode meters 2.5× the included usage for a 1.5–2× speedup; every subagent is its own thread with its model, effort and token total on disk, so credits are attributable per lane; a spawn takes model, effort and speed and a `PreToolUse` hook can rewrite it; reset credits restore every window at once; and a thread goal with a token budget is a built-in marathon.

## The model

A task weighs `w = tierWeight[tier] × riskFactor[risk]` units as in relay. On tier τ a unit processes `tokensPerUnit[τ]` tokens split by `tokenMix` into uncached input, cached input and output; the model's credit rates, the speed multiplier and the effort multiplier on output turn that into `c_τ` credits per unit (`pricing.tierProfile`). Lane credits add, a fix round re-works `fixRoundCost` of a lane with the risk's probability, and window `j` of capacity `Q_j` credits is used by `ΣC̃ / Q_j`. The walk (`walk.simulate`) runs every window at once: a wave starts while all windows are below their stop lines, pauses at a line until that window resets, rolls windows over on their own schedule, and spends a reset credit instead of a long pause. Calibration (`calibration.summarize`) learns capacities `Q̂_j = 100 ΣΔC / ΣΔu_j` from pairs of readings with no reset in between, credits per unit per tier from attributed threads (or NNLS over wave totals), and minutes per unit from the ledger.

## Using it

```js
import { loadHarness, loadCodexRouting } from './codex-math/lib/harness.mjs';
import { fromAppServer, fromRolloutJsonl } from './codex-math/lib/windows.mjs';
import { forecast, formatForecast } from './codex-math/lib/forecast.mjs';
import { levelFor, routeSpawn, resetAdvice } from './codex-math/lib/budget.mjs';
import { capacitySamples, tierSamples, summarize, calibrationFromSummary } from './codex-math/lib/calibration.mjs';

const harness = loadHarness();
const routing = loadCodexRouting();
const snapshot = fromAppServer(rateLimitsReadResult);      // or fromRolloutJsonl(text) from the newest rollout
console.log(formatForecast(forecast({ plan, lanes, routing, harness, calibration, snapshot })));
const level = levelFor(snapshot, routing);                  // normal | tight | critical | unknown
const spawn = routeSpawn({ subagentType: 'relay:implementer-deep', speed: 'fast' }, level, routing, harness);
// spawn.model / spawn.effort / spawn.speed go into spawn_agent (or the PreToolUse hook's updatedInput); spawn.deny blocks it
```

Calibration samples: `capacitySamples(readings)` from a list of `{ at, windows, credits }` (credits from `account/usage/read { threadId }` summed over the run's threads where the plan exposes it, else from tokens × rates with `pricing.creditsForTokens`); readings of concurrent threads are read against each window's high-water mark, so interleaved stale snapshots neither count twice nor pass for a reset. `accountTimeline(readings, harness, { planType })` builds that list for a whole account from the `token_count` readings of every rollout on a machine (`scripts/extract-readings.mjs`), pooling the threads' token deltas at the published rates, which is how the first capacities were measured before relay ran at all (`harness/FINDINGS.md` §9: a Business weekly window is ≈ 6,200 credits, 62 per point; Astra counts half its published rate on the included meter, `pricing.includedMeterWeight`). `tierSamples(threads, harness)` from the run's threads with their tier, units, and credits or token usage (`calibration.threadsFromStateDb` reads `state_5.sqlite`, `usageFromRolloutJsonl` a rollout); `waveSamplesFromLedger(ledger, laneModels)` from relay's ledger stamps when threads are not attributed. `summarize(samples)` gives `windowCapacityCredits`, `creditsPerUnit` (at one model, effort and speed per tier) and `minutesPerUnit`; `calibrationFromSummary` the object `forecast` takes. `scripts/calibrate-live.mjs` runs all of it on `evidence/live/`.

## Wiring into relay (not done here)

1. `relay budget --codex` should read the app-server (`account/rateLimits/read`, keeping the `account/rateLimits/updated` stream) and fall back to the newest rollout's `token_count`; drop `resets_in_seconds`.
2. The Codex hooks file gets a `PreToolUse` hook on `spawn_agent` that calls `routeSpawn` and answers with `updatedInput` (model, reasoning_effort, service_tier) or a deny; `SubagentStart`/`SubagentStop` stamp the ledger with the agent's thread id so `tierSamples` can attribute credits.
3. `relay calibrate` on Codex reads `state_5.sqlite` threads created during the run, asks `account/usage/read` for each, and adds capacity samples from the ledger stamps.
4. `relay forecast` prints `formatForecast` from this folder when the harness is Codex; the marathon becomes a conductor thread with `/goal` and a token budget from the forecast, resumed with `codex exec resume`.
