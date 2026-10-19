import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseLedgerLine, readCalibration, summarize, waveSamples } from '../lib/calibration.mjs';
import { forecast, formatForecast, simulate } from '../lib/forecast.mjs';
import { computeLanes } from '../lib/lanes.mjs';
import { parsePlan } from '../lib/plan.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { formatLine, usageStamp } from '../scripts/relay-ledger.mjs';
import { copyFixture, FIXTURES, runCli, tempRepo } from './helpers.mjs';

const routing = loadRouting();
const plan = parsePlan(readFileSync(join(FIXTURES, 'plan-basic.md'), 'utf8'));
const lanes = computeLanes(plan);

test('ledger lines carry a usage stamp when the reading is fresh, none when stale', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const fresh = { updatedAt: '2026-10-19T11:50:00Z', fiveHour: { percentUsed: 23.4 }, sevenDay: { percentUsed: 41 } };
  assert.equal(usageStamp(fresh, 360, now.getTime()), ' [5h 23.4% · 7d 41%]');
  assert.equal(usageStamp({ updatedAt: '2026-10-18T00:00:00Z', fiveHour: { percentUsed: 9 } }, 360, now.getTime()), '');
  assert.equal(formatLine('wave 1: merged', { now, snapshot: fresh }), '- 2026-10-19 12:00 [5h 23.4% · 7d 41%] wave 1: merged\n');
  assert.deepEqual(parseLedgerLine('- 2026-10-19 12:00 [5h 23.4% · 7d 41%] wave 1: merged @ abc'), {
    at: Date.parse('2026-10-19T12:00:00Z'),
    fiveHour: 23.4,
    sevenDay: 41,
    text: 'wave 1: merged @ abc',
  });
});

test('calibration takes one sample per merged wave and drops waves that crossed a reset', () => {
  const ledger = [
    '# relay ledger — plan: x',
    '- 2026-10-19 10:00 [5h 10% · 7d 5%] start: 6 tasks, 4 lanes, 2 waves',
    '- 2026-10-19 10:30 [5h 22% · 7d 6%] wave 1: merged @ aaa, suite pass',
    '- 2026-10-19 11:40 [5h 4% · 7d 8%] wave 2: merged @ bbb, suite pass',
  ].join('\n');
  const taskById = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
  const { samples, skipped } = waveSamples(ledger, lanes, plan.slug, routing.forecast, taskById);
  assert.equal(samples.length, 2);
  const w1 = samples[0];
  // wave 1 = T1 (cheap, low) + T2 (mid, medium) + T4 (cheap, low) + T5 (mid, medium) = 0.8 + 3 + 0.8 + 3 = 7.6 units
  assert.equal(Math.round(w1.weight * 10) / 10, 7.6);
  assert.equal(Math.round(w1.pct5h * 1000) / 1000, Math.round((12 / 7.6) * 1000) / 1000);
  assert.equal(Math.round(w1.minutes * 7.6), 30);
  assert.equal(samples[1].pct5h, undefined, 'negative delta is not a usage sample');
  assert.match(skipped[0], /wave 2: the 5h window reset/);
  const s = summarize({ samples });
  assert.equal(s.n, 2);
  assert.ok(s.pctPerUnit > 1.5 && s.pctPerUnit < 1.6);
});

test('simulate: usage beyond the stop line opens a new window and waits for the reset', () => {
  const waves = [
    { wave: 1, lanes: [{ id: 'a', weight: 50 }] },
    { wave: 2, lanes: [{ id: 'b', weight: 50 }] },
  ];
  const one = simulate({ waves, pctPerUnit: 0.5, minutesPerUnit: 1, critical: 85, windowHours: 5 });
  assert.equal(one.windows, 1);
  assert.equal(one.waitMinutes, 0);
  const two = simulate({ waves, pctPerUnit: 1.2, minutesPerUnit: 1, critical: 85, windowHours: 5 });
  assert.equal(two.windows, 2);
  assert.ok(two.waitMinutes > 0, 'the second wave waits for the first window to reset');
  assert.equal(two.totalMinutes, two.workMinutes + two.waitMinutes);
  const started = simulate({ waves, pctPerUnit: 0.5, minutesPerUnit: 1, critical: 85, windowHours: 5, startPct: 70 });
  assert.equal(started.windows, 2, 'a window already 70% used cannot take 50%');
});

test('forecast counts agents and worktrees from the plan and flags placeholder rates', () => {
  const f = forecast({ plan, lanes, routing, calibration: { samples: [] } });
  assert.equal(f.lanes, 4);
  assert.equal(f.waves, 2);
  assert.equal(f.agents.counts.reviewer, 4);
  assert.equal(f.agents.counts['test-author'], 3, 'lanes a, c and d budget tests at medium/high risk');
  assert.equal(f.agents.counts['implementer-deep'], 1);
  assert.equal(f.worktrees, 4, '3 parallel lanes + integration');
  assert.equal(f.calibrated, false);
  assert.match(formatForecast(f), /PLACEHOLDER rates/);
  const cal = { samples: [{ slug: 'x', wave: 1, weight: 10, pct5h: 2, minutes: 3, at: '2026-10-19T00:00:00Z' }] };
  const g = forecast({ plan, lanes, routing, calibration: cal, budget: { fiveHour: { percentUsed: 80 }, sevenDay: { percentUsed: 90 } } });
  assert.equal(g.calibrated, true);
  assert.equal(g.rates.pctPerUnit, 2);
  assert.ok(g.usage.windows >= 2, 'starting at 80% used forces a second window');
  assert.equal(g.usage.fitsWeekly, false);
  assert.match(formatForecast(g), /DOES NOT FIT/);
});

test('relay calibrate reads a run ledger and relay forecast uses it', () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-home-'));
  const { dir } = tempRepo();
  const planPath = copyFixture('plan-basic.md', dir);
  const runDirPath = join(dir, '.relay', 'runs', 'billing-export');
  mkdirSync(runDirPath, { recursive: true });
  writeFileSync(
    join(runDirPath, 'ledger.md'),
    '# relay ledger — plan: x\n- 2026-10-19 10:00 [5h 10%] start: 6 tasks\n- 2026-10-19 10:38 [5h 25.2%] wave 1: merged @ aaa, suite pass\n',
  );
  const env = { RELAY_HOME: home };
  const r = runCli(['calibrate', planPath], { cwd: dir, env });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /1 new sample/);
  assert.equal(readCalibration(join(home, 'calibration.json')).samples.length, 1);
  assert.match(runCli(['calibrate', planPath], { cwd: dir, env }).stdout, /0 new sample/, 'samples are not double counted');
  const f = runCli(['forecast', planPath, '--json'], { cwd: dir, env });
  assert.equal(f.code, 0, f.stderr);
  assert.equal(JSON.parse(f.stdout).calibrated, true);
});
