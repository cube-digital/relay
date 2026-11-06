# Codex-math Integration Plan

**Goal:** Relay on Codex routes, gates, plans lanes and forecasts with the Codex model from `codex-math/`. The shipped Codex path does not use Claude's numbers anywhere.
**Spec:** the approved integration spec in the planning brief (2026-10-30); the model itself is `codex-math/harness/FINDINGS.md` and `codex-math/lib/*.mjs`, accepted as is.
**Architecture:** `codex-math/config/codex-routing.json` becomes the single Codex source and a declared `relay build` source, beside `roles/*.md` and `config/routing.json`, which becomes Claude-only. Build checks the Codex role registry and source labels and generates the `[agents]` defaults and a new role-registration snippet. Codex agent TOMLs stay model-free; `hooks/codex-spawn.mjs` alone enforces model and effort. `relay setup codex` registers every role in the project `.codex/config.toml`, so `agent_type` exists and the hook sees the role. The Codex budget level, spawn hook, lane cap, forecast and marathon read only the Codex source. `codex-math/lib` stays where it is.

## Evidence (live, Codex 0.163.0, 2026-10-30)

Scratch repo, relay plugin disabled, parent `gpt-6.1-sol`/`low`, trusted project:
- Probe 1: `.codex/agents/probe.toml` (model `gpt-6-luna`, effort `low`), no config registration. `spawn_agent` had no `agent_type` parameter; its parameters were exactly `task_name, message, model, reasoning_effort, fork_turns`. The child ran on the requested model and loaded no role (`agent_role` null).
- Probe 2: same, plus `-c agents.probe.description=… -c agents.probe.config_file=<absolute path to probe.toml>`. `spawn_agent` gained `agent_type` with values `probe, default, explorer, worker`.
- Probe 3: registered role; spawn requested `agent_type probe`, `model gpt-6-sol`, `reasoning_effort medium`, `fork_turns none`. The child rollout shows `agent_role: probe`, the TOML's `developer_instructions` loaded, and turn_context `model gpt-6-luna`, `effort low`. **A model/effort in the agent TOML wins; the spawn's requested model/effort are ignored.**

- Probes 4–6 (project `.codex/config.toml` with `[agents.probe]`, trust given only through `-c projects."<dir>".trust_level="trusted"`): neither a relative nor an absolute `config_file` exposed `agent_type`, and the same file's `model = "gpt-6-luna"` was also ignored (the session ran the user default `gpt-6.1-terra`/`high`). So Codex did not read the project config at all in that state. Most likely it reads the project layer only when the project is trusted in `~/.codex/config.toml`. This is not confirmed: confirming it needs an edit to the user's global config. Relative-path resolution is still unknown.

Decision (user, 2026-10-30): setup writes the role registrations to the project `.codex/config.toml` (absolute paths), and doctor warns when the project is not trusted in `~/.codex/config.toml`, because otherwise Codex ignores the whole project config, including the `[agents]` defaults setup already writes.

Consequences: (1) relay's TOMLs must not pin model or effort, or the hook's budget caps stop working; (2) relay never registered its roles, so on Codex `agent_type: relay-<role>` was never offered, the hook never saw a role and per-role routing never happened (T9). Whether a relative `config_file` resolves against the config file is not known; setup uses absolute paths. The binary only says `config_file must point to an existing file at …`.

## Global Constraints

- Sources: `roles/*.md`, `config/routing.json` (Claude) and `codex-math/config/codex-routing.json` (Codex). Never hand-edit `agents/*.md`, `codex/**` or the `<relay:generated>` block in `hooks/register.ts`; run `node bin/relay build`. `agents/*.md` and `hooks/register.ts` must stay byte-identical (Claude output does not change).
- Codex agent TOMLs carry no `model` or `model_reasoning_effort` (Evidence, probe 3). Keep the assertion in `test/build.test.mjs` (`codex agent leaves dispatch model precedence intact…`). Model and effort are enforced only by `hooks/codex-spawn.mjs`.
- Codex tiers (already in `codex-routing.json`, do not change): cheap = `gpt-6-luna` / `low`, mid = `gpt-6.1-sol` / `medium`, strong = `gpt-6-astra` / `high`, speed `standard`. Role tiers come from `roles/*.md`: architect and implementer-deep strong; scout and implementer-fast cheap; all others mid.
- Codex stop lines (from `codex-routing.json` `budget`): primary 60 tight / 85 critical; secondary 80 / 95; any window of 10080 minutes or more 80 / 95, whatever its position. `unknown` (no reading or a stale one) routes as `tight`.
- Codex lane cap: `min(codex-routing lanes.maxParallelLanes, maxConcurrentChildren(loadHarness()))` = min(4, 3) = 3. An explicit `--max-lanes N` wins over the cap.
- Do not change any numeric value in `codex-math/config/*.json`, `codex-math/lib/*.mjs` or `codex-math/docs/whitepaper/data.json`. Do not change Claude-side numbers in `config/routing.json`. Where code and a doc disagree, the code wins and the doc changes.
- Hooks fail open: any error in `hooks/codex-spawn.mjs` exits 0 with nothing on stdout. Keep the existing `try/catch`.
- No dependencies; plain Node ≥ 20. CLI tests use real git repositories (`test/helpers.mjs` `tempRepo`, `runCli`, `runHook`). Always pass `--harness claude|codex` explicitly in tests: the test runner may itself run inside Codex, where the default harness is `codex`.
- Skills: frontmatter `name` + `description` only; shared by both harnesses; name actions, not tools; keep SKILL.md short and put Codex detail in `skills/using-relay/references/codex.md`.

