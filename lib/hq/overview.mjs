// The Overview read model: what needs you, what is running, ready to merge, finished and the
// activity, per project or for all of them; the sidebar counts; and the extras of a run page.
// Read-only.

import { basename, join } from 'node:path';
import { git } from '../git.mjs';
import { boardFor } from '../../scripts/relay-board.mjs';
import { forecastPlan } from '../../scripts/relay-forecast.mjs';
import { runDir } from '../../scripts/relay-lanes.mjs';
import { activityFor } from './activity.mjs';
import { runningPlan } from './home.mjs';
import { listLaunches, logTail } from './launches.mjs';
import { listRepos } from './registry.mjs';
import { integrationState, planFileOf, repoSummary, ridOf } from './repo.mjs';
import { ledgerOf, reviewOf } from './review.mjs';

export const UNASSIGNED = '_unassigned';
const HOURS_72 = 72 * 3600 * 1000;
const ATTENTION_KINDS = ['lane-blocked', 'marathon-blocked', 'suite-failed'];
const SETUP_HREF = { gh: '#/setup/connectors', connectors: '#/setup/connectors', keys: '#/setup/keys' };

const fail = (status, message) => Object.assign(new Error(message), { status });
const byNewest = (a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? ''));

function need(fields) {
  return { id: null, kind: null, project: null, projectName: null, rid: null, repoName: null, plan: null, file: null, lane: null, text: null, detail: null, at: null, href: null, launch: null, instance: null, finding: null, copy: null, resetsAt: null, ...fields };
}

export function setupIssuesFrom(recos) {
  return (recos ?? [])
    .filter((r) => r.state === 'open' && r.apply?.kind === 'manual' && SETUP_HREF[r.source] && r.unblocks === true)
    .map((r) => need({ id: `setup:${r.id}`, kind: 'setup', text: r.title, detail: r.benefit ?? null, at: r.at ?? null, copy: r.apply.copy ?? null, href: SETUP_HREF[r.source] }));
}

function reposOf(reg) {
  const names = new Map(reg.projects.map((p) => [p.id, p.name]));
  return listRepos(reg)
    .filter((r) => !r.hidden)
    .map((r) => {
      const project = r.project ?? UNASSIGNED;
      return { path: r.path, rid: ridOf(r.path), name: basename(r.path), project, projectName: project === UNASSIGNED ? 'Unassigned' : (names.get(project) ?? project) };
    });
}

// minutes left from the current wave on; null without a usable forecast
function leftMinOf(path, file, currentWave) {
  try {
    const f = forecastPlan(join(path, file));
    const per = f.forecast?.perWave;
    if (f.errors?.length || !Array.isArray(per)) return null;
    const from = Math.max(1, currentWave ?? 1);
    return Math.round(per.filter((w) => w.wave >= from).reduce((s, w) => s + (w.minutes ?? 0), 0));
  } catch {
    return null;
  }
}

