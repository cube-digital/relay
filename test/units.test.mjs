import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStale, levelFor, parseCodexRateLimits } from '../lib/budget.mjs';
import { parseFrontmatter } from '../lib/frontmatter.mjs';
import { matchesAny } from '../lib/glob.mjs';
import { shellWritesTo } from '../lib/guards.mjs';
import { commandOf, editedPaths } from '../lib/hookio.mjs';
import { isTestCommand } from '../lib/fingerprint.mjs';
import { loadRouting } from '../lib/routing.mjs';

const budget = loadRouting().budget;

test('frontmatter: lists, numbers, booleans, quoted strings', () => {
  const { data, body } = parseFrontmatter('---\nname: x\ntools: Read, Grep\nmaxTurns: 20\nreadonly: true\ndescription: "a: b"\n---\nBody\n');
  assert.deepEqual(data, { name: 'x', tools: ['Read', 'Grep'], maxTurns: 20, readonly: true, description: 'a: b' });
  assert.equal(body, 'Body\n');
});

test('budget levels follow the 5h and 7d thresholds', () => {
  assert.equal(levelFor({}, budget), 'unknown');
  assert.equal(levelFor({ fiveHour: { percentUsed: 59.9 } }, budget), 'normal');
  assert.equal(levelFor({ fiveHour: { percentUsed: 60 } }, budget), 'tight');
  assert.equal(levelFor({ fiveHour: { percentUsed: 10 }, sevenDay: { percentUsed: 81 } }, budget), 'tight');
  assert.equal(levelFor({ fiveHour: { percentUsed: 85 } }, budget), 'critical');
  assert.equal(levelFor({ sevenDay: { percentUsed: 96 } }, budget), 'critical');
});

test('a snapshot is stale when old or when its window already reset', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  assert.equal(isStale({ updatedAt: '2026-10-19T11:00:00Z' }, 360, now), false);
  assert.equal(isStale({ updatedAt: '2026-10-19T01:00:00Z' }, 360, now), true);
  assert.equal(isStale({ updatedAt: '2026-10-19T11:00:00Z', fiveHour: { percentUsed: 80, resetsAt: '2026-10-19T11:30:00Z' } }, 360, now), true);
});

test('codex rollout parsing reads the last rate_limits payload', () => {
  const lines = [
    JSON.stringify({ timestamp: '2026-10-19T10:00:00Z', payload: { rate_limits: { primary: { used_percent: 10 } } } }),
    JSON.stringify({ timestamp: '2026-10-19T11:00:00Z', payload: { rate_limits: { primary: { used_percent: 42.37, resets_in_seconds: 600 }, secondary: { used_percent: 12 } } } }),
    JSON.stringify({ timestamp: '2026-10-19T11:01:00Z', payload: { type: 'other' } }),
  ].join('\n');
  const snap = parseCodexRateLimits(lines);
  assert.equal(snap.fiveHour.percentUsed, 42.4);
  assert.equal(snap.fiveHour.resetsAt, '2026-10-19T11:10:00.000Z');
  assert.equal(snap.sevenDay.percentUsed, 12);
});

test('test commands are recognised; watch mode and non-tests are not', () => {
  for (const c of ['pytest -q tests/x.py', 'npx vitest run src/a.test.ts', 'pnpm test', 'go test ./...', 'cargo test foo', 'npm run test -- --runInBand']) {
    assert.ok(isTestCommand(c), c);
  }
  for (const c of ['vitest --watch', 'npm run test:watch', 'ls tests', 'git status', 'cat pytest.ini']) {
    assert.ok(!isTestCommand(c), c);
  }
});

test('commandOf unwraps Codex argv arrays', () => {
  assert.equal(commandOf({ command: 'pytest -q' }), 'pytest -q');
  assert.equal(commandOf({ command: ['bash', '-lc', 'pytest -q'] }), 'pytest -q');
  assert.equal(commandOf({ command: ['pytest', '-q'] }), 'pytest -q');
});

test('editedPaths reads Claude edit tools and Codex apply_patch', () => {
  assert.deepEqual(editedPaths({ file_path: 'src/a.ts' }), ['src/a.ts']);
  const patch = '*** Begin Patch\n*** Update File: tests/acc/a.test.ts\n@@\n-x\n+y\n*** Add File: src/new.ts\n+z\n*** End Patch';
  assert.deepEqual(editedPaths({ input: patch }), ['tests/acc/a.test.ts', 'src/new.ts']);
});

test('protected globs match repo-relative paths', () => {
  assert.ok(matchesAny('tests/acceptance/export.test.ts', ['tests/acceptance/**']));
  assert.ok(matchesAny('src/export/csv.test.ts', ['src/**/*.test.ts']));
  assert.ok(!matchesAny('src/export/csv.ts', ['src/**/*.test.ts']));
  assert.ok(matchesAny('tests/a.py', ['tests/']));
});

test('running a protected test is allowed, writing to it from the shell is not', () => {
  const p = 'tests/acceptance/export.test.ts';
  assert.equal(shellWritesTo(`npx vitest run ${p} 2>&1 | tail -20`, p), false);
  assert.equal(shellWritesTo(`sed -i 's/401/200/' ${p}`, p), true);
  assert.equal(shellWritesTo(`echo "" > ${p}`, p), true);
  assert.equal(shellWritesTo(`git checkout -- ${p}`, p), true);
  assert.equal(shellWritesTo('sed -i s/a/b/ src/other.ts', p), false);
});
