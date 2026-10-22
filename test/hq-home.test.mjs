// Acceptance test for the HQ Home API wiring: /api/home carries today, running lanes and the ring.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addRepo } from '../lib/hq/registry.mjs';
import { createHqServer, listen } from '../lib/hq/server.mjs';
import { ROOT, copyFixture, tempRepo } from './helpers.mjs';

const get = (port, token, path) =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${token}` } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end();
  });

const restore = (key, value) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

const stamp = (d) => d.toISOString().slice(0, 16).replace('T', ' ');

test('GET /api/home returns today rows with START, running lane segments matching the board, and a 14-item ring', async () => {
  const saved = { RELAY_HOME: process.env.RELAY_HOME, HOME: process.env.HOME };
  process.env.RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-hq-home-'));
  process.env.HOME = mkdtempSync(join(tmpdir(), 'relay-hq-fakehome-'));
  const { dir, git } = tempRepo();
  copyFixture('plan-basic.md', dir);
  git('add', '-A');
  git('commit', '-qm', 'plan');
  const runs = join(dir, '.relay', 'runs', 'billing-export');
  mkdirSync(runs, { recursive: true });
  // fixed offsets from the start of the local day, so the events stay "today" at any time of day (even 00:10)
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  writeFileSync(
    join(runs, 'ledger.md'),
    `- ${stamp(new Date(midnight.getTime() + 60000))} start: 6 tasks, 4 lanes, 2 waves\n- ${stamp(new Date(midnight.getTime() + 5 * 60000))} Lane a: T1 committed\n`,
  );
  addRepo(dir);
  const token = 'ab'.repeat(32);
  const server = createHqServer({ token });
  const port = await listen(server, { port: 0 });
  try {
    const home = (await get(port, token, '/api/home')).body;
    assert.ok(Array.isArray(home.today), 'home.today is missing');
    assert.deepEqual(home.today.map((r) => r.at), home.today.map((r) => r.at).sort());
    assert.equal(home.today.filter((r) => r.tag === 'START').length, 1);

    assert.equal(home.running.plans.length, 1);
    const plan = home.running.plans[0];
    const detail = (await get(port, token, `/api/repos/${plan.rid}/plans/billing-export`)).body;
    assert.equal(plan.kpis.green, detail.board.green);
    assert.equal(plan.kpis.total, detail.board.totals.tasks);

    const roles = readdirSync(join(ROOT, 'roles'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => readFileSync(join(ROOT, 'roles', f), 'utf8'));
    const field = (k) => new Set(roles.map((t) => new RegExp(`^${k}: (.+)$`, 'm').exec(t)?.[1]));
    const segments = Object.values(plan.groups).flat();
    assert.ok(segments.length > 0);
    assert.ok(segments.every((s) => field('title').has(s.title) && field('kind').has(s.kind)), JSON.stringify(segments));

    assert.equal(home.ring.length, 14);
  } finally {
    server.close();
    restore('RELAY_HOME', saved.RELAY_HOME);
    restore('HOME', saved.HOME);
  }
});
