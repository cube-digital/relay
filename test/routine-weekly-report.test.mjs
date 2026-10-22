// Acceptance test for the weekly-report routine: the report, and the For you block it asks for.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT, copyFixture, runCli, tempRepo } from './helpers.mjs';

test('weekly-report lists the week and asks for suggestions within its limit, except from HQ Run now', () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-weekly-'));
  const env = { RELAY_HOME: home, HOME: home };
  const { dir } = tempRepo();
  copyFixture('plan-basic.md', dir);
  assert.equal(runCli(['hq', 'add', dir, '--project', 'Polaris'], { env }).code, 0);

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const ledgerDir = join(dir, '.relay', 'runs', 'billing-export');
  mkdirSync(ledgerDir, { recursive: true });
  writeFileSync(join(ledgerDir, 'ledger.md'), [
    '# relay ledger — plan: billing-export',
    '',
    `- ${stamp} start: wave 1`,
    `- ${stamp} Ruling: kept RFC 4180 quoting — the spec says so — low`,
    `- ${stamp} plan: complete (relay/billing-export/integration @ abc1234)`,
    '',
  ].join('\n'));

  const repo = realpathSync(dir);
  const base = Date.now() - 3600_000;
  for (let i = 0; i < 360; i++) {
    const id = `20260101-${String(i).padStart(6, '0')}-${i.toString(16).padStart(4, '0')}`;
    const launchDir = join(home, 'hq', 'launches', id);
    mkdirSync(launchDir, { recursive: true });
    const startedAt = new Date(base - i * 600_000).toISOString();
    writeFileSync(join(launchDir, 'launch.json'), JSON.stringify({
      id, action: 'skill', repo, harness: 'claude', model: 'haiku',
      argv: ['-p', `Use the skill-${i % 120} skill. go`], startedAt, pid: null,
    }));
    writeFileSync(join(launchDir, 'result.json'), JSON.stringify({ status: 'done', endedAt: startedAt }));
  }

  assert.equal(runCli(['routine', 'enable', 'weekly-report', '--harness', 'claude', '--all'], { env }).code, 0);

  const first = runCli(['routine', 'run', 'weekly-report@all'], { env });
  assert.equal(first.code, 0);
  const out = first.stdout;
  const match = /· 0 new · (.+\.md)$/.exec(out.split('\n')[0]);
  assert.notEqual(match, null, out.split('\n')[0]);
  const report = readFileSync(match[1], 'utf8');
  assert.match(report, /^- Plans completed: .*billing-export/m);
  assert.ok(report.includes('kept RFC 4180 quoting'));
  assert.match(report, /^\| .*skill.* \|$/m);
  assert.ok(out.includes('For you:'));
  const ask = JSON.parse(readFileSync(join(ROOT, 'routines', 'weekly-report.json'), 'utf8')).judgment.ask;
  assert.ok(out.slice(out.indexOf('For you:')).length <= 6000 + ask.length + 300);

  const second = runCli(['routine', 'run', 'weekly-report@all', '--via', 'hq'], { env });
  assert.equal(second.code, 0);
  assert.ok(!second.stdout.includes('For you:'));
  const match2 = /· 0 new · (.+\.md)$/.exec(second.stdout.split('\n')[0]);
  assert.notEqual(match2, null, second.stdout.split('\n')[0]);
  assert.ok(readFileSync(match2[1], 'utf8').includes('suggestions come with the scheduled run'));

  // a later HQ run on the same day keeps the suggestions the session noted
  const noted = runCli(['routine', 'note', 'weekly-report@all'], { env, input: 'Retire skill-7: unused.' });
  assert.equal(noted.code, 0, noted.stderr);
  const third = runCli(['routine', 'run', 'weekly-report@all', '--via', 'hq'], { env });
  assert.equal(third.code, 0);
  assert.ok(readFileSync(match2[1], 'utf8').includes('Retire skill-7: unused.'));
});
