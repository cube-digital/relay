// relay HQ launches on disk: <relayHome>/hq/launches/<id>/ holds launch.json,
// out.log and result.json. Each launch runs under lib/hq/launch-runner.mjs,
// started detached so it leads its own process group and outlives the server.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relayHome } from '../budget.mjs';
import { alive } from '../../scripts/relay-marathon.mjs';

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), 'launch-runner.mjs');
export const ID_RE = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const STOP_GRACE_MS = 10_000;

export function launchesDir() {
  return join(relayHome(), 'hq', 'launches');
}

const two = (n) => String(n).padStart(2, '0');
export function newLaunchId(now = new Date()) {
  const day = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `${day}-${time}-${randomBytes(2).toString('hex')}`;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// spec: { action, repo, plan, harness, bin, argv, cwd, model, effort, permissionMode, env, display }
export function startLaunch(spec, { now = new Date() } = {}) {
  const id = newLaunchId(now);
  const dir = join(launchesDir(), id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(join(relayHome(), 'hq'), 0o700);
  chmodSync(dirname(dir), 0o700);
  chmodSync(dir, 0o700);
  const record = {
    id,
    action: spec.action,
    repo: spec.repo ?? null,
    plan: spec.plan ?? null,
    harness: spec.harness,
    bin: spec.bin,
    argv: spec.argv,
    cwd: spec.cwd,
    env: spec.env ?? {},
    model: spec.model ?? null,
    effort: spec.effort ?? null,
    permissionMode: spec.permissionMode ?? null,
    display: spec.display ?? null,
    startedAt: now.toISOString(),
    pid: null,
  };
  writeJsonAtomic(join(dir, 'launch.json'), record);
  const out = openSync(join(dir, 'out.log'), 'a');
  let child;
  try {
    child = spawn(process.execPath, [RUNNER, dir], { cwd: dir, detached: true, stdio: ['ignore', out, out] });
  } finally {
    closeSync(out);
  }
  child.on('error', (err) => writeJsonAtomic(join(dir, 'result.json'), { status: 'failed', exitCode: null, error: err.message, endedAt: new Date().toISOString() }));
  child.unref();
  if (child.pid) writeJsonAtomic(join(dir, 'launch.json'), { ...record, pid: child.pid });
  return getLaunch(id);
}

export function getLaunch(id) {
  if (!ID_RE.test(String(id))) return undefined;
  const dir = join(launchesDir(), id);
  const launch = readJson(join(dir, 'launch.json'));
  if (!launch) return undefined;
  const result = readJson(join(dir, 'result.json'));
  const status = result?.status ?? (alive(launch.pid) ? 'running' : existsSync(join(dir, 'stop.json')) ? 'stopped' : 'lost');
  const endedAt = result?.endedAt ?? null;
  const { env, ...pub } = launch;
  return {
    ...pub,
    status,
    endedAt,
    exitCode: result?.exitCode ?? null,
    costUsd: result?.costUsd ?? null,
    usage: result?.usage ?? null,
    error: result?.error ?? null,
    outcome: result?.outcome ?? null,
    durationMs: (endedAt ? Date.parse(endedAt) : Date.now()) - Date.parse(launch.startedAt),
  };
}

export function listLaunches({ limit = 200 } = {}) {
  let ids;
  try {
    ids = readdirSync(launchesDir()).filter((d) => ID_RE.test(d));
  } catch {
    return [];
  }
  return ids.sort().reverse().slice(0, limit).map(getLaunch).filter(Boolean);
}

export function logTail(id, bytes = 64 * 1024) {
  if (!ID_RE.test(String(id))) return '';
  const path = join(launchesDir(), id, 'out.log');
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - bytes);
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}

// SIGTERM to the launch's process group, SIGKILL after 10 seconds; recorded as stopped.
export async function stopLaunch(id, { graceMs = STOP_GRACE_MS } = {}) {
  const launch = getLaunch(id);
  if (!launch) throw Object.assign(new Error('unknown launch'), { status: 404 });
  if (launch.status !== 'running') return launch;
  const dir = join(launchesDir(), id);
  writeJsonAtomic(join(dir, 'stop.json'), { requestedAt: new Date().toISOString() });
  const signal = (sig) => {
    try {
      process.kill(-launch.pid, sig);
    } catch {
      // already gone
    }
  };
  const over = () => existsSync(join(dir, 'result.json')) || !alive(launch.pid);
  signal('SIGTERM');
  for (const until = Date.now() + graceMs; !over() && Date.now() < until; ) await sleep(100);
  if (!over()) {
    signal('SIGKILL');
    for (const until = Date.now() + 2000; alive(launch.pid) && Date.now() < until; ) await sleep(100);
  }
  if (!existsSync(join(dir, 'result.json'))) writeJsonAtomic(join(dir, 'result.json'), { status: 'stopped', exitCode: null, endedAt: new Date().toISOString() });
  return getLaunch(id);
}
