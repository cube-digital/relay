// Routine instances and their data under <relayHome>/routines/: enabled.json (the
// instances), and per instance state.json, runs/, reports/ and the run lock.
// JSON writes are atomic (temp file + rename).

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { relayHome } from '../budget.mjs';
import { alive } from '../../scripts/relay-marathon.mjs';
import { localDate } from './schedule.mjs';

export const INSTANCE_RE = /^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9._-]*$/;
export const LOCK_STALE_MS = 2 * 60 * 60_000;

// Errors carry the CLI exit code and the HTTP status HQ answers with.
export const routineError = (message, { code = 1, status = 400 } = {}) => Object.assign(new Error(message), { code, status });

export const routinesDir = () => join(relayHome(), 'routines');
export const enabledPath = () => join(routinesDir(), 'enabled.json');

export function instanceDir(id) {
  if (!INSTANCE_RE.test(String(id))) throw routineError(`not a routine instance id: ${id}`, { code: 64 });
  return join(routinesDir(), id);
}

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

// A missing file is no instances; a damaged one is an error, never silently replaced.
export function readEnabled() {
  const path = enabledPath();
  if (!existsSync(path)) return { version: 1, instances: [] };
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw routineError(`${path} is not valid JSON; fix or remove it`, { status: 500 });
  }
  if (doc?.version !== 1 || !Array.isArray(doc.instances)) throw routineError(`${path} is not a relay routines file (version 1)`, { status: 500 });
  return doc;
}

export function updateEnabled(change) {
  const doc = readEnabled();
  const result = change(doc);
  writeJsonAtomic(enabledPath(), doc);
  return result;
}

export const listInstances = () => readEnabled().instances;
export const getInstance = (id) => readEnabled().instances.find((i) => i.id === id);

export function emptyState() {
  return { version: 1, seen: {}, dismissed: {}, current: [], lastRunAt: null, weekRuns: { week: null, count: 0 } };
}

// { state, reset }: a damaged state.json is kept as state.json.bad and the run starts empty.
export function readState(id) {
  const path = join(instanceDir(id), 'state.json');
  if (!existsSync(path)) return { state: emptyState(), reset: false };
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'));
    if (!s || typeof s !== 'object' || !s.seen || typeof s.seen !== 'object' || Array.isArray(s.seen)) throw new Error('bad shape');
    return { state: { ...emptyState(), ...s }, reset: false };
  } catch {
    copyFileSync(path, `${path}.bad`);
    return { state: emptyState(), reset: true };
  }
}

export const writeState = (id, state) => writeJsonAtomic(join(instanceDir(id), 'state.json'), state);

// A release function, or null while another live run holds the lock. A lock whose pid
// is gone, or that is older than LOCK_STALE_MS, is taken over.
export function acquireLock(id, now = Date.now()) {
  const dir = instanceDir(id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() }));
      } finally {
        closeSync(fd);
      }
      return () => rmSync(path, { force: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const held = readJson(path);
      if (!held) {
        let young = false;
        try {
          young = now - statSync(path).mtimeMs < 10_000; // being written right now
        } catch { /* gone: retry */ }
        if (young) return null;
      } else if (alive(held.pid) && now - Date.parse(held.at ?? '') < LOCK_STALE_MS) return null;
      rmSync(path, { force: true });
    }
  }
  return null;
}

export const lockHeld = (id) => existsSync(join(instanceDir(id), 'lock'));

const stampOf = (iso) => iso.replace(/[:.]/g, '-');

export function writeRun(id, record) {
  const path = join(instanceDir(id), 'runs', `${stampOf(record.startedAt)}.json`);
  writeJsonAtomic(path, record);
  return path;
}

// Newest first; each record carries the `file` it was read from.
export function listRuns(id, { limit = 50 } = {}) {
  const dir = join(instanceDir(id), 'runs');
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
  } catch {
    return [];
  }
  return files.slice(0, limit).map((f) => {
    const r = readJson(join(dir, f));
    return r ? { ...r, file: join(dir, f) } : undefined;
  }).filter(Boolean);
}

export const latestRun = (id) => listRuns(id, { limit: 1 })[0];

export function updateRun(file, change) {
  const r = readJson(file);
  if (!r) return undefined;
  const next = change(r);
  writeJsonAtomic(file, next);
  return next;
}

export const reportPath = (id, now = new Date()) => join(instanceDir(id), 'reports', `${localDate(now)}.md`);

// Newest first: [{ date, path }].
export function listReports(id, { limit = 10 } = {}) {
  const dir = join(instanceDir(id), 'reports');
  try {
    return readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse().slice(0, limit).map((f) => ({ date: f.slice(0, 10), path: join(dir, f) }));
  } catch {
    return [];
  }
}
