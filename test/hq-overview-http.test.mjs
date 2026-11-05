// The Overview HTTP routes: gate and id validation on every new endpoint, and sidebar/overview agreement over a real repository.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addRepo } from '../lib/hq/registry.mjs';
import { ridOf } from '../lib/hq/repo.mjs';
import { createHqServer, listen } from '../lib/hq/server.mjs';
import { copyFixture, runCli, tempRepo } from './helpers.mjs';

const token = 'ab'.repeat(32);
function call(port, method, path, { body, auth = true, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...headers };
    const req = request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function blockedBillingRepo() {
  process.env.RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-hq-overview-http-'));
  const { dir, git } = tempRepo();
  const planPath = copyFixture('plan-basic.md', dir);
  git('add', '-A');
  git('commit', '-qm', 'plan');
  const relay = (...args) => assert.equal(runCli(args, { cwd: dir }).code, 0);
  relay('ledger', planPath, 'start: 6 tasks, 4 lanes, 2 waves');
  relay('worktrees', 'sync', planPath, '--wave', '1');
  relay('ledger', planPath, 'Lane b: T4 BLOCKED, needs a decision on the README section');
  return ridOf(addRepo(dir, { project: 'Billing' }));
}

const LAUNCH = '20260101-000000-aaaa';

test('every new endpoint keeps the token and Origin checks and validates its ids', async () => {
  const rid = blockedBillingRepo();
  const server = createHqServer({ token });
  const port = await listen(server, { port: 0 });
  const endpoints = [
    ['GET', '/api/sidebar'],
    ['GET', '/api/overview?project=all'],
    ['POST', '/api/plans/answer', { rid, slug: 'billing-export', text: 'x' }],
    ['POST', `/api/launches/${LAUNCH}/retry`, {}],
    ['POST', '/api/plans/pr', { rid, slug: 'billing-export' }],
    ['POST', '/api/plans/merge', { rid, slug: 'billing-export' }],
  ];
  try {
    const noToken = await Promise.all(endpoints.map(([m, p, b]) => call(port, m, p, { body: b, auth: false })));
    assert.deepEqual(noToken.map((r) => r.status), [401, 401, 401, 401, 401, 401]);
    const evil = await Promise.all(endpoints.map(([m, p, b]) => call(port, m, p, { body: b, headers: { Origin: 'http://evil.example' } })));
    assert.deepEqual(evil.map((r) => r.status), [403, 403, 403, 403, 403, 403]);

    const bad = await Promise.all(['answer', 'pr', 'merge'].map((a) => call(port, 'POST', `/api/plans/${a}`, { body: { rid, slug: '../x', text: 'x' } })));
    assert.deepEqual(bad.map((r) => r.status), [400, 400, 400]);
    assert.equal((await call(port, 'GET', '/api/overview?project=../x')).status, 400);
    assert.equal((await call(port, 'POST', `/api/launches/${LAUNCH}/retry`, { body: {} })).status, 404);
  } finally {
    server.close();
  }
});

test('GET /api/sidebar and GET /api/overview agree on needs counts, and plan detail carries a run ledger', async () => {
  const rid = blockedBillingRepo();
  const server = createHqServer({ token });
  const port = await listen(server, { port: 0 });
  try {
    const side = (await call(port, 'GET', '/api/sidebar')).json;
    const billing = (await call(port, 'GET', '/api/overview?project=billing')).json;
    const all = (await call(port, 'GET', '/api/overview')).json;
    assert.equal(billing.needs.length, 1);
    assert.equal(side.projects.find((p) => p.id === 'billing').needs, billing.needs.length);
    assert.equal(side.all.needs, all.needs.length);
    assert.equal(side.repos.find((r) => r.rid === rid).project, 'Billing');

    const detail = await call(port, 'GET', `/api/repos/${rid}/plans/billing-export`);
    assert.equal(detail.status, 200);
    assert.equal(Array.isArray(detail.json.run.ledger), true);
  } finally {
    server.close();
  }
});
