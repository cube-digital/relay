// relay hq [--port N] [--no-open] | stop | add <path> [--project P] | hide|unhide|rm <path>
//   | connectors --record [--harness claude|codex] | serve [--port N] (internal, foreground)
// The command centre in your browser: starts (or reuses) the local HQ server and opens it.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { relayHome } from '../lib/budget.mjs';
import { recordSnapshot } from '../lib/hq/brain.mjs';
import { addRepo, applyRegistryOp, repoKey, updateRegistry } from '../lib/hq/registry.mjs';
import { createHqServer, listen } from '../lib/hq/server.mjs';
import { RELAY_ROOT } from '../lib/routing.mjs';
import { alive } from './relay-marathon.mjs';

const hqDir = () => join(relayHome(), 'hq');
const serverFile = () => join(hqDir(), 'server.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`relay hq: ${m}`);
const warn = (m) => console.error(`relay hq: ${m}`);
const USAGE = 'usage: relay hq [--port N] [--no-open] | stop | add <path> [--project P] | hide|unhide|rm <path> | connectors --record [--harness claude|codex]';

function readServer() {
  try {
    const s = JSON.parse(readFileSync(serverFile(), 'utf8'));
    return s && Number.isInteger(s.port) && Number.isInteger(s.pid) && typeof s.token === 'string' ? s : undefined;
  } catch {
    return undefined;
  }
}

function ping(s) {
  return new Promise((resolvePing) => {
    const req = get({ host: '127.0.0.1', port: s.port, path: '/api/health', headers: { Host: `127.0.0.1:${s.port}`, Authorization: `Bearer ${s.token}` }, timeout: 1500 }, (res) => {
      res.resume();
      resolvePing(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolvePing(false));
  });
}

function writeServerFile(info) {
  mkdirSync(hqDir(), { recursive: true, mode: 0o700 });
  chmodSync(hqDir(), 0o700); // mkdir's mode does not tighten a directory that already exists
  const file = serverFile();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(info), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

async function serve(args) {
  const token = randomBytes(32).toString('hex');
  const server = createHqServer({ token });
  const start = Number(args.port) || 4747;
  let port;
  try {
    port = await listen(server, { port: start });
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      warn(`ports ${start}-${start + 10} are all in use; pass --port N`);
      return 1;
    }
    throw err;
  }
  writeServerFile({ port, pid: process.pid, token, startedAt: new Date().toISOString() });
  const stop = () => {
    server.close();
    if (readServer()?.pid === process.pid) rmSync(serverFile(), { force: true });
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return new Promise(() => {});
}

function logTail() {
  try {
    return readFileSync(join(hqDir(), 'server.log'), 'utf8').split('\n').slice(-21).join('\n');
  } catch {
    return '';
  }
}

function openUrl(url) {
  const [bin, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(bin, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

async function start(args) {
  let info = readServer();
  let reused = false;
  if (info && alive(info.pid) && (await ping(info))) reused = true;
  else {
    mkdirSync(hqDir(), { recursive: true, mode: 0o700 });
    const fd = openSync(join(hqDir(), 'server.log'), 'a');
    const child = spawn(process.execPath, [join(RELAY_ROOT, 'bin', 'relay'), 'hq', 'serve', '--port', String(Number(args.port) || 4747)], { detached: true, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    let exited = false;
    child.on('exit', () => (exited = true));
    child.on('error', () => (exited = true));
    child.unref();
    info = undefined;
    for (let waited = 0; waited < 5000 && !exited; waited += 100) {
      await sleep(100);
      const s = readServer();
      if (s?.pid === child.pid && (await ping(s))) {
        info = s;
        break;
      }
    }
    if (!info) {
      warn('the server did not start; last lines of server.log:');
      console.error(logTail());
      return 1;
    }
  }
  const base = `http://127.0.0.1:${info.port}/`;
  if (args['no-open']) console.log(`${base}#t=${info.token}`);
  else {
    openUrl(`${base}#t=${info.token}`);
    say(`${base} (opened in your browser; ${reused ? 'reused the running server' : 'started'})`);
  }
  return 0;
}

async function stopServer() {
  const info = readServer();
  if (info && alive(info.pid)) {
    process.kill(info.pid, 'SIGTERM');
    for (let waited = 0; waited < 3000 && alive(info.pid); waited += 100) await sleep(100);
    say('stopped');
  } else {
    if (info && existsSync(serverFile())) rmSync(serverFile(), { force: true });
    say('not running');
  }
  return 0;
}

function readStdin() {
  return new Promise((res, rej) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => res(data));
    process.stdin.on('error', rej);
  });
}

function harnessFor(args, env) {
  if (args.harness === 'claude' || args.harness === 'codex') return args.harness;
  if (env.RELAY_HARNESS === 'claude' || env.RELAY_HARNESS === 'codex') return env.RELAY_HARNESS;
  if (env.CLAUDECODE === '1') return 'claude';
  if (Object.keys(env).some((k) => k.startsWith('CODEX_'))) return 'codex';
  return undefined;
}

async function record(args) {
  let data;
  try {
    data = JSON.parse(await readStdin());
  } catch {
    warn('stdin is not valid JSON');
    return 1;
  }
  const harness = harnessFor(args, process.env);
  if (!harness) {
    console.error('relay hq connectors: cannot tell which harness recorded this; pass --harness claude|codex');
    return 64;
  }
  const n = recordSnapshot(harness, data);
  say(`recorded ${typeof n === 'number' ? n : Array.isArray(data) ? data.length : 0} connector(s) for ${harness}`);
  return 0;
}

const OPS = { hide: ['hide', 'hidden'], unhide: ['unhide', 'shown'], rm: ['remove', 'removed'] };

export async function main(argv) {
  const args = parseArgs(argv, { booleans: ['no-open', 'record'] });
  const [sub, ...rest] = args._;
  try {
    if (!sub) return await start(args);
    if (sub === 'serve') return await serve(args);
    if (sub === 'stop') return await stopServer();
    if (sub === 'add') {
      if (!rest[0]) return usage();
      const key = addRepo(rest[0], { project: typeof args.project === 'string' ? args.project : undefined });
      say(`added ${key}${typeof args.project === 'string' ? ` to ${args.project}` : ''}`);
      return 0;
    }
    if (OPS[sub]) {
      if (!rest[0]) return usage();
      const key = repoKey(rest[0]) ?? resolve(rest[0]);
      updateRegistry((reg) => applyRegistryOp(reg, { op: OPS[sub][0], repo: key }));
      say(`${OPS[sub][1]} ${key}`);
      return 0;
    }
    if (sub === 'connectors') return args.record ? await record(args) : usage();
  } catch (err) {
    if (Number.isInteger(err.status)) {
      warn(err.message);
      return 1;
    }
    throw err;
  }
  return usage();
}

function usage() {
  console.error(USAGE);
  return 64;
}
