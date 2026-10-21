// Codex automations written by relay: ~/.codex/automations/relay-<slug>/ holds
// automation.toml (the format Codex uses for its own) and an empty memory.md.
// Relay writes and removes only folders named relay-*, never another automation.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseToml } from '../hq/toml.mjs';
import { routineError } from './store.mjs';

export const FOLDER_RE = /^relay-[a-z0-9][a-z0-9._-]*$/;
export const automationsDir = (home = homedir()) => join(home, '.codex', 'automations');
export const folderFor = (instanceId) => `relay-${String(instanceId).replace('@', '-')}`;

const ESC = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\t': '\\t', '\r': '\\r', '\b': '\\b', '\f': '\\f' };
export const tomlString = (s) => `"${String(s).replace(/[\u0000-\u001f\u007f"\\]/g, (c) => ESC[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;

const tomlValue = (v) => {
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(', ')}]`;
  if (typeof v === 'number') return String(Math.trunc(v));
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${k} = ${tomlValue(x)}`).join(', ')} }`;
  return tomlString(v);
};

// a: { id, name, prompt, rrule, model, effort, cwds, createdAt, updatedAt }
export function automationToml(a) {
  return [
    ['version', 1], ['id', a.id], ['kind', 'cron'], ['name', a.name], ['prompt', a.prompt], ['status', 'ACTIVE'],
    ['rrule', a.rrule], ['model', a.model], ['reasoning_effort', a.effort], ['execution_environment', 'local'],
    ['target', { type: 'projectless' }], ['cwds', a.cwds], ['created_at', a.createdAt], ['updated_at', a.updatedAt],
  ].map(([k, v]) => `${k} = ${tomlValue(v)}`).join('\n') + '\n';
}

// The absolute folder of a relay automation; refuses any other name or place.
export function relayFolder(folder, home = homedir()) {
  const root = resolve(automationsDir(home));
  const path = resolve(root, String(folder));
  if (!FOLDER_RE.test(String(folder)) || dirname(path) !== root || basename(path) !== folder) {
    throw routineError(`refusing to touch ${path}: not a relay-* automation folder`);
  }
  return path;
}

export function codexInstalled(home = homedir()) {
  try {
    return statSync(automationsDir(home)).isDirectory();
  } catch {
    return false;
  }
}

export function readAutomation(folder, home = homedir()) {
  try {
    const r = parseToml(readFileSync(join(relayFolder(folder, home), 'automation.toml'), 'utf8'));
    return r.ok ? r.value : undefined;
  } catch {
    return undefined;
  }
}

export function writeAutomation(a, home = homedir()) {
  if (!codexInstalled(home)) throw routineError(`Codex is not installed here (${automationsDir(home)} is missing); nothing was written`, { status: 409 });
  const dir = relayFolder(a.id, home);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'automation.toml');
  writeFileSync(`${file}.tmp`, automationToml(a));
  renameSync(`${file}.tmp`, file);
  if (!existsSync(join(dir, 'memory.md'))) writeFileSync(join(dir, 'memory.md'), '');
  return file;
}

// The removed folder, or null when it was not there.
export function removeAutomation(folder, home = homedir()) {
  const dir = relayFolder(folder, home);
  if (!existsSync(dir)) return null;
  rmSync(dir, { recursive: true, force: true });
  return dir;
}
