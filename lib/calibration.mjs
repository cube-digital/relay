// Calibration: how much of the 5-hour window and how many minutes one "weight
// unit" of plan work costs on this account, learned from stamped ledger lines.
//
// A task's weight = tier weight × risk factor (config/routing.json → forecast).
// Each merged wave gives one sample: the usage delta between the wave's start
// stamp and its merge stamp, divided by the wave's weight. Samples whose delta
// is negative (a window reset mid-wave) are dropped, never guessed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { relayHome } from './budget.mjs';

export const MAX_SAMPLES = 200;

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

// Samples hold per-unit rates; the summary is their weight-weighted mean, so a
// big wave counts for more than a small one.
export function summarize(cal) {
  const s = cal.samples.filter((x) => x.weight > 0);
  if (!s.length) return { n: 0 };
  const weightedMean = (rows, key) => {
    const w = rows.reduce((a, x) => a + x.weight, 0);
    return w ? rows.reduce((a, x) => a + x[key] * x.weight, 0) / w : undefined;
  };
  const range = (rows, key) => (rows.length >= 3 ? [Math.min(...rows.map((x) => x[key])), Math.max(...rows.map((x) => x[key]))] : undefined);
  const with5 = s.filter((x) => typeof x.pct5h === 'number');
  const with7 = s.filter((x) => typeof x.pct7d === 'number');
  return {
    n: s.length,
    runs: new Set(s.map((x) => x.slug)).size,
    pctPerUnit: with5.length ? weightedMean(with5, 'pct5h') : undefined,
    pctRange: range(with5, 'pct5h'),
    pct7dPerUnit: with7.length ? weightedMean(with7, 'pct7d') : undefined,
    minutesPerUnit: weightedMean(s, 'minutes'),
    minutesRange: range(s, 'minutes'),
    lastAt: s.at(-1)?.at,
  };
}

// Wall-clock length of a wave in weight units: lanes run in parallel, so the wave
// lasts as long as its heaviest lane; beyond the parallel cap, lanes queue.
export function wallUnits(laneWeights, parallel = Infinity) {
  const sorted = [...laneWeights].sort((a, b) => b - a);
  const p = Math.max(1, Math.min(parallel, sorted.length));
  let units = 0;
  for (let i = 0; i < sorted.length; i += p) units += sorted[i];
  return units;
}

export function taskWeight(task, forecastCfg) {
  const tier = forecastCfg.tierWeight[task.tier] ?? forecastCfg.tierWeight.mid;
  const risk = forecastCfg.riskFactor[task.risk] ?? 1;
  return tier * risk;
}

// Parse one ledger line: "- 2026-10-19 14:02 [5h 23.4% · 7d 41%] wave 1: merged @ abc, suite pass"
export function parseLedgerLine(line) {
  const m = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?: \[([^\]]*)\])? (.*)$/.exec(line);
  if (!m) return undefined;
  const at = Date.parse(m[1].replace(' ', 'T') + ':00Z');
  const stamp = m[2] ?? '';
  const five = /5h ([\d.]+)%/.exec(stamp);
  const seven = /7d ([\d.]+)%/.exec(stamp);
  return {
    at,
    fiveHour: five ? Number(five[1]) : undefined,
    sevenDay: seven ? Number(seven[1]) : undefined,
    text: m[3].trim(),
  };
}

// Wave samples from a ledger: for wave N, from the "start" line (wave 1) or the
// previous wave's merge line, to "wave N: merged" line.
export function waveSamples(ledgerText, lanes, slug, forecastCfg, taskById, maxParallel = Infinity) {
  const entries = ledgerText
    .split('\n')
    .map(parseLedgerLine)
    .filter(Boolean);
  const start = entries.find((e) => /^start:/.test(e.text));
  const merges = entries.filter((e) => /^wave (\d+): merged/.test(e.text));
  const samples = [];
  const skipped = [];
  let prev = start;
  for (const m of merges) {
    const n = Number(/^wave (\d+)/.exec(m.text)[1]);
    const wave = lanes.waves[n - 1];
    if (!wave || !prev) {
      prev = m;
      continue;
    }
    const laneW = wave.lanes.map((l) => l.tasks.reduce((a, id) => a + taskWeight(taskById[id], forecastCfg), 0));
    const weight = laneW.reduce((a, b) => a + b, 0);
    const wall = wallUnits(laneW, maxParallel);
    const minutes = Math.max(0, (m.at - prev.at) / 60_000);
    const rate = (from, to, label) => {
      if (typeof from !== 'number' || typeof to !== 'number') return undefined;
      if (to - from >= 0) return (to - from) / weight;
      skipped.push(`wave ${n}: the ${label} window reset mid-wave (${from}% → ${to}%); ${label} sample dropped`);
      return undefined;
    };
    const pct5h = rate(prev.fiveHour, m.fiveHour, '5h');
    const pct7d = rate(prev.sevenDay, m.sevenDay, '7d');
    // usage scales with total work; time scales with the critical path (wall units)
    samples.push({ slug, wave: n, weight, wall, minutes: minutes / wall, pct5h, pct7d, at: new Date(m.at).toISOString() });
    prev = m;
  }
  return { samples, skipped };
}
