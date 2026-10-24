// Calibration on the Codex harness: two layers, learned separately.
//
//   1. credits per work unit on each tier, ĉ_τ, from threads attributed to lanes (every Codex
//      subagent is its own thread, with a model, a reasoning effort and a token total in
//      $CODEX_HOME/state_5.sqlite; account/usage/read gives the backend's credit estimate per
//      thread); with only wave totals, a non-negative least squares over the tiers;
//   2. credits per window, Q̂_j, from pairs of usage readings (used_percent of window j) and the
//      credits spent between them — a ratio estimator that never touches the plan priors.
//
// Time stays as in relay: m̂ = Σ wall minutes / Σ makespan in expected units.
//
// A ledger line on Codex is stamped "[primary 23.4% resets 2026-10-26T16:30:00.000Z · secondary 41% · credits 123.4]"
// (relay's "5h"/"7d" labels are read as primary/secondary). A wave whose window reset between
// its two stamps is dropped, never guessed.

import { TIERS } from './harness.mjs';
import { creditsForTokens } from './pricing.mjs';
import { makespan } from './walk.mjs';

export const SAMPLE_VERSION = 'codex-1';
export const MAX_SAMPLES = 400;

// ---- stamps and ledger lines

export function formatStamp(snapshot, credits) {
  if (!snapshot?.windows?.length && credits === undefined) return '';
  const parts = [];
  for (const w of snapshot?.windows ?? []) {
    const reset = Date.parse(w.resetsAt ?? '');
    parts.push(`${w.id} ${w.usedPercent}%` + (Number.isFinite(reset) ? ` resets ${new Date(reset).toISOString()}` : ''));
  }
  if (typeof credits === 'number') parts.push(`credits ${Math.round(credits * 100) / 100}`);
  return parts.length ? ` [${parts.join(' · ')}]` : '';
}

const LABELS = { '5h': 'primary', '7d': 'secondary', primary: 'primary', secondary: 'secondary' };

// "- 2026-10-19 14:02 [primary 23.4% resets 2026-10-26T16:30:00.000Z · secondary 41% · credits 12.5] wave 1: merged @ abc"
export function parseLedgerLine(line) {
  const m = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?: \[([^\]]*)\])? (.*)$/.exec(line);
  if (!m) return undefined;
  const at = Date.parse(m[1].replace(' ', 'T') + ':00Z');
  const windows = {};
  let credits;
  for (const part of (m[2] ?? '').split('·')) {
    const w = /^\s*(5h|7d|primary|secondary) ([\d.]+)%(?: resets (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z|\d{2}:\d{2}))?/.exec(part);
    if (w) {
      let resetsAt;
      if (w[3]?.includes('T')) {
        const absolute = Date.parse(w[3]);
        if (Number.isFinite(absolute)) resetsAt = absolute;
      } else if (w[3]) {
        // Legacy stamps carry only the clock. Preserve their next-occurrence
        // interpretation; new stamps retain the actual weekly reset date.
        const d = new Date(at);
        const [hour, minute] = w[3].split(':').map(Number);
        resetsAt = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute);
        if (resetsAt < at) resetsAt += 86_400_000;
      }
      windows[LABELS[w[1]]] = { usedPercent: Number(w[2]), resetsAt };
      continue;
    }
    const c = /^\s*credits ([\d.]+)/.exec(part);
    if (c) credits = Number(c[1]);
  }
  return { at, windows, credits, text: m[3].trim() };
}

// ---- samples

const resetMs = (resetsAt) => (typeof resetsAt === 'number' ? resetsAt : typeof resetsAt === 'string' ? Date.parse(resetsAt) : NaN);

// A reading's percent can sit below the window's high-water mark without a reset: readings of
// concurrent threads interleave, each carrying the snapshot its own last response returned, so a
// pooled timeline shows 5 → 4 → 5. A drop of at most this many points with no reset evidence is
// a stale snapshot, not a reset. A reset time that moves by more than RESET_SHIFT_MS while the
// window was in use is a reset (an unused window's reset time slides with the clock by seconds).
const STALE_DROP_POINTS = 2;
const RESET_SHIFT_MS = 10 * 60_000;

