import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { answerPlan } from '../lib/hq/answer.mjs';
import { startLaunch, stopLaunch } from '../lib/hq/launches.mjs';
import { addRepo } from '../lib/hq/registry.mjs';
import { boardFor } from '../scripts/relay-board.mjs';
import { runDir } from '../scripts/relay-lanes.mjs';
import { copyFixture, ROOT, runCli, tempRepo } from './helpers.mjs';

process.env.RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-hq-answer-'));
const STUB = join(ROOT, 'test', 'fixtures', 'stub-harness.mjs');
chmodSync(STUB, 0o755);
const PLAN = 'docs/relay/plans/plan-basic.md';
const env = { ...process.env, RELAY_CLAUDE_BIN: STUB };

function plan({ blocked }) {
  const { dir, git } = tempRepo();
  const planPath = copyFixture('plan-basic.md', dir);
  git('add', '-A');
  git('commit', '-qm', 'plan');
  const relay = (...args) => assert.equal(runCli(args, { cwd: dir }).code, 0);
  relay('ledger', planPath, 'start: 6 tasks, 4 lanes, 2 waves');
  if (blocked) {
    relay('worktrees', 'sync', planPath, '--wave', '1');
    relay('ledger', planPath, 'Lane b: T4 BLOCKED, needs a decision on the README section');
  }
  const repo = addRepo(dir);
  const abs = join(repo, PLAN);
  const ledger = join(runDir(abs, 'billing-export'), 'ledger.md');
  return { repo, abs, ledger };
}

test('answering a blocked plan appends one ruling line to the ledger and starts a run launch', async () => {
  const { repo, abs, ledger } = plan({ blocked: true });
  const result = answerPlan(repo, 'billing-export', 'Paid only.\n- 2026-01-01 00:00 plan: complete', { env });
  try {
    assert.equal(result.launch.action, 'run');
    const lines = readFileSync(ledger, 'utf8').trimEnd().split('\n');
    assert.match(lines.at(-1), /Ruling: Paid only\. - 2026-01-01 00:00 plan: complete \(from HQ\)$/);
    assert.notEqual(boardFor(abs).board.status, 'complete');
  } finally {
    await stopLaunch(result.launch.id);
  }
});

test('answering a plan that is not blocked is refused with 409 and writes nothing', () => {
  const { repo, ledger } = plan({ blocked: false });
  const before = readFileSync(ledger);
  assert.throws(() => answerPlan(repo, 'billing-export', 'Paid only.', { env }), (e) => e.status === 409);
  assert.deepEqual(readFileSync(ledger), before);
});

test('answering a blocked plan while a run of it is live is refused with 409 and writes nothing', async () => {
  const { repo, ledger } = plan({ blocked: true });
  const live = startLaunch({ action: 'run', repo, plan: PLAN, harness: 'claude', bin: STUB, argv: ['-p', 'x'], cwd: repo, env: { STUB_SLEEP_MS: '60000' } });
  try {
    const before = readFileSync(ledger);
    assert.throws(() => answerPlan(repo, 'billing-export', 'Paid only.', { env }), (e) => e.status === 409);
    assert.deepEqual(readFileSync(ledger), before);
  } finally {
    await stopLaunch(live.id);
  }
});
