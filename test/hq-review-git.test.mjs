import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { reviewOf } from '../lib/hq/review.mjs';
import { tempRepo } from './helpers.mjs';

test('the review counts tests from git between the run origin and the integration branch, whoever wrote them', () => {
  const { dir: repo, git } = tempRepo({ 'test/a.test.mjs': "test('one', () => {});\ntest('two', () => {});\n", 'lib/x.mjs': 'export const x = 1;\n' });
  const origin = git('rev-parse', 'HEAD');
  git('checkout', '-qb', 'relay/demo/integration');
  writeFileSync(join(repo, 'test/a.test.mjs'), "test('one', () => {});\n");
  mkdirSync(join(repo, 'tests'), { recursive: true });
  writeFileSync(join(repo, 'tests/flow.py'), 'def test_flow():\n    pass\n\ndef helper():\n    pass\n');
  writeFileSync(join(repo, 'test/b.test.mjs'), "describe('b', () => {\n  it('works', () => {});\n  it.skip('later', () => {});\n});\n");
  writeFileSync(join(repo, 'lib/x.mjs'), "export const x = 1;\ntest('not a test file', () => {});\n");
  git('add', '-A');
  git('commit', '-qm', 'lane work');
  git('checkout', '-q', 'main');

  const run = mkdtempSync(join(tmpdir(), 'relay-hq-review-git-'));
  writeFileSync(join(run, 'lane-a.report.md'), 'tests: +9 -9\n');
  writeFileSync(join(run, 'run.json'), JSON.stringify({ origin }));
  assert.deepEqual(reviewOf({ slug: 'demo' }, run, { repo }).tests, { added: 3, removed: 1 });

  rmSync(join(run, 'run.json'));
  assert.deepEqual(reviewOf({ slug: 'demo' }, run, { repo }).tests, { added: 9, removed: 9 });
});
