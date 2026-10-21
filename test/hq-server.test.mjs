import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addRepo } from '../lib/hq/registry.mjs';
import { createHqServer, listen } from '../lib/hq/server.mjs';

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
