// Acceptance test for the pr-hygiene routine: finished-plan leftovers and the gh-not-connected finding.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { copyFixture, runCli, tempRepo } from './helpers.mjs';

test("pr-hygiene reports a finished plan's leftovers once, forgets a resolved one, and reports gh once", () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-pr-hygiene-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(bin, 'git'));
  const env = { RELAY_HOME: home, HOME: home, PATH: bin };

  const { dir, git } = tempRepo();
  const plan = copyFixture('plan-basic.md', dir);
  git('branch', 'relay/billing-export/integration');
  const wt = join(dir, '.claude', 'worktrees', 'relay-billing-export-a');
  git('worktree', 'add', '-q', '-b', 'relay/billing-export/lane-a', wt);
  const ledgerDir = join(dir, '.relay', 'runs', 'billing-export');
  mkdirSync(ledgerDir, { recursive: true });
  writeFileSync(join(ledgerDir, 'ledger.md'),
    `# relay ledger — plan: ${plan}\n- 2026-10-20 10:00 start: wave 1\n- 2026-10-20 12:00 plan: complete (relay/billing-export/integration @ abc1234)\n`);

  assert.equal(runCli(['hq', 'add', dir], { env }).code, 0);
  const enable = runCli(['routine', 'enable', 'pr-hygiene', '--harness', 'claude', '--repo', dir], { env });
  assert.equal(enable.code, 0);
  const id = enable.stdout.match(/pending: (\S+)/)[1];

  const run1 = runCli(['routine', 'run', id], { env });
  assert.equal(run1.code, 0);
  assert.equal(run1.stdout.split('\n')[0], `RELAY_ROUTINE: ${id} · 3 new`);
  assert.match(run1.stdout, /branch -D .*relay\/billing-export\/lane-a/);
  assert.ok(run1.stdout.split('\n').some((l) => /branch -D /.test(l) && l.includes("'relay/billing-export/lane-a'")), 'branch names are single-quoted');
  assert.match(run1.stdout, /relay worktrees clean .*billing-export/);
  assert.match(run1.stdout, /gh is not installed/);

  const run2 = runCli(['routine', 'run', id], { env });
  assert.equal(run2.stdout.split('\n')[0], `RELAY_ROUTINE: ${id} · nothing new`);

  git('worktree', 'remove', wt);
  const run3 = runCli(['routine', 'run', id], { env });
  assert.equal(run3.stdout.split('\n')[0], `RELAY_ROUTINE: ${id} · nothing new`);

  git('worktree', 'add', '-q', wt, 'relay/billing-export/lane-a');
  const run4 = runCli(['routine', 'run', id], { env });
  assert.equal(run4.stdout.split('\n')[0], `RELAY_ROUTINE: ${id} · 1 new`);
  assert.match(run4.stdout, /relay worktrees clean/);
  assert.doesNotMatch(run4.stdout, /gh is not installed/);
});
