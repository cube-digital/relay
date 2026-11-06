// Routine scopes: a project, one repository, or every repository in HQ. Instance ids
// are <routine>@<scope key>; a run resolves its scope against the registry at run time.

import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { listRepos, readRegistry, repoKey } from '../hq/registry.mjs';
import { ridOf } from '../hq/repo.mjs';
import { routineError } from './store.mjs';

export const slugPart = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').replace(/[-.]+$/, '') || 'repo';

// flags: { project, repo, all } as parsed from the command line (or built by HQ).
export function scopeFrom({ project, repo, all } = {}, reg = readRegistry()) {
  const given = [project !== undefined, repo !== undefined, all === true].filter(Boolean).length;
  if (given !== 1) throw routineError('choose one scope: --project <id>, --repo <path> or --all', { code: 64 });
  if (project !== undefined) {
    if (typeof project !== 'string' || !reg.projects.some((p) => p.id === project)) throw routineError(`unknown project: ${project}`);
    return { project };
  }
  if (repo !== undefined) {
    const key = typeof repo === 'string' ? repoKey(repo) : undefined;
    if (!key || !Object.hasOwn(reg.repos, key)) throw routineError(`not added to HQ: ${repo} (relay hq add <path>)`);
    return { repo: key };
  }
  if (!listRepos(reg).some((r) => !r.hidden)) throw routineError('no repositories in HQ yet (relay hq add <path>)');
  return { all: true };
}

export function scopeKey(scope) {
  if (scope.project) return scope.project;
  if (scope.repo) return slugPart(basename(scope.repo));
  return 'all';
}

export const instanceIdFor = (routine, scope) => `${routine}@${scopeKey(scope)}`;

export function scopeLabel(scope, reg = readRegistry()) {
  if (scope?.project) return reg.projects.find((p) => p.id === scope.project)?.name ?? scope.project;
  if (scope?.repo) return basename(scope.repo);
  return 'All repositories';
}

// { repos: [{ path, rid, name, project }], skipped: [{ path, name, reason }] }
export function reposInScope(scope, reg = readRegistry()) {
  const all = listRepos(reg);
  const projectOf = (r) => {
    const p = reg.projects.find((x) => x.id === r.project);
    return p ? { id: p.id, name: p.name } : null;
  };
  const repos = [];
  const skipped = [];
  let candidates;
  if (scope?.project) {
    const p = reg.projects.find((x) => x.id === scope.project);
    if (!p) return { repos, skipped: [{ path: null, name: scope.project, reason: 'project no longer in HQ' }] };
    candidates = all.filter((r) => p.repos.includes(r.path));
  } else if (scope?.repo) {
    const r = all.find((x) => x.path === scope.repo);
    if (!r) return { repos, skipped: [{ path: scope.repo, name: basename(scope.repo), reason: 'no longer in HQ' }] };
    candidates = [r];
  } else candidates = all.filter((r) => !r.hidden);
  for (const r of candidates) {
    if (r.hidden) skipped.push({ path: r.path, name: basename(r.path), reason: 'hidden in HQ' });
    else if (!existsSync(r.path)) skipped.push({ path: r.path, name: basename(r.path), reason: 'missing on disk' });
    else repos.push({ path: r.path, rid: ridOf(r.path), name: basename(r.path), project: projectOf(r) });
  }
  return { repos, skipped };
}
