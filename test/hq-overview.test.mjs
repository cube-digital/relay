// The Overview read model and the sidebar counts, over real repositories in a temp RELAY_HOME.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { launchesDir, listLaunches } from '../lib/hq/launches.mjs';
import { overviewFor, sidebarFor, UNASSIGNED } from '../lib/hq/overview.mjs';
import { addRepo, readRegistry } from '../lib/hq/registry.mjs';
import { ridOf } from '../lib/hq/repo.mjs';
import { copyFixture, runCli, tempRepo } from './helpers.mjs';

const PLAN = 'docs/relay/plans/plan-basic.md';

// state: 'blocked' (lane b blocked), 'ready' (complete, integration ahead), 'merged' (complete and marked merged)
function repoIn(state, project) {
  const { dir, git } = tempRepo();
  const planPath = copyFixture('plan-basic.md', dir);
  git('add', '-A');
  git('commit', '-qm', 'plan');
  const relay = (...args) => {
    const r = runCli(args, { cwd: dir });
    assert.equal(r.code, 0, r.stderr);
  };
  relay('ledger', planPath, 'start: 6 tasks, 4 lanes, 2 waves');
  relay('worktrees', 'sync', planPath, '--wave', '1');
  if (state === 'blocked') relay('ledger', planPath, 'Lane b: T4 BLOCKED, needs a decision on the README section');
  else {
    const int = JSON.parse(readFileSync(join(dir, '.relay', 'lanes', 'active.json'), 'utf8')).integration.worktree;
    git('-C', int, 'commit', '-q', '--allow-empty', '-m', 'T1: work');
    relay('ledger', planPath, 'plan: complete (relay/billing-export/integration @ abc)');
    if (state === 'merged') relay('ledger', planPath, 'plan: merged (squashed)');
  }
  return addRepo(dir, project ? { project } : {});
}

function handMade(id, repo, status, startedAt) {
  const dir = join(launchesDir(), id);
  mkdirSync(dir, { recursive: true });
  const endedAt = new Date(Date.parse(startedAt) + 60_000).toISOString();
  writeFileSync(join(dir, 'launch.json'), JSON.stringify({ id, action: 'run', repo, plan: PLAN, harness: 'claude', pid: null, startedAt }));
  writeFileSync(join(dir, 'result.json'), JSON.stringify(status === 'failed' ? { status, exitCode: 1, error: 'boom', endedAt } : { status, exitCode: 0, endedAt }));
}

const stampId = (ms, tail) => `${new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}-${tail}`;
const opts = (extra = {}) => ({ launches: listLaunches(), routineItems: [], setupIssues: [], ...extra });

function world() {
  process.env.RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-hq-overview-'));
  const a = repoIn('blocked', 'Billing');
  repoIn('ready', 'Billing');
  repoIn('merged', 'Billing');
  repoIn('blocked', null);
  return { a, reg: readRegistry() };
}

test('the sidebar counts equal the overview: a blocked lane adds one to its project and to All', () => {
  const { reg } = world();
  const side = sidebarFor(reg, opts());
  assert.equal(side.projects.find((p) => p.id === 'billing').needs, 1);
  assert.equal(side.projects.find((p) => p.id === 'billing').needs, overviewFor(reg, 'billing', opts()).needs.length);
  assert.equal(side.all.needs, overviewFor(reg, 'all', opts()).needs.length);
  assert.equal(side.all.needs, 2);
  assert.equal(side.projects.find((p) => p.id === UNASSIGNED).needs, 1);
});

test('each plan card is in exactly one of running, ready and finished; a blocked lane is a need, and a newer launch clears a failed one', () => {
  const { a, reg } = world();
  const o = overviewFor(reg, 'billing', opts());
  assert.deepEqual(o.running.map((c) => [c.type, c.rid]), [['plan', ridOf(a)]]);
  assert.equal(o.running[0].lanes.find((l) => l.lane === 'b').status, 'blocked');
  assert.equal(o.ready.length, 1);
  assert.equal(o.finished.length, 1);
  assert.notEqual(o.ready[0].rid, o.running[0].rid);
  assert.notEqual(o.finished[0].rid, o.running[0].rid);
  assert.notEqual(o.finished[0].rid, o.ready[0].rid);
  assert.deepEqual(o.needs.map((n) => [n.kind, n.rid, n.lane]), [['lane-blocked', o.running[0].rid, 'b']]);

  const now = Date.now();
  handMade(stampId(now - 3_600_000, 'aaaa'), a, 'failed', new Date(now - 3_600_000).toISOString());
  const failed = overviewFor(reg, 'billing', opts()).needs.filter((n) => n.kind === 'launch-failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].id, `launch:${stampId(now - 3_600_000, 'aaaa')}`);

  handMade(stampId(now - 60_000, 'bbbb'), a, 'done', new Date(now - 60_000).toISOString());
  assert.equal(overviewFor(reg, 'billing', opts()).needs.filter((n) => n.kind === 'launch-failed').length, 0);
});
