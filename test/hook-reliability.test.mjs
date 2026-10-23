import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { editedPaths } from '../lib/hookio.mjs';
import { isTestCommand } from '../lib/fingerprint.mjs';
import { ROOT, runHook, tempRepo } from './helpers.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'relay-reliability-'));
const invoke = (cwd, env, command, event = 'PreToolUse', id = command) => runHook('retest-guard.mjs', {
  cwd, hook_event_name: event, tool_use_id: id, tool_input: { command },
}, env);

test('Codex command patches protect updates, new files and move destinations through symlink paths', () => {
  const patch = '*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: tests/acceptance/a.ts\n*** Add File: tests/acceptance/new.ts\n*** End Patch';
  assert.deepEqual(editedPaths({ command: patch }), ['src/a.ts', 'tests/acceptance/new.ts', 'tests/acceptance/a.ts']);
  const { dir } = tempRepo();
  const alias = join(home(), 'alias');
  symlinkSync(dir, alias);
  mkdirSync(join(dir, '.relay'));
  writeFileSync(join(dir, '.relay/protected-tests.txt'), 'tests/acceptance/**\n');
  assert.equal(runHook('protect-tests.mjs', { cwd: alias, tool_name: 'apply_patch', tool_input: { command: patch } }).code, 2);
  assert.equal(runHook('protect-tests.mjs', { cwd: alias, tool_input: { file_path: join(alias, 'tests/acceptance/not-created.ts') } }).code, 2);
});

test('Node test flags and multiline commands are detected while watch commands remain exempt', () => {
  assert.equal(isTestCommand('node --test test/*.test.mjs'), true);
  assert.equal(isTestCommand('node --import tsx --test=tests/foo.ts'), true);
  assert.equal(isTestCommand('cd pkg-a\nnpm test'), true);
  assert.equal(isTestCommand('node --watch --test'), false);
  assert.equal(isTestCommand('node script.mjs --test'), false);
});

test('identical test commands in different execution directories have independent history', () => {
  const { dir } = tempRepo({ 'pkg-a/package.json': '{}', 'pkg-b/package.json': '{}' });
  const env = { RELAY_HOME: home() };
  const a = join(dir, 'pkg-a');
  const b = join(dir, 'pkg-b');
  assert.equal(invoke(a, env, 'npm test', 'PostToolUse').code, 0);
  assert.equal(invoke(b, env, 'npm test').code, 0);
  assert.equal(invoke(a, env, 'npm test').code, 2);
  const payload = { cwd: dir, hook_event_name: 'PreToolUse', tool_input: { command: 'npm test', workdir: b } };
  assert.equal(runHook('retest-guard.mjs', { ...payload, tool_input: { command: 'npm test', workdir: a } }, env).code, 2);
  assert.equal(runHook('retest-guard.mjs', payload, env).code, 0);
});

test('concurrent hook completions preserve every result without corrupting shared state', async () => {
  const { dir } = tempRepo();
  const env = { ...process.env, RELAY_HOME: home() };
  const commands = Array.from({ length: 24 }, (_, i) => `npm test -- case-${i}`);
  const results = await Promise.all(commands.map(command => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'hooks/retest-guard.mjs')], { env });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify({ cwd: dir, hook_event_name: 'PostToolUse', tool_use_id: command, tool_input: { command } }));
  })));
  assert.deepEqual(results, commands.map(() => ({ code: 0, stderr: '' })));
  const stateDir = join(env.RELAY_HOME, 'state');
  const stateFile = readdirSync(stateDir).find(name => name.endsWith('.json'));
  const state = JSON.parse(readFileSync(join(stateDir, stateFile), 'utf8'));
  assert.deepEqual(Object.values(state.runs).map(run => run.command).sort(), commands.sort());
});

