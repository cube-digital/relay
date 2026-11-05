# Plan for a Claude Code agent: collect what the Codex model still needs

> **Executed on 2026-10-22** (Codex 0.146.0 → 0.163.0, plan `self_serve_business_prolite`): `../evidence/RESULTS.md`, `../evidence/live/`, `../evidence/decompile/`. What it changed in the model: `FINDINGS.md` §8–§9, `../config/codex-harness.json` (`pricing.includedMeterWeight`, `pricing.rateAliases`, `context.autoCompactTokenLimit`, `multiAgent.concurrencyDefault`, `rateLimits.capacityMeasured`), `../config/codex-routing.json` priors, and `scripts/calibrate-live.mjs`, which now pools readings over threads (`lib/calibration.mjs` `accountTimeline`). Re-running the plan on another account adds that plan's capacity.

You are running on Marius's machine, inside the `relay` repository, with Codex (`codex`), REA (`rea`), IDA and Node 22+ available. The folder `codex-math/` holds a usage model for the Codex harness built from the binary without a logged-in account. Three things are missing and only this machine can supply them: real usage readings from a ChatGPT-authenticated account, controlled runs that price one task on each model, and two constants that live in compiled code. Work through the phases below in order, write every result under `codex-math/evidence/`, and finish by writing `codex-math/evidence/RESULTS.md`. The results go to another agent that has no access to this machine, so leave nothing in the chat that is not also in a file.

Ground rules:

- Never copy `~/.codex/auth.json`, API keys, bearer tokens, e-mails or prompt text into the evidence. The scripts avoid them; if you write anything by hand, check it. Before finishing, run the redaction check in phase H.
- Phases B, C, E and G cost no usage. Phase D spends Codex usage on purpose; it is bounded by the matrix in D and must be skipped or cut short at the stop conditions given there. Never purchase credits or resets.
- Every command is run from the repository root unless a `cd` is shown. Use `set -o pipefail` in your shell.
- If a step fails, record the failure (command, stderr, your diagnosis) in `RESULTS.md` and continue with the next phase; do not improvise substitutes that change what is measured.
- Do not modify anything under `codex-math/lib`, `codex-math/config` or `codex-math/test`. If a script is broken, fix the script, note the fix in `RESULTS.md`, and keep the original behaviour.

## A. Environment (10 minutes, free)

Record each answer in `codex-math/evidence/live/environment.md`.

1. `codex --version`. The model was built from 0.163.0. If the installed version differs, note it: phases B–F still apply (record field names you see that differ from `harness/FINDINGS.md`), but phase G must use the 0.163.0 binary, fetched with `npm pack @openai/codex@0.163.0-linux-x64` (its `vendor/x86_64-unknown-linux-musl/bin/codex` must have SHA-256 `399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215`).
2. `codex doctor 2>&1 | sed -n '/Notes/,/Environment/p;/auth/p'`. Phases C–F need ChatGPT auth (`auth storage mode`/`auth` line says ChatGPT, not API key). With an API key only, do B and G, and say so.
3. `node --version` (22.13+ or 24 for `node:sqlite`), `rea --version`, whether IDA is installed (`ls ~/idapro* /opt/ida* 2>/dev/null; which ida ida64 idat idat64`), and whether `~/.idapro` holds a licensed or Free install (phase G).
4. `codex features list > codex-math/evidence/live/features.txt`.
5. `cat ~/.codex/config.toml | sed -E 's/(key|token|secret)[^=]*=.*/\1 = [redacted]/I' > codex-math/evidence/live/config.toml.redacted` (keep `[agents]`, `model`, `model_reasoning_effort`, `service_tier`, compaction keys; strip anything secret).

## B. Mine the existing sessions (5 minutes, free)

```bash
node codex-math/scripts/extract-readings.mjs --out codex-math/evidence/live
```

It writes `readings.json` (every `token_count` event with its `rate_limits`, no message text), `threads.json` (the `state_5.sqlite` thread rows: model, effort, `tokens_used`, agent role/path, spawn edges, goals) and `sessions.json`. Note in `RESULTS.md` the counts it prints, the plan types it found, and the distinct `window_minutes` values. If it finds zero readings with rate limits, say so and go on.

## C. Live account probe (5 minutes, free)

```bash
node codex-math/scripts/app-server-probe.mjs --out codex-math/evidence/live --label baseline
```

It starts `codex app-server --listen stdio://`, calls `account/read`, `account/rateLimits/read`, `account/usage/read`, `model/list`, `experimentalFeature/list`, `config/read`, and writes `probe-baseline.json` with ids and e-mails shortened. Copy the one-line summary it prints into `RESULTS.md`. Then pick the three most recent thread ids from `threads.json` and run the probe once more with `--threads id1,id2,id3 --label baseline-threads` so the per-thread credit estimates (`threadUsage` groups) are captured.

If `account/rateLimits/read` returns an authentication error, the account is not ChatGPT-authenticated: stop after this phase except for G.

## D. Controlled calibration runs (60–120 minutes; spends usage)

Purpose: price one fixed task on each model with the backend's own credit estimate, and move the usage windows by a known number of credits so `Q̂` (credits per window) can be computed.

Stop conditions, checked before every run with the probe output: do not start a run if the primary window's `usedPercent` is above 60 or the weekly/secondary above 70; skip the `astra` run entirely if the plan is `plus`/`team`/`business` and the weekly window is above 40, or at your own judgement if the account is shared. Never run more than the matrix below. Leave at least 60 seconds between runs.

Setup:

```bash
codex-math/scripts/make-scratch-repo.sh /tmp/relay-scratch
```

