import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addRepo } from '../lib/hq/registry.mjs';
import { ridOf } from '../lib/hq/repo.mjs';
import { createHqServer, listen } from '../lib/hq/server.mjs';
import { ROOT, tempRepo } from './helpers.mjs';

function post(port, token, path, body) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path, headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('a New plan from HQ passes the business documentation path to /relay:plan, and only a path inside the repository', async () => {
  process.env.RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-hq-docs-'));
  const stub = join(ROOT, 'test', 'fixtures', 'stub-harness.mjs');
  chmodSync(stub, 0o755);
  const saved = process.env.RELAY_CLAUDE_BIN;
  process.env.RELAY_CLAUDE_BIN = stub;
  const { dir } = tempRepo({ 'README.md': '# demo\n', 'docs/business/brief.md': '# Billing\n' });
  const rid = ridOf(addRepo(dir));
  const token = 'ab'.repeat(32);
  const server = createHqServer({ token });
  const port = await listen(server, { port: 0 });
  try {
    const preview = (businessDocs) => post(port, token, '/api/launches/preview', { action: 'plan', rid, harness: 'claude', goal: 'export invoices', businessDocs });
    const good = (await preview('docs/business')).body;
    assert.deepEqual(good.guards.errors, []);
    assert.match(good.command.display, /\/relay:plan --unattended --business-docs docs\/business export invoices/);
    const bad = (await preview('docs/nowhere')).body;
    assert.ok(bad.guards.errors.includes('business docs must be a path inside the repository'));
  } finally {
    server.close();
    if (saved === undefined) delete process.env.RELAY_CLAUDE_BIN;
    else process.env.RELAY_CLAUDE_BIN = saved;
  }
});