## Review Focus

- `codex/agents/*.toml` must stay model-free: `git diff main -- codex/agents` must be empty.
- Role registration uses absolute `config_file` paths, so a committed `.codex/config.toml` is machine-specific; on another checkout path Codex may refuse the config (`config_file must point to an existing file`). Docs must say so. One live check should test whether a relative path (`agents/relay-<role>.toml`) resolves against the config file; if it does, switch setup to relative paths.
- `relay setup codex` on an existing config keeps the old bytes as an exact prefix, appends only missing `[agents.relay-<role>]` tables, is idempotent, and never writes when the result fails `configProblem`.
- Claude output unchanged: `git diff main -- agents/ hooks/register.ts` must be empty.
- The codex-math numbers unchanged: `git diff main -- codex-math/config codex-math/lib codex-math/docs/whitepaper/data.json` shows only comments, `$sources` keys and labels.
- Lane partitions must agree between `relay lanes --write`, `relay worktrees sync` and `relay calibrate` for one run. All three resolve the harness the same way (flag, then `RELAY_HARNESS`, then Codex session env). Check that no caller under Codex silently falls back to the Claude cap of 4.
- `$sources` keys inside `budget`, `lanes`, `forecast`, `forecast.prior` and `windowCapacityCredits` must not be read as a window, tier or plan by any code that iterates those objects.
- `hooks/codex-spawn.mjs` still fails open when `codex-routing.json` cannot be read.
- After T5 nothing reads `routing.tiers.<tier>.codex`; grep `lib scripts hooks bin` for `.codex` on routing objects and `modelFor(` with `'codex'`.

## Tasks

### T1: Build reads and checks the Codex routing source

`scripts/build.mjs`:

- Import `loadCodexRouting` and `loadHarness` from `../codex-math/lib/harness.mjs`. In `outputs(root)` load `const codexRouting = loadCodexRouting(join(root, 'codex-math'))` and pass it to `codexConfigSnippet` (it stops taking the shared `routing`).
- `codexAgent` does not change: no `model`, no `model_reasoning_effort` (Evidence, probe 3). `codex/agents/*.toml` stay byte-identical.
- `codexConfigSnippet(codexRouting)`: `const tier = codexRouting.tiers[codexRouting.defaultSubagentTier]`; first line becomes `# generated by scripts/build.mjs from codex-math/config/codex-routing.json`. Other lines unchanged.
- New exported `checkCodexRouting(roles, codexRouting, harness)` returning problem strings (prefix every one with `codex-math/config/codex-routing.json: `):
  - for each role: `codexRouting.roles?.[role.name] !== role.tier` → `roles.<name> is "<value>", but roles/<name>.md has tier "<tier>"`;
  - for each key of `codexRouting.roles` with no role → `roles.<name> has no roles/<name>.md`;
  - for each tier in `TIERS`: missing → `tiers.<tier> is missing`; model not in `harness.models` (by `slug`) → `tiers.<tier>: <model> is not in codex-harness.json models`; effort not in that model's `reasoningEfforts` → `tiers.<tier>: <model> does not advertise effort "<effort>"`.
- `main`: `problems = [...checkSkills(root), ...checkCodexRouting(loadRoles(root), loadCodexRouting(join(root, 'codex-math')), loadHarness(join(root, 'codex-math')))]`. Keep the success message text unchanged.
- Update the file's header comment: sources are `roles/*.md + config/routing.json + codex-math/config/codex-routing.json`.

Run `node bin/relay build`; only `codex/config.snippet.toml` changes (its first line).

