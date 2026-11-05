// relay calibrate <plan.md> [--show]
// Reads the stamped ledger of a run and adds one sample per merged wave to
// ~/.relay/calibration.json, so `relay forecast` can use your account's real
// rates instead of placeholders. `--show` prints the current calibration only.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from '../lib/args.mjs';
import { calibrationPath, readCalibration, summarize, waveSamples, writeCalibration } from '../lib/calibration.mjs';
import { resolveHarness } from '../lib/harness.mjs';
import { codexWaveSamples, summarizeCodex } from '../lib/codex-integration.mjs';
import { readBudget } from './relay-budget.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { ledgerPath } from './relay-ledger.mjs';
import { planLanes } from './relay-lanes.mjs';

export function describeCalibration(cal) {
  const s = summarize(cal);
  const old = s.ignored ? ` (${s.ignored} sample(s) from an older relay ignored: they used other units)` : '';
  if (!s.n) return `uncalibrated: no samples yet (run a plan, then \`relay calibrate <plan>\`)${old}`;
  const pct = s.pctPerUnit === undefined ? 'no usage readings yet, usage stays a placeholder' : `${s.pctPerUnit.toFixed(2)}% of the 5h window per unit from ${s.n5h} wave(s)` + (s.pct7dPerUnit === undefined ? '' : `, ${s.pct7dPerUnit.toFixed(3)}% of the week per unit`);
  return `calibrated from ${s.n} wave(s) across ${s.runs} run(s): ${pct}; ${s.minutesPerUnit.toFixed(1)} min per unit of critical path (last ${s.lastAt?.slice(0, 10)})${old}`;
}

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['show', 'codex'] });
  const harness = resolveHarness({ harness: args.harness, codex: args.codex });
  const calPath = calibrationPath(harness);
  const describe = cal => {
    if (harness !== 'codex') return describeCalibration(cal);
    const summary = summarizeCodex(cal);
    const windows = Object.entries(summary.nUsage).map(([id, count]) => `${id}: ${count} usage sample(s)`).join(', ');
    return `Codex calibration: ${summary.n} sample(s), ${summary.nTime ?? 0} timed wave(s)` +
      (windows ? `; ${windows}; measured usage with credit and tier mix priors` : '; usage remains a prior');
  };
  const planPath = args._[0];
  if (args.show || !planPath) {
    if (!planPath && !args.show) console.error('usage: relay calibrate <plan.md> | relay calibrate --show');
    console.log(describe(readCalibration(calPath)));
    console.log(`file: ${calPath}`);
    return planPath || args.show ? 0 : 64;
  }
  const res = planLanes(planPath);
  if (res.errors.length) {
    for (const e of res.errors) console.error(`✗ ${e}`);
    return 1;
  }
  const path = ledgerPath(planPath);
  if (!existsSync(path)) {
    console.error('✗ no ledger for this plan yet');
    return 1;
  }
  const taskById = Object.fromEntries(res.plan.tasks.map((t) => [t.id, t]));
  const routing = loadRouting();
  const text = readFileSync(path, 'utf8');
  const { samples, skipped } = harness === 'codex'
    ? codexWaveSamples(text, res.lanes, res.plan.slug, taskById, readBudget({ harness }).snapshot)
    : waveSamples(text, res.lanes, res.plan.slug, routing.forecast, taskById, routing.lanes.maxParallelLanes);
  const cal = readCalibration(calPath);
  const sampleKey = sample => [sample.slug, sample.wave, sample.kind ?? 'claude', sample.window ?? '', sample.at].join('#');
  const existing = new Set(cal.samples.map(sampleKey));
  const fresh = samples.filter(sample => !existing.has(sampleKey(sample)));
  cal.samples.push(...fresh);
  writeCalibration(cal, calPath);
  for (const w of skipped) console.log(`! ${w}`);
  console.log(`${fresh.length} new sample(s) from ${new Set(samples.map(sample => sample.wave)).size} merged wave(s)`);
  console.log(describe(cal));
  return 0;
}