// Consecutive readings → capacity samples per window. A window's used_percent is an integer in
// the app-server schema, so an interval that spent credits without moving the percent is not
// dropped: its credits are carried into the next interval of that window until the percent moves,
// which keeps Σ dC / Σ dU unbiased. The percent is read against the window's high-water mark, so
// stale interleaved readings neither count twice nor pass for a reset. A window that reset in
// between drops what was carried.
// readings: [{ at (ms), windows: { primary: { usedPercent, resetsAt? (ms or ISO) }, ... }, credits }]
export function capacitySamples(readings, { slug, label } = {}) {
  const rows = [...readings].filter((r) => typeof r.credits === 'number').sort((a, b) => a.at - b.at);
  const samples = [];
  const skipped = [];
  const state = {}; // window id → { hw (high-water used %), resetsAt (ms), dC carried }
  const track = (id, w) => {
    const s = state[id];
    if (!s) return;
    if (typeof w.usedPercent === 'number' && w.usedPercent > s.hw) s.hw = w.usedPercent;
    const r = resetMs(w.resetsAt);
    if (Number.isFinite(r)) s.resetsAt = r;
  };
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const dC = b.credits - a.credits;
    const name = label ?? `interval ${i}`;
    if (!(dC >= 0)) {
      skipped.push(`${name}: credits went backwards between the readings; skipped`);
      continue;
    }
    for (const id of Object.keys(b.windows ?? {})) {
      const wa = a.windows?.[id];
      const wb = b.windows[id];
      if (typeof wb.usedPercent !== 'number') continue;
      if (!state[id]) {
        if (!wa || typeof wa.usedPercent !== 'number') continue;
        state[id] = { hw: wa.usedPercent, resetsAt: resetMs(wa.resetsAt), dC: 0 };
      } else if (wa) track(id, wa);
      const s = state[id];
      const nextReset = resetMs(wb.resetsAt);
      const timePassed = Number.isFinite(s.resetsAt) && b.at >= s.resetsAt;
      const timeMoved = Number.isFinite(s.resetsAt) && Number.isFinite(nextReset) && Math.abs(nextReset - s.resetsAt) > RESET_SHIFT_MS && s.hw > 0;
      const dropped = !Number.isFinite(s.resetsAt) && wb.usedPercent < s.hw - STALE_DROP_POINTS;
      if (timePassed || timeMoved || dropped) {
        skipped.push(`${name}: the ${id} window reset in between; sample dropped`);
        state[id] = { hw: wb.usedPercent, resetsAt: nextReset, dC: 0 };
        continue;
      }
      s.dC += dC;
      const dU = wb.usedPercent - s.hw;
      if (dU <= 0) {
        if (dC > 0) skipped.push(`${name}: the ${id} window did not move; ${Math.round(dC * 100) / 100} credits carried to the next reading`);
        if (Number.isFinite(nextReset)) s.resetsAt = nextReset;
        continue;
      }
      if (s.dC > 0) samples.push({ v: SAMPLE_VERSION, kind: 'capacity', slug, window: id, dU, dC: s.dC, at: new Date(b.at).toISOString() });
      s.dC = 0;
      s.hw = wb.usedPercent;
      if (Number.isFinite(nextReset)) s.resetsAt = nextReset;
    }
  }
  return { samples, skipped };
}

