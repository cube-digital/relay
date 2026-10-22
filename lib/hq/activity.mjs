// Activity timeline for HQ: the latest ledger lines, relay/* commits and launches
// across repositories, newest first.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { git } from '../git.mjs';

const LEDGER_RE = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: \[[^\]]*\])? (.*)$/;

function ledgerEvents(path, rid, repoName) {
  const events = [];
  const runs = join(path, '.relay', 'runs');
  let slugs = [];
  try { slugs = readdirSync(runs); } catch { return events; }
  for (const slug of slugs) {
    const file = join(runs, slug, 'ledger.md');
    if (!existsSync(file)) continue;
    try {
      const lines = readFileSync(file, 'utf8').split('\n').slice(-50);
      for (const line of lines) {
        const m = LEDGER_RE.exec(line);
        if (!m) continue;
        const d = new Date(`${m[1]}T${m[2]}:00Z`);
        if (Number.isNaN(d.getTime())) continue;
        events.push({ at: d.toISOString(), kind: 'ledger', rid, repoName, plan: slug, text: m[3], href: `#/repos/${rid}/plans/${slug}` });
      }
    } catch { /* unreadable ledger contributes nothing */ }
  }
  return events;
}

function commitEvents(path, rid, repoName) {
  const out = git(['log', '--branches=relay/*', '--format=%h%x09%cI%x09%s', '-n', '50'], path, { allowFail: true });
  if (!out) return [];
  const events = [];
  for (const line of out.split('\n')) {
    const [sha, at, ...rest] = line.split('\t');
    if (!sha || !at) continue;
    events.push({ at: new Date(at).toISOString(), kind: 'commit', rid, repoName, plan: null, text: `${sha} ${rest.join('\t')}`, href: null });
  }
  return events;
}

export function activityFor(repos, { launches = [], limit = 100 } = {}) {
  try {
    const events = [];
    const list = Array.isArray(repos) ? repos : [];
    for (const { path, rid } of list) {
      try {
        const repoName = basename(path);
        events.push(...ledgerEvents(path, rid, repoName), ...commitEvents(path, rid, repoName));
      } catch { /* skip this repository */ }
    }
    for (const l of launches ?? []) {
      try {
        const repo = list.find((r) => r.path === l.repo);
        const base = { kind: 'launch', rid: repo?.rid ?? null, repoName: repo ? basename(repo.path) : null, plan: l.plan ?? null, href: `#/launches/${l.id}` };
        events.push({ ...base, at: l.startedAt, text: `${l.action} launched on ${l.harness}` + (l.model ? ` (${l.model})` : '') });
        if (l.endedAt) events.push({ ...base, at: l.endedAt, text: `${l.action} ${l.status}` });
      } catch { /* skip this launch */ }
    }
    return events.filter((e) => typeof e.at === 'string').sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
  } catch {
    return [];
  }
}
