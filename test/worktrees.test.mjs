import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { copyFixture, runCli, tempRepo } from './helpers.mjs';

function commitIn(cwd, git, file, msg) {
  mkdirSync(join(cwd, file, '..'), { recursive: true });
  writeFileSync(join(cwd, file), `${msg}\n`);
  git('-C', cwd, 'add', '-A');
  git('-C', cwd, 'commit', '-qm', msg);
}

test('lanes run in reusable worktrees: sync, commit, merge, pack, next wave, clean', () => {
  const { dir, git } = tempRepo();
  const plan = copyFixture('plan-basic.md', dir);
  git('add', '-A');
  git('commit', '-qm', 'plan');

  // wave 1: three lanes
  let r = runCli(['worktrees', 'sync', plan, '--wave', '1'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  const active = JSON.parse(readFileSync(join(dir, '.relay/lanes/active.json'), 'utf8'));
  assert.deepEqual(Object.keys(active.lanes), ['a', 'b', 'c']);
  const laneA = active.lanes.a;
  assert.ok(existsSync(laneA.worktree));
  assert.equal(git('-C', laneA.worktree, 'branch', '--show-current'), 'relay/billing-export/lane-a');
  assert.ok(existsSync(laneA.brief));
  assert.match(readFileSync(laneA.brief, 'utf8'), /### T1: Export schema[\s\S]*### T2: CSV writer[\s\S]*new-test budget: 2/);
  assert.match(readFileSync(join(dir, '.git/info/exclude'), 'utf8'), /\.relay\//);
  assert.equal(git('status', '--porcelain'), '', 'relay scratch stays out of git status');

  // the lanes do their work
  commitIn(laneA.worktree, git, 'src/export/schema.ts', 'T1: Export schema');
  commitIn(laneA.worktree, git, 'src/export/csv.ts', 'T2: CSV writer');
  commitIn(active.lanes.c.worktree, git, 'src/billing/round.ts', 'T5: Rounding helper');

  // re-running sync mid-wave keeps unmerged lane work
  r = runCli(['worktrees', 'sync', plan, '--wave', '1'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /lane-a\s+kept/);

  // review package for lane a
  r = runCli(['worktrees', 'pack', plan, 'a'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  const pkg = readFileSync(r.stdout.trim(), 'utf8');
  assert.match(pkg, /T1: Export schema/);
  assert.match(pkg, /```diff[\s\S]*src\/export\/csv\.ts/);

  // merge wave 1 and run the suite once
  r = runCli(['worktrees', 'merge', plan, '--wave', '1', '--suite'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /lane-a: merged 2 commit/);
  assert.match(r.stdout, /lane-b: no commits, skipped/);
  assert.match(r.stdout, /suite passed/);
  const intLog = git('log', '--oneline', 'relay/billing-export/integration');
  assert.match(intLog, /T2: CSV writer/);
  assert.match(intLog, /T5: Rounding helper/);

  // wave 2 reuses slot 1 and branches from the new integration head
  r = runCli(['worktrees', 'sync', plan, '--wave', '2'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /lane-d\s+reused/);
  const active2 = JSON.parse(readFileSync(join(dir, '.relay/lanes/active.json'), 'utf8'));
  assert.equal(active2.lanes.d.worktree, laneA.worktree);
  assert.ok(existsSync(join(active2.lanes.d.worktree, 'src/export/csv.ts')), 'wave 2 sees wave 1 work');
  assert.deepEqual(active2.lanes.d.segments.map((s) => s.role), ['implementer', 'implementer-deep']);

  // final package and cleanup
  r = runCli(['worktrees', 'pack', plan, '--final'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(readFileSync(r.stdout.trim(), 'utf8'), /Final review package/);
  r = runCli(['worktrees', 'clean', plan], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!existsSync(laneA.worktree));
});

test('a merge conflict between lanes is reported and aborted cleanly', () => {
  const { dir, git } = tempRepo({ 'shared.txt': 'base\n' });
  const plan = copyFixture('spike-plan.md', dir);
  git('add', '-A');
  git('commit', '-qm', 'plan');
  assert.equal(runCli(['worktrees', 'sync', plan, '--wave', '1'], { cwd: dir }).code, 0);
  const active = JSON.parse(readFileSync(join(dir, '.relay/lanes/active.json'), 'utf8'));
  // both lanes (wrongly) touch the same file
  writeFileSync(join(active.lanes.a.worktree, 'shared.txt'), 'from a\n');
  git('-C', active.lanes.a.worktree, 'commit', '-qam', 'T1');
  writeFileSync(join(active.lanes.b.worktree, 'shared.txt'), 'from b\n');
  git('-C', active.lanes.b.worktree, 'commit', '-qam', 'T2');
  const r = runCli(['worktrees', 'merge', plan, '--wave', '1'], { cwd: dir });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /lane-b conflicts[\s\S]*shared\.txt/);
  assert.equal(git('-C', active.integration.worktree, 'status', '--porcelain'), '', 'merge was aborted');
});

test('ledger and protect commands', () => {
  const { dir } = tempRepo();
  const plan = copyFixture('spike-plan.md', dir);
  assert.equal(runCli(['ledger', plan, 'Task T1: complete'], { cwd: dir }).code, 0);
  assert.equal(runCli(['ledger', plan, 'Ruling: keep CSV header lowercase — spec silent — rename later'], { cwd: dir }).code, 0);
  const rulings = runCli(['ledger', plan, '--rulings'], { cwd: dir });
  assert.match(rulings.stdout, /Ruling: keep CSV header/);
  assert.doesNotMatch(rulings.stdout, /Task T1/);

  assert.equal(runCli(['protect', 'add', 'tests/acceptance/**'], { cwd: dir }).code, 0);
  assert.match(runCli(['protect', 'list'], { cwd: dir }).stdout, /tests\/acceptance\/\*\*/);
  assert.equal(runCli(['protect', 'remove', 'tests/acceptance/**'], { cwd: dir }).code, 0);
  assert.match(runCli(['protect', 'list'], { cwd: dir }).stdout, /no protected tests/);
});
