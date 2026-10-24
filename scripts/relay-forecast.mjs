// relay forecast <plan.md> [--json] [--max-lanes N] [--max-lane-tasks N]
// What a run of this plan will spawn, how many worktrees it needs, how much of
// the usage windows it will take and how long it will run, waits included.

import { parseArgs } from '../lib/args.mjs';
import { isStale, readSnapshot, snapshotPath } from '../lib/budget.mjs';
import { resolveHarness } from '../lib/harness.mjs';
import { codexRouting, loadHarness, summarizeCodex, calibrationFromSummary, labelCodexForecast } from '../lib/codex-integration.mjs';
import { forecast as codexForecast, formatForecast as formatCodexForecast } from '../codex-math/lib/forecast.mjs';
import { calibrationPath, readCalibration } from '../lib/calibration.mjs';
import { forecast, formatForecast } from '../lib/forecast.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { planLanes } from './relay-lanes.mjs';

export function forecastPlan(planPath, opts = {}) {
  const res = planLanes(planPath, opts);
  if (res.errors.length) return { errors: res.errors };
  const routing = loadRouting();
  const harness = resolveHarness(opts);
  const snap = readSnapshot(snapshotPath(harness));
  const budget = snap && !isStale(snap, routing.budget.staleAfterMinutes) ? snap : undefined;
  if (harness === 'codex') {
    const calibration = calibrationFromSummary(summarizeCodex(readCalibration(calibrationPath(harness))));
    const result = codexForecast({
      plan: res.plan, lanes: res.lanes, routing: codexRouting(), harness: loadHarness(),
      calibration, snapshot: budget,
    });
    return { errors: [], warnings: res.warnings, forecast: labelCodexForecast(result, calibration) };
  }
  return { errors: [], warnings: res.warnings, forecast: forecast({ plan: res.plan, lanes: res.lanes, routing, calibration: readCalibration(), budget }) };
}

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['json', 'codex'] });
  const planPath = args._[0];
  if (!planPath) {
    console.error('usage: relay forecast <plan.md> [--json]');
    return 64;
  }
  const res = forecastPlan(planPath, { harness:args.harness,codex:args.codex, maxLanes: args['max-lanes'], maxLaneTasks: args['max-lane-tasks'] });
  if (res.errors.length) {
    for (const e of res.errors) console.error(`✗ ${e}`);
    return 1;
  }
  if (args.json) console.log(JSON.stringify(res.forecast, null, 2));
  else {
    console.log(res.forecast.harness === 'codex' ? formatCodexForecast(res.forecast) : formatForecast(res.forecast));
    if (res.forecast.harness === 'codex' && res.forecast.usage.some(window => window.measuredUsage)) console.log('Usage scale learned from account percentages; credits and tier mix remain priors.');
  }
  return 0;
}
