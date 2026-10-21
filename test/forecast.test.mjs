import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { makespan, parseLedgerLine, readCalibration, summarize, waveSamples } from '../lib/calibration.mjs';
import { forecast, formatForecast, simulate } from '../lib/forecast.mjs';
import { attachPieces } from '../lib/flows.mjs';
import { computeLanes } from '../lib/lanes.mjs';
import { parsePlan } from '../lib/plan.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { formatLine, usageStamp } from '../scripts/relay-ledger.mjs';
import { copyFixture, FIXTURES, runCli, tempRepo } from './helpers.mjs';

const routing = loadRouting();
const plan = parsePlan(readFileSync(join(FIXTURES, 'plan-basic.md'), 'utf8'));
const lanes = computeLanes(plan);

const taskById = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
const cfg = routing.forecast;
// expected lane weights of plan-basic, by hand: W·(1 + 0.35·p)
const W1 = [3.8 * 1.175, 0.8 * 1.07, 3 * 1.175]; // wave 1: lanes a (T1+T2, p .5), b (T4, p .2), c (T5, p .5)
const W2 = [14 * 1.28]; // wave 2: lane d (T3+T6, p .8)
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} vs ${b}`);

test('ledger lines carry a usage stamp with the 5h reset when the reading is fresh, none when stale', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const fresh = { updatedAt: '2026-10-19T11:50:00Z', fiveHour: { percentUsed: 23.4, resetsAt: '2026-10-19T14:05:00Z' }, sevenDay: { percentUsed: 41 } };
  assert.equal(usageStamp(fresh, 360, now.getTime()), ' [5h 23.4% resets 14:05 · 7d 41%]');
  assert.equal(usageStamp({ updatedAt: '2026-10-19T11:50:00Z', fiveHour: { percentUsed: 9 } }, 360, now.getTime()), ' [5h 9%]');
  assert.equal(usageStamp({ updatedAt: '2026-10-18T00:00:00Z', fiveHour: { percentUsed: 9 } }, 360, now.getTime()), '');
  assert.equal(formatLine('wave 1: merged', { now, snapshot: fresh }), '- 2026-10-19 12:00 [5h 23.4% resets 14:05 · 7d 41%] wave 1: merged\n');
  assert.deepEqual(parseLedgerLine('- 2026-10-19 12:00 [5h 23.4% resets 14:05 · 7d 41%] wave 1: merged @ abc'), {
    at: Date.parse('2026-10-19T12:00:00Z'),
    fiveHour: 23.4,
    fiveHourReset: Date.parse('2026-10-19T14:05:00Z'),
    sevenDay: 41,
    text: 'wave 1: merged @ abc',
  });
  assert.equal(parseLedgerLine('- 2026-10-19 23:30 [5h 5% resets 02:10] x').fiveHourReset, Date.parse('2026-10-20T02:10:00Z'), 'a reset earlier in the day is tomorrow');
});

test('a calibration sample is usage over expected weight and time over the makespan', () => {
  const ledger = [
    '# relay ledger — plan: x',
    '- 2026-10-19 10:00 [5h 10% resets 14:00 · 7d 5%] start: 6 tasks, 4 lanes, 2 waves',
    '- 2026-10-19 10:30 [5h 22% resets 14:00 · 7d 6%] wave 1: merged @ aaa, suite pass',
    '- 2026-10-19 14:40 [5h 30% resets 19:00 · 7d 8%] wave 2: merged @ bbb, suite pass',
  ].join('\n');
  const { samples, skipped } = waveSamples(ledger, lanes, plan.slug, cfg, taskById, 4);
  assert.equal(samples.length, 1, 'wave 2 crossed the 14:00 reset: dropped although its reading went up');
  assert.match(skipped[0], /wave 2: the 5h window reset during the wave; sample dropped/);
  const w = samples[0];
  close(w.weight, sum(W1), 'weight is the sum of expected lane weights');
  close(w.wall, Math.max(...W1), 'time follows the heaviest lane');
  close(w.pct5h, 12 / sum(W1));
  close(w.pct7d, 1 / sum(W1), 'the weekly rate is its own unit');
  close(w.minutes, 30 / Math.max(...W1));
  // without reset times in the stamps, a reading that falls still marks the reset, and the time sample goes too
  const legacy = waveSamples('- 2026-10-19 10:00 [5h 60%] start: x\n- 2026-10-19 15:20 [5h 4%] wave 1: merged @ a\n', lanes, plan.slug, cfg, taskById, 4);
  assert.equal(legacy.samples.length, 0);
});

test('calibration uses ratio estimators and ignores samples in older units', () => {
  const samples = [
    { v: 2, slug: 'x', wave: 1, weight: 10, wall: 5, pct5h: 1, minutes: 2, at: 'a' }, // ΔU 10, Δt 10
    { v: 2, slug: 'x', wave: 2, weight: 30, wall: 10, pct5h: 2, minutes: 4, at: 'b' }, // ΔU 60, Δt 40
    { slug: 'old', wave: 1, weight: 10, pct5h: 9, minutes: 9, at: 'c' },
  ];
  const s = summarize({ samples });
  assert.equal(s.n, 2);
  assert.equal(s.ignored, 1);
  close(s.pctPerUnit, 70 / 40, 'ΣΔU / ΣW');
  close(s.minutesPerUnit, 50 / 15, 'ΣΔt / Σ makespan');
});

test('a forecast built from a calibrated run predicts that run: fix rounds are counted once', () => {
  // a run whose usage is exactly r·ΣW̃ per wave and whose time is exactly m·makespan
  const r = 0.9;
  const m = 3;
  const u1 = 10 + r * sum(W1);
  const t1 = m * Math.max(...W1);
  const at = (min) => new Date(Date.parse('2026-10-19T10:00:00Z') + min * 60_000).toISOString().slice(0, 16).replace('T', ' ');
  const ledger = [`- ${at(0)} [5h 10%] start: x`, `- ${at(t1)} [5h ${u1}%] wave 1: merged @ a`, `- ${at(t1 + m * W2[0])} [5h ${u1 + r * W2[0]}%] wave 2: merged @ b`].join('\n');
  const { samples } = waveSamples(ledger, lanes, plan.slug, cfg, taskById, 4);
  const f = forecast({ plan, lanes, routing, calibration: { samples } });
  close(f.rates.pctPerUnit, r);
  assert.ok(Math.abs(f.rates.minutesPerUnit - m) < 0.05, 'minutes are rounded to whole ledger minutes');
  assert.equal(f.usage.totalPct, Math.round(r * (sum(W1) + W2[0]) * 10) / 10, 'no second fix-round multiplier');
});

test('forecast counts agents and worktrees from the plan, gives the fix-round spread and flags placeholder rates', () => {
  const withPieces = attachPieces(plan, computeLanes(plan));
  const f = forecast({ plan, lanes: withPieces, routing, calibration: { samples: [] } });
  assert.equal(f.lanes, 4);
  assert.equal(f.waves, 2);
  assert.equal(f.agents.counts.reviewer, 4);
  assert.equal(f.agents.counts['test-author'], 3, 'lanes a, c and d budget tests at medium/high risk');
  assert.equal(f.agents.counts['implementer-deep'], 1);
  assert.equal(f.worktrees, 4, '3 parallel lanes + integration');
  assert.equal(f.baseUnits, 21.6);
  assert.equal(f.units, Math.round((sum(W1) + W2[0] + 9) * 10) / 10, 'three acceptance-tests pieces at mid weight 3 add work');
  assert.equal(f.pieceUnits, 9);
  // SD = κ·√Σ W²p(1−p) = 0.35·√(3.8²·.25 + 0.8²·.16 + 3²·.25 + 14²·.16)
  assert.equal(f.usage.pctSd, Math.round(0.35 * Math.sqrt(3.8 ** 2 * 0.25 + 0.8 ** 2 * 0.16 + 9 * 0.25 + 196 * 0.16) * 10) / 10);
  assert.equal(f.calibrated, false);
  const text = formatForecast(f);
  assert.match(text, /PLACEHOLDER rate/);
  assert.match(text, /windows .* from placeholder rates/);
  assert.match(text, /time .* from placeholder rates/);
  assert.equal(f.usage.weeklyPct, undefined, 'no weekly claim without weekly samples');
  assert.match(text, /weekly\s+unknown until calibrated/);

  const timeOnly = forecast({ plan, lanes, routing, calibration: { samples: [{ v: 2, slug: 'x', wave: 1, weight: 10, wall: 5, minutes: 3, at: 'a' }] } });
  assert.equal(timeOnly.calibratedTime, true);
  assert.equal(timeOnly.calibratedUsage, false, 'waves without 5h readings calibrate time only');
  assert.match(formatForecast(timeOnly), /PLACEHOLDER rate/);

  const cal = { samples: [{ v: 2, slug: 'x', wave: 1, weight: 10, wall: 5, pct5h: 2, pct7d: 1, minutes: 3, at: '2026-10-19T00:00:00Z' }] };
  const g = forecast({ plan, lanes, routing, calibration: cal, budget: { fiveHour: { percentUsed: 80 }, sevenDay: { percentUsed: 90 } } });
  assert.equal(g.calibrated, true);
  assert.equal(g.rates.pctPerUnit, 2);
  assert.ok(g.usage.windows >= 2, 'starting at 80% used forces a second window');
  assert.equal(g.usage.fitsWeekly, false);
  assert.match(formatForecast(g), /DOES NOT FIT/);
  assert.doesNotMatch(formatForecast(g), /placeholder/i);
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

test('time uses the makespan; three or more waves give a usage range', () => {
  const wavesTwoLanes = [{ wave: 1, lanes: [{ id: 'a', weight: 10 }, { id: 'b', weight: 4 }] }];
  const t = simulate({ waves: wavesTwoLanes, pctPerUnit: 1, minutesPerUnit: 2, critical: 85, windowHours: 5 });
  assert.equal(t.workMinutes, 20, 'two parallel lanes take as long as the heavier one');
  const cap1 = simulate({ waves: wavesTwoLanes, pctPerUnit: 1, minutesPerUnit: 2, critical: 85, windowHours: 5, maxParallel: 1 });
  assert.equal(cap1.workMinutes, 28, 'with one lane at a time they queue');
  assert.equal(makespan([10, 1, 1, 1, 1], 4), 10, 'small lanes fill the free slots while the big one runs');
  assert.equal(makespan([10, 1, 1, 1, 1], 2), 10);
  assert.equal(makespan([5, 5, 5], 2), 10);
  assert.equal(makespan([], 4), 0);
  const samples = [1, 2, 3].map((r, i) => ({ v: 2, slug: 'x', wave: i + 1, weight: 10, wall: 5, pct5h: r, minutes: 2, at: '2026-10-19T00:00:00Z' }));
  const s = summarize({ samples });
  assert.deepEqual(s.pctRange, [1, 3]);
  assert.equal(s.pctPerUnit, 2);
  const f = forecast({ plan, lanes, routing, calibration: { samples } });
  assert.ok(f.usage.pctRange[0] < f.usage.totalPct && f.usage.totalPct < f.usage.pctRange[1]);
  assert.match(formatForecast(f), /calibrated range \d/);
});

test('a wave that does not fit starts anyway, pauses at the stop line and finishes after the reset', () => {
  const waves = [
    { wave: 1, lanes: [{ id: 'a', weight: 50 }] },
    { wave: 2, lanes: [{ id: 'b', weight: 50 }] },
  ];
  const s = simulate({ waves, pctPerUnit: 1, minutesPerUnit: 1, critical: 85, windowHours: 5 });
  // wave 2 runs from 50% to 85% (t 50→85), waits for the reset at t 300, then does its last 15%
  assert.equal(s.windows, 2);
  assert.equal(s.waitMinutes, 215, 'waiting at the end of wave 1 would have wasted a third of the window');
  assert.equal(s.totalMinutes, 315);
  assert.deepEqual(s.events[1].windows, [1, 2]);
  assert.match(formatForecast(forecast({ plan, lanes, routing, calibration: { samples: [] }, budget: { fiveHour: { percentUsed: 84 } } })), /windows 1–2 \(pauses at the stop line/);
});

test('a window also ends by time, and a budget reading places the current reset', () => {
  const slow = simulate({ waves: [{ wave: 1, lanes: [{ id: 'a', weight: 10 }] }], pctPerUnit: 1, minutesPerUnit: 40, critical: 85, windowHours: 5 });
  assert.equal(slow.windows, 2, 'a 400-minute wave outlives its 300-minute window');
  assert.equal(slow.waitMinutes, 0, 'a window that expires by time needs no wait');
  const soon = simulate({ waves: [{ wave: 1, lanes: [{ id: 'a', weight: 20 }] }], pctPerUnit: 1, minutesPerUnit: 1, critical: 85, windowHours: 5, startPct: 80, resetInMinutes: 30 });
  assert.equal(soon.waitMinutes, 25, '5% fits, then the wait lasts until the reset 30 minutes out, not 5 hours');
  assert.equal(soon.trace.at(-1).used, 15);
});

test('a wave merged twice (red suite, then green) is one sample; a wave without readings at both ends is none', () => {
  const twice = [
    '- 2026-10-19 10:00 [5h 10% resets 14:00] start: x',
    '- 2026-10-19 10:40 [5h 40% resets 14:00] wave 1: merged @ a, suite fail',
    '- 2026-10-19 10:50 [5h 42% resets 14:00] wave 1: merged @ b, suite pass',
  ].join('\n');
  const one = waveSamples(twice, lanes, plan.slug, cfg, taskById, 4);
  assert.equal(one.samples.length, 1);
  close(one.samples[0].pct5h, 32 / sum(W1), 'measured from the start to the last merge');
  close(one.samples[0].minutes, 50 / Math.max(...W1));
  const unstamped = waveSamples('- 2026-10-19 10:00 start: x\n- 2026-10-19 16:00 [5h 30%] wave 1: merged @ a\n', lanes, plan.slug, cfg, taskById, 4);
  assert.equal(unstamped.samples.length, 0, 'a 6-hour wave with an unknown start may hide a reset and a wait');
  assert.match(unstamped.skipped[0], /no fresh 5h reading/);
});

test('ledger stamps are measurements: a reading older than 20 minutes is not written', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  assert.match(formatLine('x', { now, snapshot: { updatedAt: '2026-10-19T11:45:00Z', fiveHour: { percentUsed: 30 } } }), /\[5h 30%\]/);
  assert.equal(formatLine('x', { now, snapshot: { updatedAt: '2026-10-19T11:30:00Z', fiveHour: { percentUsed: 30 } } }), '- 2026-10-19 12:00 x\n');
});
