// Open PR: refusals leave the remote untouched; with a stubbed gh the integration branch is pushed and the URL returned.

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { openPr } from '../lib/hq/pr.mjs';
import { addRepo } from '../lib/hq/registry.mjs';
import { copyFixture, ROOT, runCli, tempRepo } from './helpers.mjs';

const STUB_GH = join(ROOT, 'test', 'fixtures', 'stub-gh.mjs');
chmodSync(STUB_GH, 0o755);
const BRANCH = 'relay/billing-export/integration';

// A complete, unmerged plan: the integration branch has a commit the current branch lacks.
function completePlan() {
  process.env.RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-hq-pr-'));
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
  const int = JSON.parse(readFileSync(join(dir, '.relay', 'lanes', 'active.json'), 'utf8')).integration.worktree;
  git('-C', int, 'commit', '-q', '--allow-empty', '-m', 'T1: work');
  relay('ledger', planPath, `plan: complete (${BRANCH} @ abc)`);
  return { path: addRepo(dir), git };
}

const bareRepo = () => {
  const bare = mkdtempSync(join(tmpdir(), 'relay-hq-pr-bare-'));
  execFileSync('git', ['init', '-q', '--bare', bare]);
  return bare;
};
const refsIn = (bare, pattern) => execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--format=%(refname)', pattern], { encoding: 'utf8' }).trim();

test('Open PR is refused without origin, without gh and without gh sign-in, and pushes nothing', () => {
  const { path, git } = completePlan();
  const base = { ...process.env };
  delete base.RELAY_GH_BIN;
  const refused = (re) => (e) => e.status === 409 && re.test(e.message);

  assert.throws(() => openPr(path, 'billing-export', { env: { ...base, RELAY_GH_BIN: STUB_GH } }), refused(/no origin/));

  const bare = bareRepo();
  git('remote', 'add', 'origin', bare);
  const emptyPath = mkdtempSync(join(tmpdir(), 'relay-hq-pr-nopath-'));
  assert.throws(() => openPr(path, 'billing-export', { env: { ...base, PATH: emptyPath } }), refused(/gh is not installed/));
  assert.throws(() => openPr(path, 'billing-export', { env: { ...base, RELAY_GH_BIN: STUB_GH, STUB_GH_AUTH: 'fail' } }), refused(/not signed in/));

  assert.equal(refsIn(bare, 'refs/heads'), '');
});

test('Open PR with a stubbed gh pushes the integration branch only and returns the URL gh printed', () => {
  const { path, git } = completePlan();
  const bare = bareRepo();
  git('remote', 'add', 'origin', bare);
  const log = join(mkdtempSync(join(tmpdir(), 'relay-hq-pr-log-')), 'gh.log');
  const env = { ...process.env, RELAY_GH_BIN: STUB_GH, STUB_GH_LOG: log };
  delete env.STUB_GH_AUTH;

  const res = openPr(path, 'billing-export', { env });

  assert.equal(res.url, 'https://github.com/acme/demo/pull/7');
  assert.equal(execFileSync('git', ['--git-dir', bare, 'rev-parse', BRANCH], { encoding: 'utf8' }).trim(), git('rev-parse', BRANCH));
  assert.equal(refsIn(bare, 'refs/heads/main'), '');
  const argv = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').pop());
  assert.deepEqual(argv.slice(0, 8), ['pr', 'create', '--base', 'main', '--head', BRANCH, '--title', 'CSV export of invoices plus a billing helper.']);
});
