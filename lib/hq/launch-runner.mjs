#!/usr/bin/env node
// One relay HQ launch: runs the harness command with its output going to out.log
// (inherited from launches.mjs) and writes result.json when it ends. Started
// detached, so it leads the launch's process group: a stop signals the whole
// group, and the runner records "stopped".

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLegMarker } from '../marathon.mjs';

const dir = process.argv[2];
const launch = JSON.parse(readFileSync(join(dir, 'launch.json'), 'utf8'));
let stopping = false;
let finished = false;

function finish(result) {
  if (finished) return;
  finished = true;
  const path = join(dir, 'result.json');
  writeFileSync(`${path}.tmp`, JSON.stringify({ ...result, endedAt: new Date().toISOString() }, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
  process.exit(0);
}

// Cost and usage from the harness's own output: claude's --output-format json
// result, or the last codex --json event that carries usage.
function usageFromLog() {
  let text = '';
  try {
    text = readFileSync(join(dir, 'out.log'), 'utf8').slice(-256 * 1024);
  } catch {
    return {};
  }
  for (const line of text.split('\n').filter((l) => l.trim().startsWith('{')).reverse()) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof o?.total_cost_usd === 'number') return { costUsd: o.total_cost_usd, usage: o.usage ?? null };
    if (o?.usage && typeof o.usage === 'object') return { usage: o.usage };
  }
  return {};
}

// The RELAY_LEG line of the final message: claude's result field, or the last codex
// event string that carries one. Returns "DONE — reason" style text, or undefined.
function outcomeFromLog() {
  let text = '';
  try {
    text = readFileSync(join(dir, 'out.log'), 'utf8').slice(-256 * 1024);
  } catch {
    return undefined;
  }
  const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
  for (const line of text.split('\n').filter((l) => l.trim().startsWith('{')).reverse()) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    for (const s of strings(o).reverse()) {
      const m = s.includes('RELAY_LEG') ? parseLegMarker(s) : undefined;
      if (m) return m.reason ? `${m.status} — ${m.reason}` : m.status;
    }
  }
  return undefined;
}

let child;
try {
  child = spawn(launch.bin, launch.argv, { cwd: launch.cwd, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...(launch.env ?? {}) } });
} catch (err) {
  process.stderr.write(`relay hq: could not start ${launch.bin}: ${err.message}\n`);
  finish({ status: 'failed', exitCode: null, error: err.message });
}
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    stopping = true;
    try {
      child.kill(sig);
    } catch {
      // already gone
    }
  });
}
child.on('error', (err) => {
  process.stderr.write(`relay hq: could not start ${launch.bin}: ${err.message}\n`);
  finish({ status: 'failed', exitCode: null, error: err.message });
});
// stop.json is written before the group is signalled, so a stop counts even when the
// child's exit is seen before the runner's own signal handler runs.
child.on('exit', (code, signal) => {
  const outcome = outcomeFromLog();
  finish({ status: stopping || existsSync(join(dir, 'stop.json')) ? 'stopped' : code === 0 ? 'done' : 'failed', exitCode: code, signal: signal ?? null, ...usageFromLog(), ...(outcome ? { outcome } : {}) });
});
