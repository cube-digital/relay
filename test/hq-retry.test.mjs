import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as launch from '../lib/hq/launch.mjs';
import { getLaunch, launchesDir, startLaunch, stopLaunch } from '../lib/hq/launches.mjs';
import { addRepo } from '../lib/hq/registry.mjs';
import { runDir } from '../scripts/relay-lanes.mjs';
import { copyFixture, ROOT, tempRepo } from './helpers.mjs';

const home = mkdtempSync(join(tmpdir(), 'relay-hq-retry-'));
process.env.RELAY_HOME = home;
const STUB = join(ROOT, 'test', 'fixtures', 'stub-harness.mjs');
chmodSync(STUB, 0o755);
const PLAN = 'docs/relay/plans/plan-basic.md';
const env = { RELAY_CLAUDE_BIN: STUB, PATH: process.env.PATH };

function registeredRepo() {
  const { dir } = tempRepo();
  copyFixture('plan-basic.md', dir);
  return addRepo(dir);
}

function handMade(id, repo, intent, result) {
  const dir = join(launchesDir(), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'launch.json'), JSON.stringify({ id, action: 'skill', repo, harness: 'claude', pid: null, startedAt: '2026-01-01T00:00:00.000Z', intent }));
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ ...result, endedAt: '2026-01-01T00:01:00.000Z' }));
}

test('retry restarts a failed launch with its stored intent, and refuses done and running launches', async () => {
  const repo = registeredRepo();
  const intent = { action: 'skill', repo, skill: 'qa-mindset', prompt: 'check lane b', harness: 'claude' };
  handMade('20260101-000000-abcd', repo, intent, { status: 'failed', exitCode: 1 });
  handMade('20260101-000001-abce', repo, intent, { status: 'done', exitCode: 0 });

  assert.equal('intent' in getLaunch('20260101-000000-abcd'), false);
  const again = launch.retryLaunch('20260101-000000-abcd', { env });
  try {
    assert.notEqual(again.id, '20260101-000000-abcd');
    const stored = JSON.parse(readFileSync(join(launchesDir(), again.id, 'launch.json'), 'utf8'));
    assert.deepEqual(stored.intent, intent);
  } finally {
    await stopLaunch(again.id);
  }

  assert.throws(() => launch.retryLaunch('20260101-000001-abce', { env }), (e) => e.status === 409);
  const running = startLaunch({ action: 'skill', repo, harness: 'claude', bin: STUB, argv: ['-p', 'x'], cwd: repo, env: { STUB_SLEEP_MS: '60000' }, intent });
  try {
    assert.throws(() => launch.retryLaunch(running.id, { env }), (e) => e.status === 409);
  } finally {
    await stopLaunch(running.id);
  }
});

test('a marathon that ended blocked resumes until a non-ruling ledger line follows it', () => {
  const repo = registeredRepo();
  const planAbs = join(repo, PLAN);
  const dir = runDir(planAbs, 'billing-export');
  mkdirSync(dir, { recursive: true });
  const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const now = Date.now();
  writeFileSync(join(dir, 'ledger.md'), `- ${stamp(now - 120_000)} start: 6 tasks, 4 lanes, 2 waves\n`);
  writeFileSync(join(dir, 'marathon.json'), JSON.stringify({ endedAt: new Date(now - 60_000).toISOString(), stopReason: 'blocked: needs a decision', pid: 0 }));
  const intent = launch.normalizeIntent({ action: 'run', repo, plan: PLAN, harness: 'claude' });

  const resumed = launch.evaluateGuards(intent, { env });
  assert.deepEqual(resumed.errors, []);
  assert.equal(resumed.resume, true);

  appendFileSync(join(dir, 'ledger.md'), `- ${stamp(now)} Lane a: T1 done\n`);
  assert.match(launch.evaluateGuards(intent, { env }).errors.join('\n'), /already running/);
});