function build(reg, opts) {
  const { launches = listLaunches(), routineItems = [], setupIssues = [], budget = null, now = Date.now() } = opts;
  const sorted = [...launches].sort(byNewest);
  const repos = reposOf(reg);
  const byPath = new Map(repos.map((r) => [r.path, r]));
  const byRid = new Map(repos.map((r) => [r.rid, r]));
  const hiddenPaths = new Set(listRepos(reg).filter((r) => r.hidden).map((r) => r.path));
  const proj = (r) => ({ project: r?.project ?? null, projectName: r?.projectName ?? null });
  const needs = [];
  const running = [];
  const ready = [];
  const finished = [];

  for (const r of repos) {
    const s = repoSummary(r.path);
    const base = { ...proj(r), rid: r.rid, repoName: r.name };
    const mine = sorted.filter((l) => l.repo === r.path);
    const planLaunches = (file) => mine.filter((l) => l.plan === file);

    for (const a of s.attention ?? []) {
      if (!ATTENTION_KINDS.includes(a.kind)) continue;
      const plan = s.plans.find((p) => p.slug === a.plan);
      const l = plan ? planLaunches(plan.file)[0] : null;
      needs.push(need({ ...base, id: a.id, kind: a.kind, plan: a.plan, file: plan?.file ?? null, lane: a.lane ?? null, text: a.text, at: a.at, href: a.href, launch: l ? { id: l.id, status: l.status, retryable: Boolean(l.retryable) } : null }));
    }

    for (const p of s.plans) {
      if (p.error) continue;
      const pl = planLaunches(p.file);
      if (p.status !== 'complete' && !pl.some((l) => l.status === 'running')) {
        const last = pl.find((l) => l.action === 'run' || l.action === 'marathon');
        if (last && last.status === 'done' && /^PAUSED\b/.test(last.outcome ?? '')) {
          needs.push(need({ ...base, id: `${r.rid}:run-paused:${p.slug}`, kind: 'run-paused', plan: p.slug, file: p.file, text: last.outcome, at: last.endedAt ?? null, href: `#/repos/${r.rid}/plans/${p.slug}`, resetsAt: budget?.resetsAt ?? null }));
        }
      }
      if (p.status === 'running' || p.status === 'blocked') {
        const rp = runningPlan(s, p, { launches: sorted });
        running.push({
          type: 'plan', id: `${r.rid}:${p.slug}`, ...base, slug: p.slug, file: p.file, title: p.title, flow: p.flow, status: p.status,
          wave: p.currentWave, waves: p.waveCount, done: p.green, total: p.totals?.tasks ?? 0, startedAt: rp.kpis.startedAt,
          leftMin: leftMinOf(r.path, p.file, p.currentWave), launch: rp.launch ? { id: rp.launch.id } : null,
          lanes: rp.groups.running.map((g) => ({ lane: g.lane, title: g.title, kind: g.kind, hex: g.hex, avatar: g.avatar, status: g.status, task: g.task, fix: g.fix })),
          href: rp.href,
        });
      } else if (p.readyToMerge) {
        const review = reviewOf(p.board, runDir(join(r.path, p.file), p.slug), { repo: r.path });
        ready.push({ id: `${r.rid}:${p.slug}`, ...base, slug: p.slug, title: p.title, branch: `relay/${p.slug}/integration`, into: s.git?.branch ?? null, at: p.lastAt, tests: review.tests, rulings: review.rulings.length, openFindings: review.openFindings, suite: review.suite, href: `#/repos/${r.rid}/plans/${p.slug}` });
      } else if (p.status === 'complete') {
        finished.push({ id: `${r.rid}:${p.slug}`, ...base, slug: p.slug, title: p.title, at: p.lastAt, href: `#/repos/${r.rid}/plans/${p.slug}` });
      }
    }

    for (const l of mine) {
      if (l.status !== 'running') continue;
      if (l.plan && s.plans.some((p) => p.file === l.plan)) continue;
      running.push({ type: 'launch', id: l.id, ...base, action: l.action, startedAt: l.startedAt });
    }
  }

  // failed or lost launches that are the newest of their kind
  const seen = new Set();
  for (const l of sorted) {
    const key = `${l.action}|${l.repo}|${l.plan}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (l.status !== 'failed' && l.status !== 'lost') continue;
    if (now - Date.parse(l.startedAt) > HOURS_72) continue;
    if (hiddenPaths.has(l.repo)) continue;
    const r = byPath.get(l.repo);
    const plan = r ? repoSummary(r.path).plans.find((p) => p.file === l.plan) : null;
    needs.push(need({ ...proj(r), rid: r?.rid ?? null, repoName: r?.name ?? null, id: `launch:${l.id}`, kind: l.status === 'failed' ? 'launch-failed' : 'launch-lost', plan: plan?.slug ?? null, file: l.plan ?? null, text: `${l.action} ${l.status}`, detail: l.error ?? l.outcome ?? '', at: l.endedAt ?? l.startedAt, href: `#/launches/${l.id}`, launch: { id: l.id, status: l.status, retryable: Boolean(l.retryable) } }));
  }

  for (const item of routineItems) {
    const m = /^routine:([^:]+):(.+)$/.exec(item.id ?? '');
    needs.push(need({ ...item, ...proj(byRid.get(item.rid)), instance: m?.[1] ?? null, finding: m?.[2] ?? null }));
  }
  for (const s of setupIssues) needs.push(need({ ...s, project: null, projectName: null }));

  needs.sort((a, b) => (a.at ? (b.at ? b.at.localeCompare(a.at) : -1) : b.at ? 1 : 0));
  finished.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
  return { repos, needs, running, ready, finished, sorted };
}

