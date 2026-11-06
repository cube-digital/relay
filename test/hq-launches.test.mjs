import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getLaunch, startLaunch, stopLaunch } from '../lib/hq/launches.mjs';
import { alive, resolveClaudeBin } from '../scripts/relay-marathon.mjs';
import { ROOT, tempRepo } from './helpers.mjs';

const STUB = join(ROOT, 'test', 'fixtures', 'stub-harness.mjs');
chmodSync(STUB, 0o755);

async function waitFor(check, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

test('a launch runs to done with result.json, and stop ends a sleeping one as stopped', async () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-hq-launch-'));
  process.env.RELAY_HOME = home;
  const { dir } = tempRepo();
  const bin = resolveClaudeBin({ RELAY_CLAUDE_BIN: STUB });
  const base = { action: 'run', repo: dir, plan: 'docs/relay/plans/p.md', harness: 'claude', bin, cwd: dir, model: 'sonnet', effort: 'medium', permissionMode: 'auto' };
  const launchDir = (id) => join(home, 'hq', 'launches', id);

  const quick = startLaunch({ ...base, argv: ['-p', 'hello'], env: {} });
  assert.ok(await waitFor(() => getLaunch(quick.id).status === 'done'), getLaunch(quick.id).status);
  const result = JSON.parse(readFileSync(join(launchDir(quick.id), 'result.json'), 'utf8'));
  assert.equal(result.exitCode, 0);
  assert.equal(result.costUsd, 0.01);
  assert.match(readFileSync(join(launchDir(quick.id), 'out.log'), 'utf8'), /"type":"result"/);
  assert.equal(result.outcome, 'DONE — x');
  assert.equal(getLaunch(quick.id).outcome, 'DONE — x');
  for (const p of [join(home, 'hq'), launchDir(quick.id)]) assert.equal(statSync(p).mode & 0o777, 0o700, p);

  const codex = startLaunch({ ...base, harness: 'codex', argv: ['exec', 'hello'], env: { STUB_CODEX: '1' } });
  assert.ok(await waitFor(() => getLaunch(codex.id).status === 'done'));
  assert.equal(getLaunch(codex.id).outcome, 'PAUSED — y');

  const pidFile = join(home, 'stub.pid');
  const slow = startLaunch({ ...base, argv: ['-p', 'sleep'], env: { STUB_SLEEP_MS: '60000', STUB_PID_FILE: pidFile } });
  assert.ok(await waitFor(() => existsSync(pidFile)));
  assert.equal(getLaunch(slow.id).status, 'running');
  const stopped = await stopLaunch(slow.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(alive(Number(readFileSync(pidFile, 'utf8'))), false, 'the harness process is gone too');
});
