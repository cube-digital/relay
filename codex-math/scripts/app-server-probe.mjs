#!/usr/bin/env node
// Ask a running Codex (via `codex app-server --listen stdio://`) for the account's live usage data.
//
//   node codex-math/scripts/app-server-probe.mjs [--out codex-math/evidence/live] [--threads id1,id2,...] [--label before-luna-1]
//
// Sends initialize, account/read, account/rateLimits/read, account/usage/read (account-wide and, with
// --threads, per thread), model/list, experimentalFeature/list, config/read, then exits. Writes
// <out>/probe-<label|timestamp>.json with every request and response, plus notifications received.
// Redacts e-mails and the account/user ids beyond their first 6 characters; copies no tokens.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const out = resolve(opt('--out', 'codex-math/evidence/live'));
const label = opt('--label', new Date().toISOString().replace(/[:.]/g, '-'));
const threads = (opt('--threads', '') || '').split(',').filter(Boolean);
const codexBin = opt('--codex', 'codex');
mkdirSync(out, { recursive: true });

const child = spawn(codexBin, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'] });
const log = { startedAt: new Date().toISOString(), label, requests: [], responses: {}, notifications: [], stderrTail: '' };
let buf = '';
let nextId = 1;
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id);
      log.responses[p?.method ?? msg.id] = log.responses[p?.method ?? msg.id] ?? [];
      log.responses[p?.method ?? msg.id].push({ id: msg.id, params: p?.params, result: msg.result, error: msg.error });
      pending.delete(msg.id);
      p?.resolve(msg);
    } else if (msg.method) {
      log.notifications.push(msg);
    }
  }
});
child.stderr.on('data', (d) => {
  log.stderrTail = (log.stderrTail + d.toString()).slice(-4000);
});

function request(method, params = {}) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  log.requests.push({ id, method, params });
  return new Promise((resolve) => {
    pending.set(id, { method, params, resolve });
    child.stdin.write(JSON.stringify(msg) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ id, error: { message: 'timeout' } });
      }
    }, 60_000);
  });
}

const redact = (obj) =>
  JSON.parse(
    JSON.stringify(obj, (k, v) => {
      if (typeof v === 'string') {
        if (/^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(v)) return v.replace(/^(.).*(@.*)$/, '$1***$2');
        if (/^(accountId|userId|chatgptAccountId|chatgpt_account_id|chatgpt_user_id|user_id|account_id|email|id_token|access_token|refresh_token|OPENAI_API_KEY)$/i.test(k)) return v.slice(0, 6) + '…';
      }
      if (/token/i.test(k) && typeof v === 'string' && v.length > 20) return '[redacted]';
      return v;
    }),
  );

try {
  await request('initialize', { clientInfo: { name: 'relay-codex-math-probe', title: 'relay probe', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');
  await request('account/read', {});
  await request('account/rateLimits/read', {});
  await request('account/usage/read', {});
  for (const t of threads) await request('account/usage/read', { threadId: t });
  await request('model/list', {});
  await request('experimentalFeature/list', {});
  await request('config/read', {});
  await new Promise((r) => setTimeout(r, 1500)); // let rolling notifications arrive
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
}
log.finishedAt = new Date().toISOString();
const file = join(out, `probe-${label}.json`);
writeFileSync(file, JSON.stringify(redact(log), null, 1));
const rl = log.responses['account/rateLimits/read']?.[0];
const summary = rl?.result?.rateLimits
  ? `plan ${rl.result.rateLimits.planType} · primary ${JSON.stringify(rl.result.rateLimits.primary)} · secondary ${JSON.stringify(rl.result.rateLimits.secondary)} · credits ${JSON.stringify(rl.result.rateLimits.credits)} · reset credits ${JSON.stringify(rl.result.rateLimitResetCredits)}`
  : `rate limits: ${JSON.stringify(rl?.error ?? 'no response')}`;
console.log(`${file}\n${summary}`);
