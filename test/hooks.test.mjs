import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runHook, tempRepo } from './helpers.mjs';

const relayHome = () => mkdtempSync(join(tmpdir(), 'relay-home-'));

test('retest guard: blocks an identical rerun on unchanged code, allows it after a change', () => {
  const { dir } = tempRepo({ 'src/a.py': 'x = 1\n' });
  const env = { RELAY_HOME: relayHome() };
  const call = (event, id) => runHook('retest-guard.mjs', { hook_event_name: event, cwd: dir, tool_use_id: id, tool_input: { command: 'pytest -q tests' }, tool_response: { stdout: '3 passed' } }, env);

  assert.equal(call('PreToolUse', 't1').code, 0);
  assert.equal(call('PostToolUse', 't1').code, 0);
  const again = call('PreToolUse', 't2');
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already ran .* on identical code/);
  assert.match(again.stderr, /3 passed/);

  writeFileSync(join(dir, 'src', 'a.py'), 'x = 2\n');
  assert.equal(call('PreToolUse', 't3').code, 0, 'a code change re-enables the run');
});

test('retest guard: ignores non-test commands and honours RELAY_RERUN=1', () => {
  const { dir } = tempRepo();
  const env = { RELAY_HOME: relayHome() };
  const run = (command, event, id) => runHook('retest-guard.mjs', { hook_event_name: event, cwd: dir, tool_use_id: id, tool_input: { command } }, env);
  run('go test ./...', 'PreToolUse', 'a');
  run('go test ./...', 'PostToolUse', 'a');
  assert.equal(run('RELAY_RERUN=1 go test ./...', 'PreToolUse', 'b').code, 0);
  assert.equal(run('git status', 'PreToolUse', 'c').code, 0);
  assert.equal(run('git status', 'PreToolUse', 'd').code, 0);
});

test('protect-tests: blocks edits to protected files in any worktree, allows the rest', () => {
  const { dir, git } = tempRepo({ 'tests/acceptance/export.test.ts': 'test()\n', 'src/a.ts': '' });
  mkdirSync(join(dir, '.relay'), { recursive: true });
  writeFileSync(join(dir, '.relay', 'protected-tests.txt'), '# comment\ntests/acceptance/**\n');
  const wt = join(dir, '.claude', 'worktrees', 'lane');
  git('worktree', 'add', '-q', wt, '-b', 'lane');

  const edit = (cwd, file_path) => runHook('protect-tests.mjs', { hook_event_name: 'PreToolUse', cwd, tool_name: 'Edit', tool_input: { file_path } });
  assert.equal(edit(dir, join(dir, 'tests/acceptance/export.test.ts')).code, 2);
  assert.equal(edit(wt, 'tests/acceptance/export.test.ts').code, 2, 'the list in the main checkout applies inside lane worktrees');
  assert.equal(edit(wt, 'src/a.ts').code, 0);

  const patch = '*** Begin Patch\n*** Update File: tests/acceptance/export.test.ts\n*** End Patch';
  assert.equal(runHook('protect-tests.mjs', { cwd: wt, tool_name: 'apply_patch', tool_input: { input: patch } }).code, 2);

  const shell = (command) => runHook('protect-tests.mjs', { cwd: wt, tool_name: 'Bash', tool_input: { command } });
  assert.equal(shell('npx vitest run tests/acceptance/export.test.ts').code, 0);
  assert.equal(shell("sed -i 's/a/b/' tests/acceptance/export.test.ts").code, 2);
});

test('session-start: injects the using-relay rules as additional context', () => {
  const out = runHook('session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { RELAY_HOME: relayHome() });
  assert.equal(out.code, 0);
  const json = JSON.parse(out.stdout);
  assert.equal(json.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(json.hookSpecificOutput.additionalContext, /<relay-rules>[\s\S]*Plan first/);
  assert.ok(json.hookSpecificOutput.additionalContext.length < 4000, 'bootstrap stays small');
});
