import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCli, tempRepo } from './helpers.mjs';

test('the business analyst joins a plan only when it is given the business documentation', () => {
  const { dir } = tempRepo({ 'README.md': '# demo\n', 'docs/business/brief.md': '# Billing\nCustomers export invoices.\n' });
  const env = { RELAY_HOME: mkdtempSync(join(tmpdir(), 'relay-home-')) };
  const at = (...extra) => {
    const r = runCli(['flow', 'at', '--flow', 'feature', '--slug', 'demo', 'plan.before', ...extra, '--json'], { cwd: dir, env });
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout);
  };

  const without = at();
  assert.deepEqual(without.pieces, []);
  assert.deepEqual(without.skipped.map((s) => [s.piece, s.kind]), [['requirements', 'input']]);

  const given = at('--docs', 'docs/business');
  assert.deepEqual(given.pieces.map((p) => p.piece), ['requirements']);
  const brief = readFileSync(given.pieces[0].brief, 'utf8');
  assert.match(brief, /business documentation at docs\/business/);
  assert.match(brief, /`Source: docs\/business`/);

  const wrong = at('--docs', 'docs/nowhere');
  assert.deepEqual(wrong.skipped.map((s) => [s.piece, s.kind]), [['requirements', 'requires']]);
});
