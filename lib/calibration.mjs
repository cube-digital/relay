// Calibration: how much of the 5-hour window and how many minutes one unit of
// expected plan work costs on this account, learned from stamped ledger lines.
//
// A task weighs tierWeight[tier] × riskFactor[risk] (config/routing.json → forecast).
// A lane's expected weight adds one fix round with probability p (set by its
// riskiest task) that re-works fixRoundCost of the lane, and the lane's pieces
// (flow steps, each weighing its role's tierWeight) add once: W̃ = W·(1 + κ·p) + pieces.
// Each merged wave gives one sample: the usage delta between the wave's start
// stamp and its merge stamp over the wave's Σ W̃ (usage), and the elapsed time over
// its makespan in W̃ (time). Reviews, tests and orchestration are inside the
// measured deltas, so they are part of the learned rates. A wave during which the
// 5-hour window reset is dropped whole, never guessed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { relayHome } from './budget.mjs';

export const MAX_SAMPLES = 200;
// Samples are rates per unit of expected lane weight; version 1 used raw weights.
export const SAMPLE_VERSION = 2;

export function calibrationPath() {
  return join(relayHome(), 'calibration.json');
}

export function readCalibration(path = calibrationPath()) {
  if (!existsSync(path)) return { samples: [] };
  try {
    const c = JSON.parse(readFileSync(path, 'utf8'));
    return { samples: Array.isArray(c.samples) ? c.samples : [] };
  } catch {
    return { samples: [] };
  }
}

export function writeCalibration(cal, path = calibrationPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const samples = cal.samples.slice(-MAX_SAMPLES);
  writeFileSync(path, JSON.stringify({ samples, summary: summarize({ samples }) }, null, 2) + '\n');
}

// Ratio estimators: usage rate = ΣΔU / ΣW̃ over waves with 5h readings; time rate
// = ΣΔt / Σ makespan. Written as weighted means of the per-wave rates.
export function summarize(cal) {
  const all = cal.samples ?? [];
  const s = all.filter((x) => x.v === SAMPLE_VERSION && x.weight > 0 && x.wall > 0);
  const ignored = all.length - s.length;
  if (!s.length) return { n: 0, ignored };
  const weightedMean = (rows, key, by) => {
    const w = rows.reduce((a, x) => a + x[by], 0);
    return w ? rows.reduce((a, x) => a + x[key] * x[by], 0) / w : undefined;
  };
  const range = (rows, key) => (rows.length >= 3 ? [Math.min(...rows.map((x) => x[key])), Math.max(...rows.map((x) => x[key]))] : undefined);
  const with5 = s.filter((x) => typeof x.pct5h === 'number');
  const with7 = s.filter((x) => typeof x.pct7d === 'number');
  return {
    n: s.length,
    n5h: with5.length,
    ignored,
    runs: new Set(s.map((x) => x.slug)).size,
    pctPerUnit: with5.length ? weightedMean(with5, 'pct5h', 'weight') : undefined,
    pctRange: range(with5, 'pct5h'),
    pct7dPerUnit: with7.length ? weightedMean(with7, 'pct7d', 'weight') : undefined,
    minutesPerUnit: weightedMean(s, 'minutes', 'wall'),
    minutesRange: range(s, 'minutes'),
    lastAt: s.at(-1)?.at,
  };
}

// Wall-clock length of a wave in weight units: lanes run in parallel on at most
// `parallel` slots, heaviest first, each on the slot that frees up first.
export function makespan(laneWeights, parallel = Infinity) {
  if (!laneWeights.length) return 0;
  const slots = new Array(Math.max(1, Math.min(parallel, laneWeights.length))).fill(0);
  for (const w of [...laneWeights].sort((a, b) => b - a)) {
    const i = slots.indexOf(Math.min(...slots));
    slots[i] += w;
  }
  return Math.max(...slots);
}

export function taskWeight(task, forecastCfg) {
  const tier = forecastCfg.tierWeight[task.tier] ?? forecastCfg.tierWeight.mid;
  const risk = forecastCfg.riskFactor[task.risk] ?? 1;
  return tier * risk;
}

