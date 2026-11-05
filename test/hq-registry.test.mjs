import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyRegistryOp, listRepos, readRegistry, registryPath } from '../lib/hq/registry.mjs';
import { runHook, tempRepo } from './helpers.mjs';

test('session-start leaves the registry alone; only the add op registers a git repository', () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-hq-home-'));
  process.env.RELAY_HOME = home;
  const { dir } = tempRepo({ 'README.md': '# demo\n', 'src/a.txt': 'a\n' });

  const first = runHook('session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup', cwd: dir }, { RELAY_HOME: home });
  assert.equal(first.code, 0);
  assert.match(JSON.parse(first.stdout).hookSpecificOutput.additionalContext, /<relay-rules>/);
  assert.equal(existsSync(registryPath()), false);

  const reg = readRegistry();
  const { path } = applyRegistryOp(reg, { op: 'add', path: join(dir, 'src'), project: 'Polaris' });
  assert.equal(path, realpathSync(dir));
  assert.deepEqual(reg.projects, [{ id: 'polaris', name: 'Polaris', repos: [path] }]);
  assert.equal(reg.repos[path].hidden, false);

  applyRegistryOp(reg, { op: 'create-project', name: 'Other' });
  applyRegistryOp(reg, { op: 'delete-project', id: 'polaris' });
  assert.deepEqual(reg.projects.map((p) => p.id), ['other']);
  assert.ok(reg.repos[path]);
  assert.equal(listRepos(reg)[0].project, null);
  assert.throws(() => applyRegistryOp(reg, { op: 'delete-project', id: 'polaris' }), (e) => e.status === 400);

  const plain = mkdtempSync(join(tmpdir(), 'relay-not-git-'));
  assert.throws(() => applyRegistryOp(reg, { op: 'add', path: plain }), (e) => e.status === 400 && /not a git repository/.test(e.message));
  assert.deepEqual(Object.keys(reg.repos), [path]);
});