export function overviewFor(reg, projectId, opts = {}) {
  const built = build(reg, opts);
  const all = projectId === 'all';
  let project;
  if (all) project = { id: 'all', name: 'All projects' };
  else if (projectId === UNASSIGNED) project = { id: UNASSIGNED, name: 'Unassigned' };
  else {
    const p = reg.projects.find((x) => x.id === projectId);
    if (!p) throw fail(404, 'unknown project');
    project = { id: p.id, name: p.name };
  }
  const keep = (x) => all || x.project === project.id;
  const members = built.repos.filter(keep);
  const paths = new Set(members.map((r) => r.path));
  return {
    project: { ...project, repos: members.map((r) => ({ rid: r.rid, name: r.name })) },
    needs: built.needs.filter(keep),
    running: built.running.filter(keep),
    ready: built.ready.filter(keep),
    finished: built.finished.filter(keep).slice(0, 10),
    activity: activityFor(members, { launches: all ? built.sorted : built.sorted.filter((l) => paths.has(l.repo)), limit: 50 }),
  };
}

export function sidebarFor(reg, opts = {}) {
  const all = overviewFor(reg, 'all', opts);
  const projects = reg.projects.map((p) => ({ id: p.id, name: p.name }));
  if (reposOf(reg).some((r) => r.project === UNASSIGNED)) projects.push({ id: UNASSIGNED, name: 'Unassigned' });
  return {
    all: { needs: all.needs.length, live: all.running.length },
    projects: projects.map((p) => ({ ...p, needs: all.needs.filter((n) => n.project === p.id).length, live: all.running.filter((c) => c.project === p.id).length })),
  };
}

export function runExtras(path, slug, { launches = listLaunches(), now = Date.now() } = {}) {
  const abs = planFileOf(path, slug);
  const r = boardFor(abs);
  if (r.errors) throw fail(409, r.errors.join('; '));
  const file = abs.slice(path.length + 1);
  const mine = [...launches].filter((l) => l.repo === path && l.plan === file).sort(byNewest);
  const live = mine.find((l) => l.status === 'running');
  const entries = ledgerOf(r.dir);
  const start = entries.filter((e) => /^start:/.test(e.text)).pop();
  const complete = r.board.status === 'complete';
  const { hasInt, merged } = integrationState(path, r.board);
  return {
    launches: mine.slice(0, 20).map((l) => ({ id: l.id, action: l.action, status: l.status, outcome: l.outcome ?? null, harness: l.harness, startedAt: l.startedAt, endedAt: l.endedAt ?? null, retryable: Boolean(l.retryable) })),
    live: live ? { id: live.id, log: logTail(live.id, 16 * 1024) } : null,
    ledger: entries.slice(-40).map((e) => `${e.at} ${e.text}`),
    startedAt: start ? new Date(`${start.at.replace(' ', 'T')}:00Z`).toISOString() : null,
    leftMin: complete ? 0 : leftMinOf(path, file, r.board.currentWave),
    branch: `relay/${r.board.slug}/integration`,
    into: git(['rev-parse', '--abbrev-ref', 'HEAD'], path, { allowFail: true }) ?? null,
    review: complete ? { ...reviewOf(r.board, r.dir, { repo: path }), ready: hasInt && !merged, merged } : null,
  };
}
