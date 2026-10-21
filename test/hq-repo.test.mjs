import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { planDetail, repoSummary } from '../lib/hq/repo.mjs';
import { boardFor } from '../scripts/relay-board.mjs';
import { copyFixture, runCli, tempRepo } from './helpers.mjs';

test('a repository summary carries the board lights and a blocked lane as an attention item', () => {
  process.env.RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-hq-repo-'));
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
  const active = JSON.parse(readFileSync(join(dir, '.relay', 'lanes', 'active.json'), 'utf8'));
  writeFileSync(join(active.lanes.a.worktree, 'schema.ts'), 'export {}\n');
  git('-C', active.lanes.a.worktree, 'add', '-A');
  git('-C', active.lanes.a.worktree, 'commit', '-qm', 'T1: Export schema');
  relay('ledger', planPath, 'Lane b: T4 BLOCKED, needs a decision on the README section');

  const summary = repoSummary(dir);
  const plan = summary.plans.find((p) => p.slug === 'billing-export');
  const lights = (b) => b.waves.flatMap((w) => w.lanes.flatMap((l) => [`${l.id}:${l.light}`, ...l.tasks.map((t) => `${t.id}:${t.light}`)]));
  assert.deepEqual(lights(plan.board), lights(boardFor(planPath).board));
  assert.ok(summary.attention.some((a) => a.kind === 'lane-blocked' && a.lane === 'b' && a.plan === 'billing-export'), JSON.stringify(summary.attention));
  assert.ok(!summary.attention.some((a) => a.lane === 'a'));

  const runDir = planDetail(dir, 'billing-export').runDir;
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'lane-a.review.md'), '+const PACKAGE_DIFF_MARKER = 1;\n');
  writeFileSync(join(runDir, 'lane-a.fix-abc1234.findings.md'), 'Important: the export drops the header row.\n');
  const detail = planDetail(dir, 'billing-export');
  assert.match(detail.lanes.a.latestFindings.text, /drops the header row/);
  assert.ok(detail.lanes.a.latestReview.path.endsWith('lane-a.review.md'));
  assert.ok(!JSON.stringify(detail).includes('PACKAGE_DIFF_MARKER'));
});
