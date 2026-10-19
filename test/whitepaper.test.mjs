import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { forecast } from '../lib/forecast.mjs';
import { computeLanes } from '../lib/lanes.mjs';
import { parsePlan } from '../lib/plan.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { ROOT } from './helpers.mjs';

// The whitepaper quotes these numbers; if the model changes, rebuild the page (docs/whitepaper/README.md).
test('the whitepaper numbers are what the model computes', () => {
  const dir = join(ROOT, 'docs', 'whitepaper');
  const plan = parsePlan(readFileSync(join(dir, 'example-plan.md'), 'utf8'));
  const lanes = computeLanes(plan);
  const f = forecast({ plan, lanes, routing: loadRouting(), calibration: { samples: [] } });
  assert.deepEqual([f.lanes, f.waves, f.baseUnits, f.units], [7, 3, 108.4, 137.5]);
  assert.deepEqual([f.usage.totalPct, f.usage.pctSd, f.usage.windows], [137.5, 7.3, 2]);
  assert.deepEqual([f.time.workMinutes, f.time.waitMinutes, f.time.totalMinutes], [351, 109, 460]);
  const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8'));
  assert.equal(Math.round(data.usage.mean * 10) / 10, f.usage.totalPct, 'data.json is current');
  assert.ok(Math.abs(data.usage.sd - data.usage.sdFormula) < 1e-9, 'exact SD over all outcomes equals the closed form');
  assert.equal(data.expected.totalMinutes, f.time.totalMinutes);
  const tex = readFileSync(join(dir, 'whitepaper.tex'), 'utf8');
  for (const s of ['137.5', '108.4', '5\\,h\\,51\\,min', '1\\,h\\,49\\,min', '7\\,h\\,40\\,min']) assert.ok(tex.includes(s), `the page quotes ${s}`);
});
