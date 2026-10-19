// relay forecast <plan.md> [--json] [--max-lanes N] [--max-lane-tasks N]
// What a run of this plan will spawn, how many worktrees it needs, how much of
// the usage windows it will take and how long it will run, waits included.

import { parseArgs } from '../lib/args.mjs';
import { isStale, readSnapshot } from '../lib/budget.mjs';
import { readCalibration } from '../lib/calibration.mjs';
import { forecast, formatForecast } from '../lib/forecast.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { planLanes } from './relay-lanes.mjs';

export function forecastPlan(planPath, opts = {}) {
  const res = planLanes(planPath, opts);
  if (res.errors.length) return { errors: res.errors };
  const routing = loadRouting();
  const snap = readSnapshot();
  const budget = snap && !isStale(snap, routing.budget.staleAfterMinutes) ? snap : undefined;
  return { errors: [], warnings: res.warnings, forecast: forecast({ plan: res.plan, lanes: res.lanes, routing, calibration: readCalibration(), budget }) };
}

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['json'] });
  const planPath = args._[0];
  if (!planPath) {
    console.error('usage: relay forecast <plan.md> [--json]');
    return 64;
  }
  const res = forecastPlan(planPath, { maxLanes: args['max-lanes'], maxLaneTasks: args['max-lane-tasks'] });
  if (res.errors.length) {
    for (const e of res.errors) console.error(`✗ ${e}`);
    return 1;
  }
  if (args.json) console.log(JSON.stringify(res.forecast, null, 2));
  else console.log(formatForecast(res.forecast));
  return 0;
}
