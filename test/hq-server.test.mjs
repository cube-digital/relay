import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addRepo } from '../lib/hq/registry.mjs';
import { createHqServer, listen } from '../lib/hq/server.mjs';
import { runCli, tempRepo } from './helpers.mjs';

function call(port, { method = 'GET', path, host = `127.0.0.1:${port}`, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { Host: host, ...headers } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('the server refuses a missing token, a foreign Host or Origin and a non-JSON POST, and answers a correct call', async () => {
  process.env.RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-hq-server-'));
  const token = 'ab'.repeat(32);
  const server = createHqServer({ token });
  const port = await listen(server, { port: 0 });
  try {
    const auth = { Authorization: `Bearer ${token}` };
    assert.equal((await call(port, { path: '/api/home' })).status, 401);
    assert.equal((await call(port, { path: '/api/home', headers: { Authorization: `Bearer ${'cd'.repeat(32)}` } })).status, 401);
    assert.equal((await call(port, { path: '/api/home', host: `evil.example:${port}`, headers: auth })).status, 403);
    assert.equal((await call(port, { path: '/api/home', headers: { ...auth, Origin: 'http://evil.example' } })).status, 403);
    assert.equal((await call(port, { method: 'POST', path: '/api/registry', headers: { ...auth, 'Content-Type': 'text/plain' }, body: '{"op":"hide"}' })).status, 415);
    const ok = await call(port, { path: '/api/home', headers: { ...auth, Origin: `http://127.0.0.1:${port}` } });
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(JSON.parse(ok.body).projects));
    assert.equal(ok.headers['access-control-allow-origin'], undefined);
    // Every file the page loads is served: a missing module leaves the whole page blank.
    const ui = new URL('../lib/hq/ui/', import.meta.url);
    const refs = new Set(['/']);
    for (const m of readFileSync(new URL('index.html', ui), 'utf8').matchAll(/(?:src|href)="(\/[^"#]+)"/g)) refs.add(m[1]);
    for (const f of readdirSync(ui).filter((n) => n.endsWith('.js'))) {
      for (const m of readFileSync(new URL(f, ui), 'utf8').matchAll(/from '\.\/([^']+)'/g)) refs.add(`/${m[1]}`);
    }
    for (const path of refs) assert.equal((await call(port, { path })).status, 200, `${path} is not served`);
    // Native replaceChildren/append render arrays as "a,b" and null as "null"; only dom.js (fill) may call them.
    const native = readdirSync(ui).filter((n) => n.endsWith('.js') && n !== 'dom.js' && /\.(replaceChildren|append)\(/.test(readFileSync(new URL(n, ui), 'utf8')));
    assert.deepEqual(native, []);
  } finally {
    server.close();
  }
});

test('/api/open refuses paths outside the registered repositories (outside, symlink escape, sibling prefix, relative)', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'relay-hq-open-')));
  process.env.RELAY_HOME = join(base, 'home');
  const repo = join(base, 'repo');
  const evil = join(base, 'repo-evil');
  mkdirSync(repo);
  mkdirSync(evil);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  symlinkSync(evil, join(repo, 'escape'));
  addRepo(repo);
  const token = 'ab'.repeat(32);
  const server = createHqServer({ token });
  const port = await listen(server, { port: 0 });
  try {
    const open = async (path) => (await call(port, { method: 'POST', path: '/api/open', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })).status;
    assert.equal(await open(tmpdir()), 403);
    assert.equal(await open(join(repo, 'escape')), 403);
    assert.equal(await open(evil), 403);
    assert.equal(await open('repo'), 400);
  } finally {
    server.close();
  }
});

const restore = (key, value) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