// The account's credit timeline from the token_count readings of every rollout on the machine
// (scripts/extract-readings.mjs): one row per reading with the account's cumulative credits at
// the published rates and the usage windows the reading carried. Credits are deltas of each
// thread's cumulative total_token_usage, summed over threads; a thread whose total falls (a
// forked or resumed rollout, a review stream logged under the same id) opens a new monotone
// stream rather than counting the drop. Readings of models without published rates are priced
// through `pricing.rateAliases` when the harness has one, else skipped and reported.
// readings: [{ at, threadId, model, rateLimits: { planType, primary: { used_percent, resets_at }, secondary }, total: { input_tokens, cached_input_tokens, output_tokens, total_tokens } }]
export function accountTimeline(readings, harness, { planType, metering = 'included' } = {}) {
  const rows = [...readings].filter((x) => x?.total && typeof x.total.total_tokens === 'number' && x.threadId).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const streams = new Map(); // threadId → [{ total_tokens, input_tokens, cached_input_tokens, output_tokens }]
  const unpriced = new Set();
  const planTypes = new Set();
  const windowMinutes = new Set();
  const out = [];
  let cumulative = 0;
  let threads = 0;
  for (const x of rows) {
    const t = x.total;
    const list = streams.get(x.threadId) ?? [];
    if (!streams.has(x.threadId)) {
      streams.set(x.threadId, list);
      threads += 1;
    }
    const candidates = list.filter((s) => s.total_tokens <= t.total_tokens);
    let s = candidates.length ? candidates.reduce((m, c) => (c.total_tokens > m.total_tokens ? c : m)) : undefined;
    if (!s) {
      s = { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
      list.push(s);
    }
    const delta = {
      model: x.model,
      inputTokens: Math.max(0, (t.input_tokens ?? 0) - s.input_tokens),
      cachedInputTokens: Math.max(0, (t.cached_input_tokens ?? 0) - s.cached_input_tokens),
      outputTokens: Math.max(0, (t.output_tokens ?? 0) - s.output_tokens),
    };
    s.total_tokens = t.total_tokens;
    s.input_tokens = t.input_tokens ?? s.input_tokens;
    s.cached_input_tokens = t.cached_input_tokens ?? s.cached_input_tokens;
    s.output_tokens = t.output_tokens ?? s.output_tokens;
    let credits = 0;
    try {
      credits = creditsForTokens(harness, delta, metering);
    } catch {
      unpriced.add(x.model);
    }
    cumulative += credits;
    const rl = x.rateLimits;
    if (!rl) continue;
    if (rl.planType) planTypes.add(rl.planType);
    if (planType && rl.planType !== planType) continue;
    const windows = {};
    for (const id of ['primary', 'secondary']) {
      const w = rl[id];
      if (w && typeof w.used_percent === 'number') {
        windows[id] = { usedPercent: w.used_percent, resetsAt: typeof w.resets_at === 'number' ? w.resets_at * 1000 : undefined };
        if (typeof w.window_minutes === 'number') windowMinutes.add(w.window_minutes);
      }
    }
    if (!Object.keys(windows).length) continue;
    out.push({ at: Date.parse(x.at), windows, credits: cumulative, threadId: x.threadId, model: x.model });
  }
  return { readings: out, threads, streams: [...streams.values()].reduce((a, l) => a + l.length, 0), unpricedModels: [...unpriced], planTypes: [...planTypes], windowMinutes: [...windowMinutes].sort((a, b) => a - b) };
}

// Threads attributed to a lane's tier → credits per unit on that tier.
// threads: [{ tier, units, credits?, usage?: { model, speed, inputTokens, cachedInputTokens, outputTokens }, model, effort, speed }]
export function tierSamples(threads, harness, { slug, wave, metering = 'included' } = {}) {
  const samples = [];
  for (const t of threads) {
    if (!TIERS.includes(t.tier) || !(t.units > 0)) continue;
    const credits = typeof t.credits === 'number' ? t.credits : t.usage ? creditsForTokens(harness, { model: t.model ?? t.usage.model, speed: t.speed ?? t.usage.speed ?? 'standard', ...t.usage }, metering) : undefined;
    if (!(credits >= 0)) continue;
    samples.push({ v: SAMPLE_VERSION, kind: 'tier', slug, wave, tier: t.tier, units: t.units, credits, model: t.model, effort: t.effort, speed: t.speed ?? 'standard', measured: typeof t.credits === 'number' ? 'backend' : 'tokens' });
  }
  return samples;
}

// Wave totals without per-thread attribution: one row per wave with units per tier and the
// credits spent; solved later by non-negative least squares.
export function waveSample(unitsByTier, credits, { slug, wave, wallMinutes, makespanUnits } = {}) {
  return { v: SAMPLE_VERSION, kind: 'wave', slug, wave, unitsByTier, credits, wallMinutes, makespanUnits };
}

// Ledger → wave samples: credits spent and time taken per merged wave, plus capacity samples
// from the stamps. `laneUnits` is lanes.waves with lane expected units (from forecast laneModels).
export function waveSamplesFromLedger(ledgerText, laneModelsByWave, { slug, maxParallel = Infinity } = {}) {
  const entries = ledgerText
    .split('\n')
    .map(parseLedgerLine)
    .filter(Boolean);
  const start = entries.find((e) => /^start:/.test(e.text));
  const lastMerge = new Map();
  for (const e of entries) {
    const mm = /^wave (\d+): merged/.exec(e.text);
    if (mm) lastMerge.set(Number(mm[1]), e);
  }
  const samples = [];
  const skipped = [];
  for (const [n, m] of [...lastMerge.entries()].sort((a, b) => a[0] - b[0])) {
    const wave = laneModelsByWave[n - 1];
    const prev = n === 1 ? start : lastMerge.get(n - 1);
    if (!wave || !prev) continue;
    if (typeof prev.credits !== 'number' || typeof m.credits !== 'number') {
      skipped.push(`wave ${n}: no credits reading at its start or merge; skipped`);
    } else {
      // expected units of a lane = units × (1 + κ p), the same W̃ the forecast uses, so fix rounds count once
      const fix = (l) => (l.credits > 0 ? l.expectedCredits / l.credits : 1);
      const unitsByTier = Object.fromEntries(TIERS.map((t) => [t, 0]));
      for (const l of wave.lanes) for (const t of TIERS) unitsByTier[t] += l.byTier[t].units * fix(l);
      const makespanUnits = makespan(
        wave.lanes.map((l) => l.units * fix(l)),
        maxParallel,
      );
      samples.push(waveSample(unitsByTier, m.credits - prev.credits, { slug, wave: n, wallMinutes: Math.max(0, (m.at - prev.at) / 60_000), makespanUnits }));
    }
    const cap = capacitySamples([{ at: prev.at, windows: prev.windows, credits: prev.credits }, { at: m.at, windows: m.windows, credits: m.credits }], { slug, label: `wave ${n}` });
    samples.push(...cap.samples);
    skipped.push(...cap.skipped);
  }
  return { samples, skipped };
}

// ---- estimators

// Non-negative least squares by projected coordinate descent: rows {x: [..], y}.
export function nnls(rows, k, iterations = 2000) {
  const c = new Array(k).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let j = 0; j < k; j++) {
      let num = 0;
      let den = 0;
      for (const r of rows) {
        const rest = r.y - r.x.reduce((a, v, i) => (i === j ? a : a + v * c[i]), 0);
        num += r.x[j] * rest;
        den += r.x[j] * r.x[j];
      }
      const next = den > 0 ? Math.max(0, num / den) : 0;
      moved += Math.abs(next - c[j]);
      c[j] = next;
    }
    if (moved < 1e-12) break;
  }
  return c;
}

