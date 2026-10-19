// relay calibrate <plan.md> [--show]
// Reads the stamped ledger of a run and adds one sample per merged wave to
// ~/.relay/calibration.json, so `relay forecast` can use your account's real
// rates instead of placeholders. `--show` prints the current calibration only.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from '../lib/args.mjs';
import { calibrationPath, readCalibration, summarize, waveSamples, writeCalibration } from '../lib/calibration.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { ledgerPath } from './relay-ledger.mjs';
import { planLanes } from './relay-lanes.mjs';

export function describeCalibration(cal) {
  const s = summarize(cal);
  if (!s.n) return 'uncalibrated: no samples yet (run a plan, then `relay calibrate <plan>`)';
  const pct = s.pctPerUnit === undefined ? 'no usage samples' : `${s.pctPerUnit.toFixed(2)}% of the 5h window per unit` + (s.pct7dPerUnit === undefined ? '' : `, ${s.pct7dPerUnit.toFixed(3)}% of the week per unit`);
  return `calibrated from ${s.n} wave(s) across ${s.runs} run(s): ${pct}, ${s.minutesPerUnit.toFixed(1)} min per critical-path unit (last ${s.lastAt?.slice(0, 10)})`;
}

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['show'] });
  const planPath = args._[0];
  if (args.show || !planPath) {
    if (!planPath && !args.show) console.error('usage: relay calibrate <plan.md> | relay calibrate --show');
    console.log(describeCalibration(readCalibration()));
    console.log(`file: ${calibrationPath()}`);
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
  const { samples, skipped } = waveSamples(readFileSync(path, 'utf8'), res.lanes, res.plan.slug, routing.forecast, taskById, routing.lanes.maxParallelLanes);
  const cal = readCalibration();
  const existing = new Set(cal.samples.map((x) => `${x.slug}#${x.wave}#${x.at}`));
  const fresh = samples.filter((x) => !existing.has(`${x.slug}#${x.wave}#${x.at}`));
  cal.samples.push(...fresh);
  writeCalibration(cal);
  for (const w of skipped) console.log(`! ${w}`);
  console.log(`${fresh.length} new sample(s) from ${samples.length} merged wave(s)`);
  console.log(describeCalibration(cal));
  return 0;
}