test('the routines API lists instances with their next run, Run now runs the check, and a new passive finding reaches Home', async () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-hq-routines-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(bin, 'git'));
  const saved = { PATH: process.env.PATH, RELAY_HOME: process.env.RELAY_HOME };
  process.env.RELAY_HOME = home;
  process.env.PATH = bin;
  const token = 'ab'.repeat(32);
  let server;
  try {
    const { dir } = tempRepo();
    addRepo(dir);
    const env = { RELAY_HOME: home, PATH: bin };
    assert.equal(runCli(['routine', 'enable', 'pr-hygiene', '--harness', 'claude', '--repo', dir], { env }).code, 0);
    const id = JSON.parse(readFileSync(join(home, 'routines', 'enabled.json'), 'utf8')).instances[0].id;
    assert.equal(runCli(['routine', 'confirm', id, '--task-id', 'relay-x'], { env }).code, 0);
    server = createHqServer({ token });
    const port = await listen(server, { port: 0 });
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const get = async (path) => JSON.parse((await call(port, { path, headers })).body);

    const before = Date.now();
    const overview = await get('/api/routines');
    assert.equal(overview.instances.length, 1);
    assert.equal(overview.instances[0].id, id);
    assert.ok(Date.parse(overview.instances[0].nextRun) > before);

    const run = await call(port, { method: 'POST', path: `/api/routines/${id}/run`, headers, body: '{}' });
    assert.equal(run.status, 200);
    const launchId = JSON.parse(run.body).launch.id;
    let launch;
    const deadline = Date.now() + 15000;
    do {
      await new Promise((r) => setTimeout(r, 200));
      launch = await get(`/api/launches/${launchId}`);
    } while (launch.status === 'running' && Date.now() < deadline);
    assert.equal(launch.status, 'done');
    assert.equal(launch.harness, 'relay');
    assert.equal(launch.model, null);

    const detail = await get(`/api/routines/${id}`);
    assert.equal(detail.runs.length, 1);
    assert.deepEqual(detail.findings.map((f) => f.kind), ['gh-not-connected']);

    const attention = (await get('/api/home')).attention.filter((a) => a.kind === 'routine');
    assert.deepEqual(attention.map((a) => a.text), ['gh is not installed']);
  } finally {
    process.env.PATH = saved.PATH;
    restore('RELAY_HOME', saved.RELAY_HOME);
    server?.close();
  }
});

test('HQ routine enable/disable on Codex touch only relay-* folders, and dismissing a finding takes it off Home', async () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-hq-codex-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(bin, 'git'));
  const autos = join(home, '.codex', 'automations');
  mkdirSync(join(autos, 'user-own'), { recursive: true });
  writeFileSync(join(autos, 'user-own', 'automation.toml'), 'name = "mine"\n');
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME, RELAY_HOME: process.env.RELAY_HOME };
  process.env.RELAY_HOME = join(home, 'relay');
  process.env.HOME = home;
  process.env.PATH = bin;
  const token = 'ab'.repeat(32);
  let server;
  try {
    const { dir } = tempRepo();
    addRepo(dir);
    server = createHqServer({ token });
    const port = await listen(server, { port: 0 });
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const post = (path, body) => call(port, { method: 'POST', path, headers, body: JSON.stringify(body) });
    const get = async (path) => JSON.parse((await call(port, { path, headers })).body);

    const rid = (await get('/api/routines')).scopes.repos[0].rid;
    const enabled = await post('/api/routines', { routine: 'pr-hygiene', harness: 'codex', scope: 'repo', rid, confirm: true });
    assert.equal(enabled.status, 200, enabled.body);
    const id = JSON.parse(enabled.body).instance;
    assert.deepEqual(readdirSync(autos).sort(), ['relay-' + id.replace('@', '-'), 'user-own']);

    const run = await post(`/api/routines/${id}/run`, {});
    assert.equal(run.status, 200);
    const deadline = Date.now() + 15000;
    let attention;
    do {
      await new Promise((r) => setTimeout(r, 200));
      attention = (await get('/api/home')).attention.filter((a) => a.kind === 'routine');
    } while (attention.length === 0 && Date.now() < deadline);
    assert.deepEqual(attention.map((a) => a.text), ['gh is not installed']);

    const finding = (await get(`/api/routines/${id}`)).findings[0];
    assert.equal((await post(`/api/routines/${id}/dismiss`, { finding: finding.id })).status, 200);
    assert.deepEqual((await get('/api/home')).attention.filter((a) => a.kind === 'routine'), []);

    assert.equal((await post(`/api/routines/${id}/disable`, {})).status, 200);
    assert.deepEqual(readdirSync(autos), ['user-own']);
    assert.equal(readFileSync(join(autos, 'user-own', 'automation.toml'), 'utf8'), 'name = "mine"\n');
  } finally {
    process.env.PATH = saved.PATH;
    process.env.HOME = saved.HOME;
    restore('RELAY_HOME', saved.RELAY_HOME);
    server?.close();
  }
});