// Rank of a small matrix (rows of numbers) by Gaussian elimination with a relative pivot tolerance.
export function matrixRank(rows) {
  const a = rows.map((r) => [...r]);
  const m = a.length;
  const n = m ? a[0].length : 0;
  const scale = Math.max(1e-300, ...a.flat().map(Math.abs));
  const tol = 1e-9 * scale;
  let rank = 0;
  for (let col = 0; col < n && rank < m; col++) {
    let pivot = rank;
    for (let r = rank + 1; r < m; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) <= tol) continue;
    [a[rank], a[pivot]] = [a[pivot], a[rank]];
    for (let r = rank + 1; r < m; r++) {
      const f = a[r][col] / a[rank][col];
      for (let c = col; c < n; c++) a[r][c] -= f * a[rank][c];
    }
    rank++;
  }
  return rank;
}

export function summarize(cal) {
  const all = cal?.samples ?? [];
  const s = all.filter((x) => x.v === SAMPLE_VERSION);
  const out = { n: s.length, ignored: all.length - s.length, runs: new Set(s.map((x) => x.slug).filter(Boolean)).size, planType: cal?.planType };
  // window capacity: Q̂_j = 100 ΣdC / ΣdU
  const cap = {};
  const capN = {};
  for (const x of s.filter((x) => x.kind === 'capacity')) {
    cap[x.window] = cap[x.window] ?? { dU: 0, dC: 0, rates: [] };
    cap[x.window].dU += x.dU;
    cap[x.window].dC += x.dC;
    cap[x.window].rates.push((100 * x.dC) / x.dU);
    capN[x.window] = (capN[x.window] ?? 0) + 1;
  }
  out.windowCapacityCredits = Object.fromEntries(Object.entries(cap).map(([k, v]) => [k, (100 * v.dC) / v.dU]));
  out.windowCapacityRange = Object.fromEntries(Object.entries(cap).map(([k, v]) => [k, v.rates.length >= 3 ? [Math.min(...v.rates), Math.max(...v.rates)] : undefined]));
  out.nCapacity = capN;
  // credits per unit per tier: direct ratio from attributed threads; else NNLS over waves
  const tier = s.filter((x) => x.kind === 'tier');
  const creditsPerUnit = {};
  const creditsPerUnitAt = {};
  const nTier = {};
  // A rate is measured at one (model, effort, speed): samples of a tier that ran at several
  // settings are grouped and the setting with the most units is the rate's basis; the forecast
  // rescales it for the tier's routed setting (pricing.mjs tierProfile).
  const leftOut = {};
  for (const t of TIERS) {
    const rows = tier.filter((x) => x.tier === t);
    if (!rows.length) continue;
    const groups = new Map();
    for (const x of rows) {
      const key = x.model ? `${x.model}|${x.effort ?? ''}|${x.speed ?? 'standard'}` : '';
      groups.set(key, [...(groups.get(key) ?? []), x]);
    }
    const [key, best] = [...groups.entries()].reduce((m, g) => (g[1].reduce((a, x) => a + x.units, 0) > m[1].reduce((a, x) => a + x.units, 0) ? g : m));
    const units = best.reduce((a, x) => a + x.units, 0);
    const credits = best.reduce((a, x) => a + x.credits, 0);
    if (units > 0) {
      creditsPerUnit[t] = credits / units;
      nTier[t] = best.length;
      if (key) {
        const [model, effort, speed] = key.split('|');
        creditsPerUnitAt[t] = { model, effort: effort || undefined, speed };
      }
      if (rows.length > best.length) leftOut[t] = rows.length - best.length;
    }
  }
  if (Object.keys(leftOut).length) out.tierSamplesAtOtherSettings = leftOut;
  // Wave totals identify the tiers only when the units-per-tier matrix has full column rank
  // (waves with different tier mixes); otherwise the fit would hand one tier the other's credits
  // or a zero, so the priors stay. A coefficient at zero for a tier that ran is rejected too.
  const waves = s.filter((x) => x.kind === 'wave' && typeof x.credits === 'number');
  if (waves.length >= 1 && Object.keys(creditsPerUnit).length < TIERS.length) {
    const present = TIERS.filter((t) => waves.some((w) => w.unitsByTier[t] > 0));
    const rows = waves.map((w) => ({ x: present.map((t) => w.unitsByTier[t]), y: w.credits }));
    const identified = waves.length >= present.length && matrixRank(rows.map((r) => r.x)) === present.length;
    out.nnlsWaves = waves.length;
    out.nnlsIdentified = identified;
    if (identified) {
      const fit = nnls(rows, present.length);
      present.forEach((t, i) => {
        if (creditsPerUnit[t] === undefined && fit[i] > 1e-9) {
          creditsPerUnit[t] = fit[i];
          nTier[t] = waves.length;
        }
      });
    }
  }
  out.creditsPerUnit = creditsPerUnit;
  out.creditsPerUnitAt = creditsPerUnitAt;
  out.nTier = nTier;
  // time: minutes per expected unit of makespan
  const timed = waves.filter((w) => w.wallMinutes > 0 && w.makespanUnits > 0);
  if (timed.length) {
    out.minutesPerUnit = timed.reduce((a, w) => a + w.wallMinutes, 0) / timed.reduce((a, w) => a + w.makespanUnits, 0);
    const rates = timed.map((w) => w.wallMinutes / w.makespanUnits);
    out.minutesRange = rates.length >= 3 ? [Math.min(...rates), Math.max(...rates)] : undefined;
    out.nTime = timed.length;
  }
  out.lastAt = s.at(-1)?.at;
  return out;
}

