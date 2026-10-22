// POST /api/plans/merged validation and effect, and the "plan: merged" ledger line read by pr-hygiene and the recos recheck.

import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addRepo } from '../lib/hq/registry.mjs';
import { recosView } from '../lib/hq/recos-state.mjs';
import { ridOf } from '../lib/hq/repo.mjs';
import { createHqServer, listen } from '../lib/hq/server.mjs';
import { check } from '../lib/routines/pr-hygiene.mjs';
import { copyFixture, runCli, tempRepo } from './helpers.mjs';
import { recosFixture } from './recos-fixture.mjs';

const token = 'ab'.repeat(32);
function call(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, (res) => {
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

// A branch commit the current branch lacks: no ancestor to find, as after a squash merge.
function commitOn(git, branch) {
  git('checkout', '-q', branch);
  git('commit', '-q', '--allow-empty', '-m', 'work');
  git('checkout', '-q', 'main');
}

test('POST /api/plans/merged refuses a bad slug and an incomplete plan, and a complete plan gets a merged ledger line and leaves attention', async () => {
  process.env.RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-hq-merged-'));
  const { dir, git } = tempRepo();
  const planPath = copyFixture('plan-basic.md', dir);
  git('add', '-A');
  git('commit', '-qm', 'plan');
  const relay = (...args) => assert.equal(runCli(args, { cwd: dir }).code, 0);
  relay('ledger', planPath, 'start: 6 tasks, 4 lanes, 2 waves');
  relay('worktrees', 'sync', planPath, '--wave', '1');
  const rid = ridOf(addRepo(dir));
  const ledger = join(dir, '.relay', 'runs', 'billing-export', 'ledger.md');
  const server = createHqServer({ token });
  const port = await listen(server, { port: 0 });
  try {
    assert.equal((await call(port, 'POST', '/api/plans/merged', { rid, slug: '../x' })).status, 400);

    const before = readFileSync(ledger, 'utf8');
    assert.equal((await call(port, 'POST', '/api/plans/merged', { rid, slug: 'billing-export' })).status, 409);
    assert.equal(readFileSync(ledger, 'utf8'), before);

    const int = JSON.parse(readFileSync(join(dir, '.relay', 'lanes', 'active.json'), 'utf8')).integration.worktree;
    git('-C', int, 'commit', '-q', '--allow-empty', '-m', 'T1: work');
    relay('ledger', planPath, 'plan: complete (relay/billing-export/integration @ abc)');
    const ready = async () => (await call(port, 'GET', '/api/home')).json.attention.some((a) => a.kind === 'ready-to-merge' && a.plan === 'billing-export');
    assert.equal(await ready(), true);
    assert.equal((await call(port, 'POST', '/api/plans/merged', { rid, slug: 'billing-export' })).status, 200);
    assert.match(readFileSync(ledger, 'utf8'), /^- .* plan: merged \(.+\)$/m);
    assert.equal(await ready(), false);
  } finally {
    server.close();
  }
});

test('a "plan: merged" ledger line makes a finished plan count as merged for pr-hygiene and the recos relay-branches recheck', async () => {
  const fx = recosFixture();
  try {
    commitOn(fx.git, 'relay/demo/integration'); // integration is no longer an ancestor of HEAD
    const repos = [{ path: fx.repo, rid: fx.rid, name: 'demo' }];
    const branchFindings = async () => (await check({ repos })).findings.filter((f) => f.kind === 'relay-branches');
    const recoPresent = () => recosView({ maxAgeMs: 0 }).recos.some((r) => r.id.startsWith(`repos:${fx.rid}:relay-branches#`));
    assert.deepEqual(await branchFindings(), []);
    assert.equal(recoPresent(), false);

    appendFileSync(join(fx.repo, '.relay', 'runs', 'demo', 'ledger.md'), '- 2026-10-20 09:50 plan: merged (squashed in a PR)\n');
    assert.equal((await branchFindings()).length, 1);
    assert.equal(recoPresent(), true);
  } finally {
    fx.restore();
  }
});