test('a busy state lock fails open promptly and a dead owner can be recovered', () => {
  const { dir } = tempRepo();
  const env = { RELAY_HOME: home() };
  invoke(dir, env, 'npm test', 'PostToolUse');
  const stateDir = join(env.RELAY_HOME, 'state');
  const stateFile = join(stateDir, readdirSync(stateDir).find(name => name.endsWith('.json')));
  const lock = `${stateFile}.lock`;
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner'), String(process.pid));
  const before = Date.now();
  const busy = invoke(dir, env, 'npm test -- busy');
  assert.equal(busy.code, 0);
  assert.match(busy.stderr, /state lock timed out; allowing tool call/);
  assert.ok(Date.now() - before < 5000, 'lock contention is bounded');
  writeFileSync(join(lock, 'owner'), '2147483647');
  const recovered = invoke(dir, env, 'npm test -- recovered', 'PostToolUse');
  assert.equal(recovered.code, 0);
  assert.equal(recovered.stderr, '');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.deepEqual(Object.values(state.runs).map(run => run.command).sort(), ['npm test', 'npm test -- recovered']);
});

test('shell protection resolves direct write targets from tool workdir and subdirectories', () => {
  const { dir } = tempRepo({ 'tests/acceptance/a.test.mjs': 'test', 'src/keep.mjs': '' });
  const alias = join(home(), 'alias');
  symlinkSync(dir, alias);
  mkdirSync(join(dir, '.relay'));
  writeFileSync(join(dir, '.relay/protected-tests.txt'), 'tests/acceptance/**\n');
  const shell = (command, workdir = join(alias, 'tests/acceptance')) => runHook('protect-tests.mjs', { cwd: dir, tool_name: 'exec_command', tool_input: { command, workdir } });
  assert.equal(shell('rm a.test.mjs').code, 2);
  assert.equal(shell('rm -rf .', dir).code, 2);
  assert.equal(shell("printf 'replacement' > 'new test.mjs'").code, 2);
  assert.equal(shell('node --test a.test.mjs').code, 0);
  assert.equal(shell('rm ../../src/keep.mjs').code, 0);
  assert.equal(shell('cp a.test.mjs ../../src/copy.mjs').code, 0);
  assert.equal(shell('rm acceptance/a.test.mjs', join(alias, 'tests')).code, 2);
});

test('copy and move directory destinations protect their written basename without blocking unrelated siblings', () => {
  const { dir } = tempRepo({ 'tests/acceptance/a.test.mjs': 'test', 'src/keep.mjs': '', 'src/a.test.mjs': '', 'assets/tests/acceptance/new.test.mjs': '' });
  mkdirSync(join(dir, '.relay'));
  writeFileSync(join(dir, '.relay/protected-tests.txt'), 'tests/acceptance/**\n');
  const shell = command => runHook('protect-tests.mjs', { cwd: dir, tool_input: { command } });
  assert.equal(shell('cp src/keep.mjs .').code, 0);
  assert.equal(shell('mv src/keep.mjs .').code, 0);
  assert.equal(shell('cp tests/acceptance/a.test.mjs .').code, 0);
  assert.equal(shell('cp src/a.test.mjs tests/acceptance').code, 2);
  assert.equal(shell('mv src/a.test.mjs tests/acceptance').code, 2);
  assert.equal(shell('cp -R assets/tests .').code, 2);
  assert.equal(shell('mv assets/tests .').code, 2);
  assert.equal(shell('rm -rf .').code, 2);
});

test('a parsed write in another shell segment does not suppress protected-write fallback', () => {
  const { dir } = tempRepo({ 'tests/acceptance/a.test.mjs': 'test' });
  mkdirSync(join(dir, '.relay'));
  writeFileSync(join(dir, '.relay/protected-tests.txt'), 'tests/acceptance/**\n');
  const shell = command => runHook('protect-tests.mjs', { cwd: dir, tool_input: { command } });
  assert.equal(shell('find tests/acceptance/ -type f -exec rm {} +').code, 2);
  assert.equal(shell('printf start > run.log; find tests/acceptance/ -type f -exec rm {} +').code, 2);
  assert.equal(shell('printf start > run.log; cp tests/acceptance/a.test.mjs .').code, 0);
});