// The calibration object the forecast consumes, from a summary.
export function calibrationFromSummary(summary) {
  const cal = {};
  if (summary.windowCapacityCredits && Object.keys(summary.windowCapacityCredits).length) cal.windowCapacityCredits = summary.windowCapacityCredits;
  if (summary.creditsPerUnit && Object.keys(summary.creditsPerUnit).length) {
    cal.creditsPerUnit = summary.creditsPerUnit;
    cal.creditsPerUnitAt = summary.creditsPerUnitAt;
  }
  if (typeof summary.minutesPerUnit === 'number') cal.minutesPerUnit = summary.minutesPerUnit;
  if (summary.planType) cal.planType = summary.planType;
  return cal;
}

// ---- reading the harness's own stores

// Threads of a run from $CODEX_HOME/state_5.sqlite (node:sqlite, read-only). Each thread carries its
// model, effort and token total; thread_spawn_edges links subagents to their parent. `tierOf(row)`
// maps a thread to a relay tier (e.g. by agent_role or model), returning undefined to skip it.
export async function threadsFromStateDb(path, { since, cwd } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT t.id, t.model, t.reasoning_effort, t.tokens_used, t.agent_role, t.agent_nickname, t.agent_path, t.cwd, t.created_at_ms, t.updated_at_ms, t.rollout_path, e.parent_thread_id
         FROM threads t LEFT JOIN thread_spawn_edges e ON e.child_thread_id = t.id
         WHERE (? IS NULL OR t.created_at_ms >= ?) AND (? IS NULL OR t.cwd = ?)
         ORDER BY t.created_at_ms`,
      )
      .all(since ?? null, since ?? null, cwd ?? null, cwd ?? null);
    return rows.map((r) => ({ ...r }));
  } finally {
    db.close();
  }
}

// Per-thread token usage from a rollout file: the last token_count event's totals.
export function usageFromRolloutJsonl(text) {
  let last;
  let model;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type === 'turn_context' && row.payload?.model) model = row.payload.model;
    if (row.type === 'event_msg' && row.payload?.type === 'token_count' && row.payload.info?.total_token_usage) last = row.payload.info.total_token_usage;
    if (row.type === 'token_usage_record' && row.payload?.total_token_usage) last = row.payload.total_token_usage;
  }
  if (!last) return undefined;
  return {
    model,
    inputTokens: last.input_tokens ?? 0,
    cachedInputTokens: last.cached_input_tokens ?? 0,
    outputTokens: last.output_tokens ?? 0,
    reasoningOutputTokens: last.reasoning_output_tokens ?? 0,
    totalTokens: last.total_tokens ?? 0,
  };
}
