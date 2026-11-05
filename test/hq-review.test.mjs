import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('the review summary sums tests added and removed from lane reports and lists rulings, deferred findings and the last suite result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-hq-review-'));
  writeFileSync(join(dir, 'lane-a.report.md'), '# Lane a\ntests: +3 -1\nmore work\ntests: +4 -1\n');
  writeFileSync(join(dir, 'lane-b.report.md'), '# Lane b\ntests: +2 -0\n');
  writeFileSync(join(dir, 'lane-c.report.md'), '# Lane c\nno tests line here\n');
  writeFileSync(join(dir, 'ledger.md'), [
    '- 2026-11-05 10:00 wave 1: merged @ abc, suite pass',
    '- 2026-11-05 10:05 deferred minor: rename x',
    '- 2026-11-05 10:06 deferred: security-review: weak hash',
    '- 2026-11-05 10:10 wave 2: merged @ def, suite fail',
    '',
  ].join('\n'));

  const { reviewOf } = await import('../lib/hq/review.mjs');
  const r = reviewOf({ rulings: ['r1'] }, dir);
  assert.deepEqual(r.tests, { added: 6, removed: 1 });
  assert.deepEqual(r.deferred, ['rename x', 'security-review: weak hash']);
  assert.equal(r.openFindings, 2);
  assert.equal(r.suite, 'fail');
  assert.deepEqual(r.waves, ['wave 1: merged @ abc, suite pass', 'wave 2: merged @ def, suite fail']);
  assert.deepEqual(r.rulings, ['r1']);
  assert.equal(r.finalFindings, null);
});
