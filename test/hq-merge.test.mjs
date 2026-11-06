import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mergeLocally, mergePreview } from '../lib/hq/merge.mjs';
import { addRepo } from '../lib/hq/registry.mjs';
import { runDir } from '../scripts/relay-lanes.mjs';
import { copyFixture, runCli, tempRepo } from './helpers.mjs';

process.env.RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-hq-merge-'));

// A complete plan whose integration branch is one commit ahead of main.
function completePlan() {
  const { dir, git } = tempRepo();
  const planPath = copyFixture('plan-basic.md', dir);
  git('add', '-A');
  git('commit', '-qm', 'plan');
  git('checkout', '-qb', 'relay/billing-export/integration');
  writeFileSync(join(dir, 'work.txt'), 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'T1: Export schema');
  git('checkout', '-q', 'main');
  const relay = (...args) => assert.equal(runCli(args, { cwd: dir }).code, 0);
  relay('ledger', planPath, 'start: 6 tasks, 4 lanes, 2 waves');
  relay('ledger', planPath, 'plan: complete (relay/billing-export/integration @ abc)');
  const repo = addRepo(dir);
  const ledger = join(runDir(join(repo, 'docs/relay/plans/plan-basic.md'), 'billing-export'), 'ledger.md');
  return { dir, git, repo, ledger };
}

test('merging locally makes a merge commit and ledgers plan: merged', () => {
  const { git, repo, ledger } = completePlan();
  const preview = mergePreview(repo, 'billing-export');
  assert.equal(preview.branch, 'relay/billing-export/integration');
  assert.equal(preview.into, 'main');
  assert.equal(preview.commits.length, 1);
  assert.match(preview.commits[0], /T1: Export schema/);

  const done = mergeLocally(repo, 'billing-export');
  assert.equal(done.ok, true);
  assert.equal(git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3);
  assert.match(readFileSync(ledger, 'utf8'), /plan: merged \(merged locally in HQ into main @ [0-9a-f]+\)$/m);
});

test('merging locally refuses a dirty working tree and changes nothing', () => {
  const { dir, git, repo, ledger } = completePlan();
  writeFileSync(join(dir, 'README.md'), '# demo, edited\n');
  const head = git('rev-parse', 'HEAD');
  const before = readFileSync(ledger);
  assert.throws(() => mergeLocally(repo, 'billing-export'), (e) => e.status === 409);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.deepEqual(readFileSync(ledger), before);
});

test('a conflicting merge is aborted and leaves the repository as it was', () => {
  const { dir, git, repo, ledger } = completePlan();
  git('checkout', '-q', 'relay/billing-export/integration');
  writeFileSync(join(dir, 'README.md'), '# from integration\n');
  git('commit', '-qam', 'T2: readme');
  git('checkout', '-q', 'main');
  writeFileSync(join(dir, 'README.md'), '# from main\n');
  git('commit', '-qam', 'main readme');
  const head = git('rev-parse', 'HEAD');
  const before = readFileSync(ledger);

  assert.throws(() => mergeLocally(repo, 'billing-export'), (e) => e.status === 409 && JSON.stringify(e.conflicts) === '["README.md"]');
  assert.throws(() => git('rev-parse', '-q', '--verify', 'MERGE_HEAD'));
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
  assert.deepEqual(readFileSync(ledger), before);
});