// One lane in the model: its work, the chance it needs a fix round, its expected weight.
export function laneModel(lane, taskById, forecastCfg) {
  const tasks = lane.tasks.map((id) => taskById[id]);
  const base = tasks.reduce((a, t) => a + taskWeight(t, forecastCfg), 0);
  const p = Math.max(...tasks.map((t) => forecastCfg.fixRoundProbability[t.risk] ?? 0.5));
  const kappa = forecastCfg.fixRoundCost ?? 0.35;
  const pieces = (lane.pieces ?? []).reduce((a, x) => a + (forecastCfg.tierWeight[x.tier] ?? forecastCfg.tierWeight.mid), 0);
  return { id: lane.id, base, p, pieces, weight: base * (1 + kappa * p) + pieces };
}

const HHMM = /resets (\d{2}):(\d{2})/;

// Parse one ledger line: "- 2026-10-19 14:02 [5h 23.4% resets 16:30 · 7d 41%] wave 1: merged @ abc, suite pass"
// Times are UTC. The reset is the first such moment at or after the line's own time.
export function parseLedgerLine(line) {
  const m = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?: \[([^\]]*)\])? (.*)$/.exec(line);
  if (!m) return undefined;
  const at = Date.parse(m[1].replace(' ', 'T') + ':00Z');
  const stamp = m[2] ?? '';
  const five = /5h ([\d.]+)%/.exec(stamp);
  const seven = /7d ([\d.]+)%/.exec(stamp);
  const reset = HHMM.exec(stamp.split('·')[0]);
  let fiveHourReset;
  if (reset) {
    const d = new Date(at);
    fiveHourReset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(reset[1]), Number(reset[2]));
    if (fiveHourReset < at) fiveHourReset += 86_400_000;
  }
  return {
    at,
    fiveHour: five ? Number(five[1]) : undefined,
    fiveHourReset,
    sevenDay: seven ? Number(seven[1]) : undefined,
    text: m[3].trim(),
  };
}

// Wave samples from a ledger: for wave N, from the "start" line (wave 1) or the
// previous wave's last merge line, to wave N's last "merged" line (a wave merged
// again after a red suite counts once). Both ends must carry a 5h reading: without
// one a reset inside the wave could not be detected, so the wave is skipped.
export function waveSamples(ledgerText, lanes, slug, forecastCfg, taskById, maxParallel = Infinity) {
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
  const num = (x) => typeof x === 'number';
  for (const [n, m] of [...lastMerge.entries()].sort((a, b) => a[0] - b[0])) {
    const wave = lanes.waves[n - 1];
    const prev = n === 1 ? start : lastMerge.get(n - 1);
    if (!wave || !prev) continue;
    if (!num(prev.fiveHour) || !num(m.fiveHour)) {
      skipped.push(`wave ${n}: no fresh 5h reading at its start or merge; skipped`);
      continue;
    }
    const models = wave.lanes.map((l) => laneModel(l, taskById, forecastCfg));
    const weight = models.reduce((a, l) => a + l.weight, 0);
    const wall = makespan(models.map((l) => l.weight), maxParallel);
    // a reset inside the wave restarts the 5h reading and means the run waited: drop the wave
    const crossed = (prev.fiveHourReset !== undefined && m.at >= prev.fiveHourReset) || (num(prev.fiveHour) && num(m.fiveHour) && m.fiveHour < prev.fiveHour);
    if (crossed) {
      skipped.push(`wave ${n}: the 5h window reset during the wave; sample dropped`);
      continue;
    }
    const minutes = Math.max(0, (m.at - prev.at) / 60_000);
    const pct5h = (m.fiveHour - prev.fiveHour) / weight;
    let pct7d;
    if (num(prev.sevenDay) && num(m.sevenDay)) {
      if (m.sevenDay >= prev.sevenDay) pct7d = (m.sevenDay - prev.sevenDay) / weight;
      else skipped.push(`wave ${n}: the weekly window reset during the wave; weekly sample dropped`);
    }
    samples.push({ v: SAMPLE_VERSION, slug, wave: n, weight, wall, minutes: minutes / wall, pct5h, pct7d, at: new Date(m.at).toISOString() });
  }
  return { samples, skipped };
}
