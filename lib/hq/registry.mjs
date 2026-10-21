// relay HQ's registry: projects (named groups of repositories), repositories and
// their hidden flags, in <relayHome>/hq/registry.json. Writes are atomic (temp
// file + rename). A repository's key is the realpath of its main worktree root.

import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { relayHome } from '../budget.mjs';
import { mainRoot } from '../git.mjs';

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const has = (reg, repo) => typeof repo === 'string' && Object.hasOwn(reg.repos, repo);

export function registryPath() {
  return join(relayHome(), 'hq', 'registry.json');
}

export function emptyRegistry() {
  return { version: 1, projects: [], repos: {} };
}

// A missing file is an empty registry; a damaged one is an error, never silently replaced.
export function readRegistry(path = registryPath()) {
  if (!existsSync(path)) return emptyRegistry();
  let reg;
  try {
    reg = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${path} is not valid JSON; fix or remove it`);
  }
  if (reg?.version !== 1 || !Array.isArray(reg.projects) || !reg.repos || typeof reg.repos !== 'object') {
    throw new Error(`${path} is not a relay HQ registry (version 1)`);
  }
  return reg;
}

export function writeRegistry(reg, path = registryPath()) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n');
  renameSync(tmp, path);
}

export function updateRegistry(change, path = registryPath()) {
  const reg = readRegistry(path);
  const result = change(reg);
  writeRegistry(reg, path);
  return result;
}

export function projectId(name) {
  const id = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!id) throw bad(`project name "${name}" has no letters or digits`);
  return id;
}

// The main checkout's real path, also from a subdirectory or a lane worktree; undefined outside git.
export function repoKey(path) {
  const root = mainRoot(resolve(path));
  if (!root) return undefined;
  try {
    return realpathSync(root);
  } catch {
    return undefined;
  }
}

function register(reg, key, via, now) {
  const at = now.toISOString();
  if (has(reg, key)) reg.repos[key].lastSeenAt = at;
  else reg.repos[key] = { addedAt: at, lastSeenAt: at, hidden: false, via };
}

// Registers the repository whose main worktree contains path; throws a status-400 error outside git.
export function addRepo(path, { project, via = 'cli', now = new Date() } = {}) {
  const key = repoKey(path);
  if (!key) throw bad(`not a git repository: ${path}`);
  updateRegistry((reg) => {
    register(reg, key, via, now);
    if (project) assign(reg, key, ensureProject(reg, project));
  });
  return key;
}

function ensureProject(reg, name) {
  const id = projectId(name);
  if (!reg.projects.some((p) => p.id === id)) reg.projects.push({ id, name: String(name).trim(), repos: [] });
  return id;
}

function assign(reg, repo, id) {
  if (!has(reg, repo)) throw bad(`not registered: ${repo}`);
  if (id !== null && !reg.projects.some((p) => p.id === id)) throw bad(`unknown project: ${id}`);
  for (const p of reg.projects) p.repos = p.repos.filter((r) => r !== repo);
  if (id !== null) reg.projects.find((p) => p.id === id).repos.push(repo);
}

// op: { op: 'add', path, project?: name } | { op: 'create-project', name } | { op: 'rename-project', id, name } | { op: 'delete-project', id }
//   | { op: 'assign', repo, project: id | null } | { op: 'hide' | 'unhide' | 'remove', repo }
// Mutates reg; throws a status-400 error on bad input.
export function applyRegistryOp(reg, op) {
  switch (op?.op) {
    case 'add': {
      if (typeof op.path !== 'string' || !op.path.trim()) throw bad('path is required');
      const p = op.path.trim();
      const full = p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : resolve(p);
      if (!existsSync(full)) throw bad(`no such folder: ${p}`);
      const key = repoKey(full);
      if (!key) throw bad(`not a git repository: ${p}`);
      register(reg, key, 'ui', new Date());
      if (typeof op.project === 'string' && op.project.trim()) assign(reg, key, ensureProject(reg, op.project));
      return { path: key };
    }
    case 'create-project':
      return { id: ensureProject(reg, op.name) };
    case 'rename-project': {
      const p = reg.projects.find((x) => x.id === op.id);
      if (!p) throw bad(`unknown project: ${op.id}`);
      projectId(op.name); // the new name needs letters or digits; the id stays so links keep working
      p.name = String(op.name).trim();
      return { id: p.id };
    }
    case 'delete-project': {
      const i = reg.projects.findIndex((x) => x.id === op.id);
      if (i < 0) throw bad(`unknown project: ${op.id}`);
      reg.projects.splice(i, 1); // its repositories stay registered, now unassigned
      return {};
    }
    case 'assign':
      assign(reg, op.repo, op.project ?? null);
      return {};
    case 'hide':
    case 'unhide':
      if (!has(reg, op.repo)) throw bad(`not registered: ${op.repo}`);
      reg.repos[op.repo].hidden = op.op === 'hide';
      return {};
    case 'remove':
      if (!has(reg, op.repo)) throw bad(`not registered: ${op.repo}`);
      delete reg.repos[op.repo];
      for (const p of reg.projects) p.repos = p.repos.filter((r) => r !== op.repo);
      return {};
    default:
      throw bad(`unknown registry operation: ${op?.op}`);
  }
}

export function listRepos(reg) {
  return Object.entries(reg.repos).map(([path, meta]) => ({
    path,
    ...meta,
    project: reg.projects.find((p) => p.repos.includes(path))?.id ?? null,
  }));
}