Each run resets the scratch repo afterwards, so every model starts from the same state. The runner reads limits before, runs `codex exec --json` on the model, waits 20 s, reads limits and the thread's credit estimate after, and writes `codex-math/evidence/live/runs/<label>/`. Run them in this order, one at a time:

```bash
S=codex-math/scripts/calibration-run.sh; P=codex-math/scripts/prompts; W=/tmp/relay-scratch
$S 01-luna-low-mid      gpt-6-luna  low    3 $W $P/mid-task.md
$S 02-luna-low-cheap    gpt-6-luna  low    1 $W $P/cheap-task.md
$S 03-sol61-medium-mid  gpt-6.1-sol medium 3 $W $P/mid-task.md
$S 04-luna-low-mid      gpt-6-luna  low    3 $W $P/mid-task.md
$S 05-sol61-medium-mid  gpt-6.1-sol medium 3 $W $P/mid-task.md
$S 06-sol61-high-mid    gpt-6.1-sol high   3 $W $P/mid-task.md
$S 07-sol61-medium-fast gpt-6.1-sol medium 3 $W $P/mid-task.md fast     # optional: only if the plan offers Fast
$S 08-astra-high-mid    gpt-6-astra high   3 $W $P/mid-task.md          # optional: see the stop conditions
```

A run that exits non-zero or whose `events.jsonl` has no `turn.completed` line is still evidence: keep its folder and note it. After the runs:

```bash
node codex-math/scripts/calibrate-live.mjs --live codex-math/evidence/live > codex-math/evidence/live/calibrate-live.out
```

Paste the printed summary into `RESULTS.md`. The lines "backend X credits vs published rates Y (ratio R)" are the check of the published rates against the backend; ratios far from 1 are a finding, not an error.

## E. Subagent concurrency limit (10 minutes; one cheap run)

With `[agents].max_concurrent_threads_per_session` unset in `~/.codex/config.toml` (if it is set, note the value and skip the run):

```bash
$S 09-spawn-limit gpt-6-luna low 0 $W $P/spawn-limit.md
```

Read `runs/09-spawn-limit/last-message.md` and `events.jsonl`: the number of successful spawns before the first error, the error text (look for `AgentLimitReached` or "max_threads"), and the `spawn_agent` items. Record them. Then `node codex-math/scripts/extract-readings.mjs --out codex-math/evidence/live` again so `threads.json` picks up the spawned threads and their `thread_spawn_edges`.

## F. Compaction threshold by observation (optional, 15 minutes; one run of moderate cost)

Only if phase G cannot be done. In a fresh scratch repo copy, run `gpt-6-luna`/`low` with the prompt "Read every file under /usr/share/dict (or the largest text files you can find on this system) with `cat`, one file per tool call, and keep going until you are told to stop; never summarize", with `CODEX_EXEC_TIMEOUT=600`, and watch `events.jsonl` for the first `thread/compacted` / `item.completed` of type compaction or the `error` that mentions the context window; the last `turn.completed` or `token_count` total before it is the threshold. Record the total tokens and the model context window. Stop the run as soon as a compaction is seen.

## G. Decompile the two defaults (1–3 hours of machine time)

Follow `codex-math/harness/DECOMPILE.md` exactly, with the 0.163.0 binary from phase A. Register IDA with REA (`REA_IDA_MCP_CONFIG`), let IDA finish auto-analysis of the binary (it is 297 MB; give it time and raise `timeoutMs`), then run the `rea search`/`rea xrefs`/`rea decompile` commands in sections 2 and 3 of that file, saving every output under `codex-math/evidence/decompile/`. For each of the two numbers, write in `RESULTS.md`: the function address, the decompiled expression, the constant, and your confidence. If REA's IDA provider cannot be made to work, run the same lookups in IDA directly (jump to the cited address, list xrefs, decompile the referencing function, export pseudocode to a file under `evidence/decompile/`) and say that REA was bypassed. If neither is feasible, record why and leave the numbers "not recovered".

## H. Hand-back

1. Redaction check, from the repository root; every command must print nothing:
   ```bash
   grep -rlE 'sk-[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}|"refresh_token"|"access_token"' codex-math/evidence/ || true
   grep -rlE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' codex-math/evidence/live codex-math/evidence/decompile 2>/dev/null | grep -v 'example.invalid' || true
   ```
   Fix anything that prints by shortening or removing the value, then re-run the check.
2. Write `codex-math/evidence/RESULTS.md` with: environment (A), counts from B, the probe summary line and plan type (C), the run table (label, model, effort, speed, units, exit status, wall seconds, backend credits, rated credits, tokens: input/cached/output, before→after `usedPercent` per window) and the `calibrate-live` summary (D), the spawn-limit result (E), the compaction observation if done (F), the two decompiled constants with addresses and confidence (G), and a list of every file you produced. Keep it factual; where a number is missing, say which step failed.
3. `node --test codex-math/test/*.test.mjs` must still pass (you changed nothing under `lib`, `config`, `test`). Report the pass count.
4. Tell Marius that `codex-math/evidence/` and `RESULTS.md` are ready to be handed over.

## What each result feeds

| Result | Replaces |
|---|---|
| `account/rateLimits/read` (C) | the assumed windows per plan; gives `planType`, `windowDurationMins`, `limitId`, reset credits |
| Runs D | credits per unit per tier (`creditsPerUnit`), tokens per unit and the token mix (`tokensPerUnit`, `tokenMix`), the published-rate check, and `Q̂` per window from the before/after readings |
| Readings B | extra `Q̂` samples from past sessions and the history of plan types and window durations |
| E | `agents.max_concurrent_threads_per_session` default |
| F or G | `model_auto_compact_token_limit` default; G also confirms E |
