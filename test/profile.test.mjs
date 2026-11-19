import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCli } from './helpers.mjs';

function home({ session, fiveHour } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-home-'));
  const now = new Date().toISOString();
  if (session) writeFileSync(join(dir, 'claude-session.json'), JSON.stringify({ source: 'claude-code', updatedAt: now, ...session }));
  if (fiveHour !== undefined) writeFileSync(join(dir, 'budget.json'), JSON.stringify({ source: 'claude-code', updatedAt: now, fiveHour: { percentUsed: fiveHour }, sevenDay: { percentUsed: 5 } }));
  return dir;
}

const row = (out, role) => out.split('\n').find((l) => l.trim().startsWith(`${role} `))?.trim().split(/\s+/);

test('a Fable session takes the fable-lead route: architect and round 6 on Fable, builders unchanged', () => {
  const r = runCli(['profile'], { env: { RELAY_HOME: home({ session: { model: 'claude-fable-5-2', effort: 'medium' }, fiveHour: 20 }) } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /profile: fable-5\.2 · route fable-lead · budget normal/);
  assert.deepEqual(row(r.stdout, 'architect').slice(0, 4), ['architect', 'strong', 'fable', 'high']);
  assert.deepEqual(row(r.stdout, 'implementer').slice(0, 4), ['implementer', 'mid', 'sonnet', 'medium']);
  assert.match(r.stdout, /fix round 6: lane-<id>-r6 → implementer-deep on fable, effort medium/);
  assert.match(r.stdout, /set \/effort high before an unattended run/);
});

test('an Opus session keeps the default route, as before the profiles', () => {
  const r = runCli(['profile', '--model', 'claude-opus-5-5', '--json'], { env: { RELAY_HOME: home({ fiveHour: 20 }) } });
  const report = JSON.parse(r.stdout);
  assert.equal(report.route, 'default');
  assert.equal(report.rows.find((x) => x.role === 'architect').model, 'opus');
  assert.equal(report.escalation, undefined);
});

test('above the frontier cap the architect falls back to Opus', () => {
  const r = runCli(['profile', '--model', 'fable', '--json'], { env: { RELAY_HOME: home({ fiveHour: 55 }) } });
  const report = JSON.parse(r.stdout);
  assert.equal(report.budget, 'normal');
  assert.equal(report.rows.find((x) => x.role === 'architect').model, 'opus');
  assert.equal(report.escalation.model, 'opus');
});

test('above the frontier cap at a normal budget, fix round 6 is off', () => {
  const r = runCli(['profile', '--model', 'fable'], { env: { RELAY_HOME: home({ fiveHour: 55 }) } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /budget normal/);
  assert.match(r.stdout, /fix round 6: off while the budget is above the profile cap/);
  assert.doesNotMatch(r.stdout, /lane-<id>-r6 → implementer-deep on/);
});

test('without a session reading the default route applies and the output says how to get one', () => {
  const r = runCli(['profile'], { env: { RELAY_HOME: home() } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /route default/);
  assert.match(r.stdout, /No session model yet/);
});
