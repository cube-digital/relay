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
  const withPct = s.filter((x) => typeof x.pct5h === 'number');
  return {
    n: s.length,
    runs: new Set(s.map((x) => x.slug)).size,
    pctPerUnit: withPct.length ? weightedMean(withPct, 'pct5h') : undefined,
    minutesPerUnit: weightedMean(s, 'minutes'),
    lastAt: s.at(-1)?.at,
  };
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
export function waveSamples(ledgerText, lanes, slug, forecastCfg, taskById) {
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
    const weight = wave.lanes.flatMap((l) => l.tasks).reduce((a, id) => a + taskWeight(taskById[id], forecastCfg), 0);
    const minutes = Math.max(0, (m.at - prev.at) / 60_000);
    let pct5h;
    if (typeof prev.fiveHour === 'number' && typeof m.fiveHour === 'number') {
      const delta = m.fiveHour - prev.fiveHour;
      if (delta >= 0) pct5h = delta / weight;
      else skipped.push(`wave ${n}: the 5h window reset mid-wave (${prev.fiveHour}% → ${m.fiveHour}%); usage sample dropped`);
    }
    samples.push({ slug, wave: n, weight, minutes: minutes / weight, pct5h, at: new Date(m.at).toISOString() });
    prev = m;
  }
  return { samples, skipped };
}