Test in `test/build.test.mjs` (keep every existing assertion, including line 28's `doesNotMatch(model…)`): `checkCodexRouting([{ name: 'scout', tier: 'cheap' }], { roles: { scout: 'mid', ghost: 'mid' }, tiers: loadCodexRouting().tiers }, loadHarness())` reports exactly two problems, matching `/roles\.scout/` and `/roles\.ghost/`.

### T2: Codex budget level and spawn hook use the Codex stop lines

`lib/budget.mjs`:

```js
import { levelFor as codexLevelFor } from '../codex-math/lib/budget.mjs';
import { loadCodexRouting } from '../codex-math/lib/harness.mjs';

// Claude: windows = { fiveHour?: { percentUsed }, sevenDay?: { percentUsed } }, lines from config/routing.json `budget`.
// Codex: a snapshot { windows: [{ id, usedPercent, windowMinutes }], reached? }, lines from
// codex-math/config/codex-routing.json `budget` (primary 60/85, secondary 80/95, any window of
// seven days or more 80/95); `budget` is ignored for it.
export function levelFor(windows, budget, codexRouting) {
  if (windows?.windows || windows?.reached) return codexLevelFor(windows, codexRouting ?? loadCodexRouting());
  // ...the Claude branch below stays unchanged
}
```

Delete the old `if (windows?.windows) { … budget.sevenDay : budget.fiveHour … }` branch. Callers (`readBudget`, `relay-marathon` `budgetValue`, `session-start`) then get Codex lines with no further change.

`scripts/relay-budget.mjs` `readBudget`: for `harness === 'codex'` take `staleAfterMinutes` from `loadCodexRouting().budget` (both staleness checks); Claude keeps `loadRouting().budget`.

`hooks/codex-spawn.mjs`: remove the `loadRouting` import and lines 13 and 15–17 (the shared tiers and the shared tight/critical overlay). Use `const routing = loadCodexRouting();` as is. Keep `budget.level === 'unknown' ? 'tight' : budget.level`, the `fork_turns` rule, the output shape and the `try/catch` that exits 0.

Tests in `test/codex-budget.test.mjs` (fresh snapshot written to `RELAY_HOME/codex/budget.json`, `relay budget --harness codex --json`):
1. A secondary window shorter than seven days uses the secondary lines: `windows: [{ id: 'primary', usedPercent: 10, windowMinutes: 300 }, { id: 'secondary', usedPercent: 79, windowMinutes: 1440 }]` → `normal`; at 80 → `tight`; at 95 → `critical`. (Claude's lines would say tight at 60.)
2. A weekly-only account (`planType: 'pro'`, one `primary` window of 10080 minutes) at 79 → `normal`, at 80 → `tight`; and at 79 the spawn hook routes `relay-implementer-deep` (`fork_turns: 'none'`, no model) to `gpt-6-astra` / `high` unchanged.
The existing test already covers caps at tight, deny at critical and fail-open on malformed input. If no existing test spawns with no snapshot at all, extend test 2 with: no snapshot → `relay-implementer-deep` is routed to `gpt-6.1-sol` / `medium` (unknown acts as tight).

### T3: Codex forecast, lanes, calibration and marathon use only the Codex source, capped at 3 lanes

`lib/codex-integration.mjs`: `codexRouting()` stops reading `config/routing.json` (remove the `loadRouting` import):

```js
import { loadHarness, loadCodexRouting, maxConcurrentChildren } from '../codex-math/lib/harness.mjs';

// The Codex routing source as is; lanes capped at the child threads Codex runs at once
// (3 by default: 4 threads including the root, decompiled and observed in run 09).
export function codexRouting() {
  const routing = loadCodexRouting();
  const cap = maxConcurrentChildren(loadHarness());
  routing.lanes = { ...routing.lanes, maxParallelLanes: Math.min(routing.lanes.maxParallelLanes, cap) };
  return routing;
}
```

`scripts/relay-lanes.mjs` `planLanes(planPath, opts)`: `const harness = resolveHarness({ harness: opts.harness, codex: opts.codex })`; `const cfg = (harness === 'codex' ? codexRouting().lanes : loadRouting().lanes) ?? {}`; the `opts.maxLanes` / `opts.maxLaneTasks` overrides still win. Return `harness` in the result too. `main`: add `codex` to the booleans, pass `harness: args.harness, codex: args.codex`, and extend the usage line with `[--harness claude|codex]`.

`scripts/relay-calibrate.mjs`: `planLanes(planPath, { harness })` so calibration sees the run's partition.

`scripts/relay-forecast.mjs`: already passes `harness`/`codex` to `planLanes`; for Codex take `staleAfterMinutes` from `codexRouting().budget`.

`scripts/relay-marathon.mjs` (around line 287): `const mid = harness === 'codex' ? codexRouting().tiers.mid : routing.tiers.mid.claude;` then `model: args.model ?? mid.model, effort: args.effort ?? mid.effort`. Leave `locate()` alone (it only needs the slug).

Tests in a new `test/codex-routing.test.mjs` (a `tempRepo` with a plan of four independent cheap/low tasks on four distinct files, each `done: "true"`):
1. `relay lanes <plan> --harness codex --json` puts wave 1 in 3 lanes; `--harness claude --json` in 4.
2. `relay forecast <plan> --harness codex --json` reports `parallel.cap` 3; with `--max-lanes 4` it reports 4.
3. `codexRouting().forecast` deep-equals `loadCodexRouting().forecast` and `codexRouting().tiers` deep-equals `loadCodexRouting().tiers` (no Claude value overrides the Codex T, R, κ, p, priors or tiers).

### T4: Source label on every Codex number, checked by build

Add `$sources` objects to `codex-math/config/codex-routing.json`. Do not change any number, tier or role. Insert each object as the first key after `$comment` in its container (create one in `lanes`, which has no `$comment`).

Top-level `$comment`: append ` It is a relay build source: \`relay build --check\` checks \`roles\` against roles/*.md and requires a \`$sources\` label for every number.`

`budget.$sources`:

```json
"$sources": {
  "windows": "policy: relay's Claude stop lines carried over by window position (primary 60/85 like the 5-hour window, secondary 80/95 like the weekly one); not tuned on Codex",
  "weekly": "policy: 80/95 for any window of seven days or more, whatever its position (pro and self_serve_business_prolite have only a weekly primary window, harness/FINDINGS.md §9)",
  "staleAfterMinutes": "policy: same as config/routing.json",
  "resetCredit": "policy: spend a reset credit only when the wait is at least an hour; keep none in reserve"
},
```

`lanes`:

```json
"lanes": {
  "$sources": {
    "maxLaneTasks": "policy: same as config/routing.json",
    "maxParallelLanes": "policy: ceiling; relay clamps it to the child threads Codex runs at once, 3 by default (decompiled default of 4 threads including the root; observed in evidence/live/runs/09-spawn-limit)"
  },
  "maxLaneTasks": 6,
  "maxParallelLanes": 4
},
```

`forecast.$sources`:

```json
"$sources": {
  "tierWeight": "prior: relay's tier ladder T = 1/3/7, read as relative token volume; not measured on Codex",
  "riskFactor": "prior: relay's risk factor R = 0.8/1/1.4; not measured on Codex",
  "fixRoundProbability": "prior: relay's fix-round probability p = 0.2/0.5/0.8 by a lane's riskiest task; not measured on Codex",
  "fixRoundCost": "prior: share of a lane a fix round re-works, κ = 0.35; not measured on Codex"
},
```

`forecast.prior`: replace its `$comment` with `"Replaced by \`relay calibrate --harness codex\` samples where they exist. \`$sources\` says which values are priors and which are measured or documented."` and add:

```json
"$sources": {
  "tokensPerUnit": "prior: scale prior, uncalibrated at relay's unit (70k tokens per unit on every tier). At tokenMix it gives 0.027 / 0.41 / 1.65 credits per unit (cheap / mid / strong, included meter). Nine scratch runs measured 0.018–0.026 (cheap) and 0.30–0.49 (mid), which the prior matches, and 0.74 metered for strong (1.48 at published rates), so the strong prior is conservative, 2.2× measured (evidence/RESULTS.md §D, harness/FINDINGS.md §9)",
  "tokenMix": "measured: α = 3% uncached input / 96.5% cached input / 0.5% output, rounded from real sessions on one Business account, 2026-10-20 → 22 (326 M gpt-6.1-sol tokens: 2.6% / 97.1% / 0.3%); the scratch runs ran 7–30% uncached and 1% output (harness/FINDINGS.md §9)",
  "effortOutputMultiplier": "prior: not measured; the scratch runs produced 0–148 reasoning tokens, too few to see it",
  "minutesPerUnit": "prior: relay's Claude default of 4 minutes per unit; replaced by timed waves from `relay calibrate --harness codex`"
},
```

`forecast.prior.windowCapacityCredits`: keep its `$comment`, add:

```json
"$sources": {
  "plus": "prior: assumed equal to team (OpenAI documents Plus and Standard Business with the same per-five-hour estimates)",
  "business": "prior: assumed equal to team (same documented estimates as Plus)",
  "team": "prior: 210 / 1,400 rounded from weak measurements: 5-hour windows 212 and 277, weekly 1,300 and 1,640 (one machine's rollouts; usage on other devices is invisible and biases them low)",
  "self_serve_business_prolite": "measured: weekly window, 29 integer steps over two windows, Q̂ = 6,176 with Astra weighted 0.5, rounded to 6,200 (harness/FINDINGS.md §9)",
  "pro": "prior: 15,000, inside a weak measured range of 12,600–18,100 (four weekly steps)",
  "promax": "prior: placeholder, 4 × pro",
  "unknown": "prior: same as plus"
},
```

`scripts/build.mjs`: add and export, and append `...checkCodexSources(codexRouting)` to the problems in `main` (reuse the routing object T1 loads):

```js
const SOURCE_LABEL = /^(prior|measured|documented|observed|decompiled|policy)\b/;
const SOURCED = ['budget', 'lanes', 'forecast', 'forecast.prior', 'forecast.prior.windowCapacityCredits'];

function hasNumber(value) {
  if (typeof value === 'number') return true;
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.entries(value).some(([k, v]) => !k.startsWith('$') && hasNumber(v));
  return false;
}

// Every number in the Codex routing source says where it comes from.
export function checkCodexSources(codexRouting, file = 'codex-math/config/codex-routing.json') {
  const problems = [];
  for (const path of SOURCED) {
    const node = path.split('.').reduce((o, k) => o?.[k], codexRouting);
    if (!node) continue;
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('$') || SOURCED.includes(`${path}.${key}`) || !hasNumber(value)) continue;
      const label = node.$sources?.[key];
      if (typeof label !== 'string' || !SOURCE_LABEL.test(label)) problems.push(`${file}: ${path}.${key} needs a source label in ${path}.$sources (prior:, measured:, documented:, observed:, decompiled: or policy:)`);
    }
  }
  return problems;
}
```

Test in `test/build.test.mjs`: `checkCodexSources({ lanes: { $sources: { maxLaneTasks: 'policy: x' }, maxLaneTasks: 6, maxParallelLanes: 4 } })` returns exactly one problem, matching `/lanes\.maxParallelLanes needs a source label/`. The shipped file is covered by the existing `main(['--check'])` test.

### T5: config/routing.json becomes Claude-only

After T1–T3 nothing reads `tiers.<tier>.codex`. In `config/routing.json` replace `$comment` and `tiers` with exactly:

```json
  "$comment": "Single source of truth for Claude model routing, Claude budget policy, lane limits and Claude forecast weights. Codex routing, budget and forecast live in codex-math/config/codex-routing.json. Edit either, then run `relay build` (regenerates agents/, codex/agents/, codex/config.snippet.toml and the routing block in hooks/register.ts).",
  "tiers": {
    "cheap": { "claude": { "model": "haiku", "effort": "low" } },
    "mid": { "claude": { "model": "sonnet", "effort": "medium" } },
    "strong": { "claude": { "model": "opus", "effort": "high" } }
  },
```

Everything else in the file stays byte-identical. Before committing, `grep -rnE "\.codex\b|'codex'\)" lib scripts hooks bin` must show no read of a routing `tiers` entry; fix any stray reader by switching it to `codexRouting()` from `lib/codex-integration.mjs`. `node bin/relay build` must report no change to `agents/` or `hooks/register.ts`.

### T6: codex-math doc corrections (labels and prose only)

No number of the model changes; where a doc disagrees with the code, the doc takes the code's value.

- `codex-math/docs/whitepaper/whitepaper.tex` §The model (line ~65): replace `credits: 0.027, 0.41 and 1.65 at the priors, which is what nine scratch runs of 1--3 units measured (0.018--0.026, 0.30--0.49, 0.74).` with `credits: 0.027, 0.41 and 1.65 at the priors. Nine scratch runs of 1--3 units measured 0.018--0.026 and 0.30--0.49 for the first two, in line with the priors, and 0.74 metered for strong (1.48 at published rates): the strong prior is conservative, 2.2$\times$ what was measured.` Keep the literal `0.027, 0.41 and 1.65` (the test quotes it).
- Same file (line ~53): replace `The usable context is 95\% of the window (258\,400 tokens; Sol~6.1 got a 500\,k window from the remote catalog on 14~October); auto-compaction triggers at 90\% of the window (244\,800, decompiled);` with `The usable context is 95\% of the window and auto-compaction triggers at 90\% (decompiled): 258\,400 and 244\,800 tokens on the 272\,k window of Astra and Luna, 475\,000 and 450\,000 on Sol~6.1, whose remote catalog has given it a 500\,k window since 14~October;`. Grep the file for other `244` mentions that imply every model and qualify them the same way. Keep the literal `244\,800`.
- Same file: wherever 210 is called a measured Team capacity, call it the Team prior (measured 212 and 277). Keep the literal `210 credits`.
- Rebuild the PDF if `pdflatex` exists: `cd codex-math/docs/whitepaper && pdflatex -jobname relay-codex-whitepaper whitepaper.tex` (skip `data.mjs` and `figures.py`: no number changed). Check `pdfinfo` still shows the same page count; if the page overflows, shorten the new wording, not the numbers. Delete `.aux`/`.log` byproducts. If `pdflatex` is missing, say so in the report.
- `codex-math/harness/FINDINGS.md`: add `## 10. Role registration and agent TOML precedence (observed, Codex 0.163.0, 2026-10-30)` with the three probes from this plan's Evidence section, in the file's style, and two conclusions: a custom agent TOML is offered as `spawn_agent` `agent_type` only when `[agents.<name>]` with `config_file` (and `description`) registers it; a `model` / `model_reasoning_effort` in the agent TOML overrides the spawn's requested model and effort. In §4's custom-agents sentence (line ~69) add `(observed on 0.163.0: not offered as agent_type until registered; a TOML model wins over the spawn's, §10)`.
- `codex-math/harness/FINDINGS.md` §2 table: header `relative per token at the agent mix` → `relative per token at published rates and the prior token mix (3% uncached / 96.5% cached / 0.5% output)`; gpt-6.1-sol `17.6` → `13.6` (`creditsPerToken` at `forecast.prior.tokenMix`, metering `credits`, relative to luna: astra 100, sol 6.1 13.63, sol 6 20.0, luna 1).
- `codex-math/harness/FINDINGS.md` §9 table row `single rate…`: label each number as Astra-weighted (0.5) or unweighted. Find out which by recomputing with `lib/calibration.mjs` on `evidence/live/readings.json` both ways (included meter vs metering `credits`); a number that matches neither gets `(weighting not recorded)`. Do not change the numbers.
- `codex-math/lib/budget.mjs` line 7 comment: `(astra : sol 6.1 : luna ≈ 100 : 18 : 1 per token at the agent mix)` → `(astra : sol 6.1 : luna ≈ 100 : 14 : 1 per token at published rates and the prior token mix; 62 : 15 : 1 per relay unit on the included meter, where Astra counts half and effort scales output)`. Comment only.
- `codex-math/README.md` line 16: `astra : sol 6.1 : luna ≈ 62 : 15 : 1 per unit at the measured session mix` → `astra : sol 6.1 : luna ≈ 62 : 15 : 1 per relay unit at the prior token mix on the included meter (tier efforts applied, Astra at half weight; per token at published rates 100 : 14 : 1)`; and `a Team 5-hour window ≈ 210` → `a Team 5-hour window measured 212 and 277 (prior 210)`.
- `codex-math/test/whitepaper.test.mjs` line 27: assertion message `measured Team capacity: …` → `Team capacity prior (210; measured 212 and 277): the plan rolls into a second 5-hour window without a pause`. Message only; values unchanged.

### T7: Agent-facing Codex instructions (skills and host reference)

`skills/using-relay/references/codex.md`:
- Replace the second paragraph (`Read <relay-root>/config/routing.json …`) with: Codex routing lives in `<relay-root>/codex-math/config/codex-routing.json`: cheap `gpt-6-luna`/`low`, mid `gpt-6.1-sol`/`medium`, strong `gpt-6-astra`/`high`, standard speed. Agent definitions carry no model or effort, because a model in an agent TOML overrides the spawn request (observed, Codex 0.163.0). Request model and effort on every clean spawn with the active tool's supported fields. The native spawn hook applies budget caps. `agent_type: relay-<role>` exists only after `setup codex` registers the roles in the project `.codex/config.toml`; when it is missing, use the fallback above and request the tier's model and effort explicitly. Project `[agents]` defaults backstop omitted choices. Do not change the parent session model or personal settings.
- Add a section `## Budget and concurrency`: `relay budget --harness codex` reads the account's actual windows. A 5-hour primary window is tight at 60% and critical at 85%; a secondary window under seven days at 80% / 95%; any window of seven days or more (the weekly window, and the only window on Pro) at 80% / 95%. No reading or a stale one is `unknown`: act as tight. Under a cap the hook lowers speed first, then effort, then model. A Codex session runs at most three child agents at once by default; the fourth spawn fails with `agent thread limit reached`. A finished agent holds its slot until it is closed. Under Codex, `relay lanes`, `forecast` and `worktrees sync` plan at most three lanes per wave. Coordinate lanes from the root session: a conductor child takes one slot. Close test-authors and reviewers when their results are recorded, and close a lane agent when its review is clean. When every slot is busy and a lane needs review, use the out-of-process review (`codex exec --sandbox read-only -o <review path> …`), which takes no slot. Do not retry a failed spawn in a loop: wait for an agent, close it, then spawn.
- `skills/run-lanes/SKILL.md` step 3, Codex bullet: append `Keep at most three agents open; close each finished agent you will not resume (host reference).`
- `skills/using-relay/SKILL.md`: Dispatch, replace `Set Codex model and effort from routing.` with `Codex: request the tier's model and effort on every clean spawn; agent definitions carry none.` Budget, replace `Tight or unknown: keep Opus for final review.` with `Tight or unknown: keep the strong tier for the final review. Codex stop lines are per window (host reference).`
- `skills/relay-setup/SKILL.md`: in Codex, after `budget --harness codex reads the account's actual windows.` add `and applies the Codex stop lines`. Add: `Setup registers each role in project .codex/config.toml with an absolute config_file path. Codex offers relay-<role> as an agent type only after registration. The native plugin install does not register roles; run setup codex for them.` Routing section, replace `Edit config/routing.json or roles/, then run the bundled build.` with `Edit roles/, config/routing.json (Claude) or codex-math/config/codex-routing.json (Codex), then run the bundled build. build --check fails when a Codex role tier disagrees with roles/ or a Codex number has no source label.` (keep the existing backtick formatting style).
Write in the repository's STE style (short sentences, clear actors). Add no frontmatter keys.

### T8: Human docs describe the new Codex routing and budget

Update, briefly and only where they describe Codex routing, budget, lanes or sources:
- `AGENTS.md` first bullet: sources are `roles/*.md`, `config/routing.json` and `codex-math/config/codex-routing.json`.
- `CONTRIBUTING.md`, `docs/guides/development.md`, `docs/architecture/overview.md`: same source list wherever they name the build sources.
- `README.md`: §7 paragraph and the mermaid `src` node (add `codex-math/config/codex-routing.json`); the Codex install paragraph sentence `Generated Codex TOML agent definitions leave model and effort to explicit dispatch and the spawn guard…` → agent definitions stay model-free on purpose (a TOML model overrides the spawn request, observed on Codex 0.163.0); setup registers each role in `.codex/config.toml` with an absolute `config_file` (the native plugin cannot register roles), so a committed project config is machine-specific; Configuration paragraph at line ~958 (Codex routing is a build source; build checks its role tiers against `roles/` and a source label on every number; the Codex budget uses its own per-window lines; Codex lanes are capped at three); roadmap item `Codex model names in config/routing.json` → `codex-math/config/codex-routing.json`; Contributing line ~1021.
- `docs/configuration/README.md`: the source table (lines ~12–15), the mermaid graph, line ~36 (build now reads and checks the Codex source), the tier table (Codex column now sourced from `codex-routing.json`), line ~54 (TOMLs stay model-free, now with the reason; the new `codex/agents.snippet.toml` and the registration setup writes), line ~76 (Codex uses primary 60/85, secondary 80/95, weekly 80/95 from `codex-routing.json`; unknown routes as tight), lines ~80 and ~94 (the hook no longer overlays shared tiers or tight/critical policy; the registry is checked by build), line ~112 (the Codex forecast takes T, R, κ, p, priors and lanes from `codex-routing.json` only; lanes capped at `min(4, 3)`; `--max-lanes N` overrides for a project that raised `[agents] max_concurrent_threads_per_session`, which `relay worktrees sync` does not read), and line ~259 (the new build problems from T1 and T4).
Do not edit `docs/design.md` or anything under `docs/relay/`. Keep the existing tone; no new sections beyond what the changes need.

### T9: Register relay's roles in the Codex project config

Relay never registers its roles, so on Codex `spawn_agent` offers no `agent_type: relay-<role>`, `hooks/codex-spawn.mjs` never sees a role, and per-role routing never happens (Evidence, probes 1–2). The native plugin manifest (`.codex-plugin/plugin.json`) has no field that registers agents; `relay setup codex` stays the way to get roles, with or without `--plugin`.

`scripts/build.mjs`: new exported `codexAgentRegistrations(roles)`, written by `outputs` to `codex/agents.snippet.toml`:

```js
export function codexAgentRegistrations(roles) {
  const lines = [
    '# generated by scripts/build.mjs from roles/*.md; `relay setup codex <project>` appends the missing tables to <project>/.codex/config.toml with __RELAY_AGENTS_DIR__ resolved to the absolute <project>/.codex/agents',
    '# Codex offers a custom agent as spawn_agent agent_type only when it is registered here (observed, Codex 0.163.0).',
  ];
  for (const role of roles) {
    lines.push('', `[agents.relay-${role.name}]`, `description = ${JSON.stringify(role.description)}`, `config_file = "__RELAY_AGENTS_DIR__/relay-${role.name}.toml"`);
  }
  return lines.join('\n') + '\n';
}
```

`scripts/relay-setup.mjs` `setupCodex`, after the agent TOMLs are copied:
- `const dirLiteral = JSON.stringify(agentsDir).slice(1, -1);` `const registrations = readFileSync(join(RELAY_ROOT, 'codex', 'agents.snippet.toml'), 'utf8').replaceAll('__RELAY_AGENTS_DIR__', dirLiteral);` Split it into one block per `[agents.relay-<role>]` table.
- A table counts as present when the existing config has a header line matching `^\s*\[\s*agents\s*\.\s*"?relay-<role>"?\s*\]` (multiline). Keep present ones untouched (print `! preserved [agents.relay-<role>] in <configFile>`).
- No config file: write the `[agents]` defaults snippet followed by all registration blocks (the defaults stay first).
- Existing config: keep its bytes as an exact prefix; append `\n` plus the missing blocks; still print the missing `[agents]` defaults for the user to merge as today (do not add a second `[agents]` table). If nothing is missing, do not touch the file.
- Before writing, run `configProblem` on the new text; if it reports a problem, write nothing and print the blocks for the user to merge.
- Print `✓ <n> roles registered in <configFile>`. Update the file header comment.

`scripts/relay-doctor.mjs` line ~27: replace `project agents: N (discovered on next Codex session)` with `project agents: N; registered in .codex/config.toml: M` where M counts relay-role table headers in the project config (0 when the file is missing). Keep the substring `agents: N`.

`scripts/relay-doctor.mjs`, also (user decision): read `~/.codex/config.toml` (`$CODEX_HOME/config.toml` when set). If it has no `[projects."<absolute project path>"]` table with `trust_level = "trusted"`, print `project trust: not trusted in <user config>; Codex ignores <project>/.codex/config.toml (role registrations and [agents] defaults) until you trust the project`. Otherwise print `project trust: trusted`. A missing or unreadable user config gives `project trust: unknown`. Doctor stays read-only and fails open. Add the behavior to T9's behaviors and the assertion to test 1: with `CODEX_HOME` pointed at a temp dir with no trust entry, doctor prints `not trusted`.

Tests in `test/package.test.mjs`:
1. New: after `setup codex <tempRepo>` (no config) and after `setup codex <tempRepo> --plugin`, `.codex/config.toml` has one `[agents.relay-<role>]` table per file in `roles/`, each `config_file` is an absolute path that exists and equals `<project>/.codex/agents/relay-<role>.toml`, and doctor prints `registered in .codex/config.toml: 10`.
2. Change `fallback setup is repeatable, preserves config…`: the original config must be an exact prefix of the result, the second run must leave the file byte-identical to the first run's result, and each relay table header appears exactly once. Keep the malformed-config tests as they are.

```relay-plan
{
  "slug": "codex-math-integration",
  "suite": "npm test && node --test codex-math/test/*.test.mjs && node bin/relay build --check",
  "tasks": [
    {"id": "T1", "title": "Build reads and checks the Codex routing source", "tier": "mid", "code": "prose", "risk": "medium", "files": ["scripts/build.mjs", "test/build.test.mjs", "codex/config.snippet.toml"], "deps": [], "behaviors": ["build --check fails when codex-routing roles disagree with roles/*.md or a tier's effort is not advertised", "the [agents] default snippet is generated from codex-routing.json"], "tests": 1, "done": "node --test test/build.test.mjs && node bin/relay build --check"},
    {"id": "T2", "title": "Codex budget level and spawn hook use the Codex stop lines", "tier": "mid", "code": "prose", "risk": "high", "files": ["lib/budget.mjs", "scripts/relay-budget.mjs", "hooks/codex-spawn.mjs", "test/codex-budget.test.mjs"], "deps": [], "behaviors": ["a Codex window is judged by codex-routing lines: primary 60/85, secondary 80/95, any window of 7 days or more 80/95", "the spawn hook routes by codex-routing tiers and caps only, with unknown acting as tight", "the spawn hook still fails open"], "tests": 2, "done": "node --test test/codex-budget.test.mjs test/hook-reliability.test.mjs"},
    {"id": "T3", "title": "Codex forecast, lanes, calibration and marathon use only the Codex source, capped at 3 lanes", "tier": "mid", "code": "prose", "risk": "medium", "files": ["lib/codex-integration.mjs", "scripts/relay-lanes.mjs", "scripts/relay-calibrate.mjs", "scripts/relay-forecast.mjs", "scripts/relay-marathon.mjs", "test/codex-routing.test.mjs"], "deps": [], "behaviors": ["under Codex a wave holds at most 3 lanes; --max-lanes overrides", "the Codex forecast uses codex-routing T, R, kappa, p, priors and tiers unchanged", "calibration and marathon legs use the Codex partition and mid tier"], "tests": 3, "done": "node --test test/codex-routing.test.mjs test/lanes.test.mjs test/forecast.test.mjs test/marathon.test.mjs"},
    {"id": "T4", "title": "Source label on every Codex number, checked by build", "tier": "cheap", "code": "complete", "risk": "low", "files": ["codex-math/config/codex-routing.json", "scripts/build.mjs", "test/build.test.mjs"], "deps": ["T1"], "behaviors": ["build --check fails when a number in codex-routing.json has no prior/measured/documented/observed/decompiled/policy label"], "tests": 1, "done": "node --test test/build.test.mjs && node bin/relay build --check && node --test codex-math/test/*.test.mjs"},
    {"id": "T5", "title": "config/routing.json becomes Claude-only", "tier": "cheap", "code": "complete", "risk": "low", "files": ["config/routing.json"], "deps": ["T1", "T2", "T3"], "behaviors": [], "tests": 0, "done": "node bin/relay build --check && node --test test/build.test.mjs test/codex-budget.test.mjs test/codex-routing.test.mjs test/marathon.test.mjs"},
    {"id": "T9", "title": "Register relay's roles in the Codex project config", "tier": "mid", "code": "prose", "risk": "medium", "files": ["scripts/build.mjs", "codex/agents.snippet.toml", "scripts/relay-setup.mjs", "scripts/relay-doctor.mjs", "test/package.test.mjs"], "deps": ["T4"], "behaviors": ["setup codex registers every relay role in .codex/config.toml with an existing absolute config_file", "setup on an existing config appends only missing role tables, keeps the old bytes as a prefix and is idempotent", "doctor reports how many roles are registered", "doctor warns when the project is not trusted in the user Codex config"], "tests": 2, "done": "node --test test/package.test.mjs && node bin/relay build --check"},
    {"id": "T6", "title": "codex-math doc corrections (labels and prose only)", "tier": "mid", "code": "prose", "risk": "low", "files": ["codex-math/docs/whitepaper/whitepaper.tex", "codex-math/docs/whitepaper/relay-codex-whitepaper.pdf", "codex-math/harness/FINDINGS.md", "codex-math/lib/budget.mjs", "codex-math/README.md", "codex-math/test/whitepaper.test.mjs"], "deps": [], "behaviors": [], "tests": 0, "done": "node --test codex-math/test/*.test.mjs"},
    {"id": "T7", "title": "Agent-facing Codex instructions (skills and host reference)", "tier": "mid", "code": "prose", "risk": "medium", "files": ["skills/using-relay/references/codex.md", "skills/run-lanes/SKILL.md", "skills/using-relay/SKILL.md", "skills/relay-setup/SKILL.md"], "deps": ["T1", "T2", "T3", "T9"], "behaviors": ["Codex agents are told the routing source, that TOMLs carry no model, role registration, the per-window stop lines and the three-agent limit with close-and-review rules"], "tests": 0, "done": "node bin/relay build --check"},
    {"id": "T8", "title": "Human docs describe the new Codex routing and budget", "tier": "mid", "code": "prose", "risk": "low", "files": ["AGENTS.md", "CONTRIBUTING.md", "README.md", "docs/configuration/README.md", "docs/guides/development.md", "docs/architecture/overview.md"], "deps": ["T4", "T5", "T9"], "behaviors": [], "tests": 0, "done": "node bin/relay build --check"}
  ]
}
```
