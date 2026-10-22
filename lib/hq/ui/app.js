// relay HQ page: router, sidebar, top-bar budget, polling, and the home, project and
// launches views. Plan, Brain and Routines views are loaded on demand from plan.js, brain.js and routines.js.

import { api, avatar, captureToken, copyButton, duration, empty, errorBox, fill, h, harnessLabel, light, link, planLight, progress, tilde, token } from './dom.js';
import { openAddDialog } from './add-dialog.js';
import { openLaunchDialog } from './launch-dialog.js';
import { activityGroups } from './activity.js';
import { projectMenu } from './project-menu.js';

const main = document.getElementById('view');
const crumbsEl = document.querySelector('.crumbs');
const budgetEl = document.querySelector('.budget');
const sideEl = document.querySelector('.side');
const dialog = document.getElementById('launch');

const LAUNCH_LIGHT = { running: 'yellow', done: 'green', failed: 'red', lost: 'red', stopped: 'grey' };
const usd = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const PROJECT_STATE = { red: 'needs you', yellow: 'running', green: 'all green' };
const unassigned = { id: '_unassigned', name: 'Unassigned' };

let stopped = false;
let current = { poll: true };
let rendering = false;
let again = false;
let fresh = false; // the next finished render follows a route change: rise in once
let lastActive = null; // rid of the most recently active repository
let lastRepos = []; // repos of the last /api/home, for the launch dialog

const ctx = {
  crumbs(items) {
    crumbsEl.hidden = items.length === 1 && items[0][0] === 'Home';
    fill(crumbsEl, ...items.map(([label, href]) => (href ? link(href, label) : h('span', { 'aria-current': 'page' }, label))));
  },
  navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
  refresh: () => route(),
  get repos() { return lastRepos; },
  openLaunch: (intent) => import('./launch-dialog.js').then((m) => m.openLaunchDialog(intent, { repos: ctx.repos, defaultRid: lastActive })),
};

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length || parts[0] === 'budget') return { name: 'home' };
  if (parts[0] === 'recos') return { name: 'recos' };
  if (parts[0] === 'activity') return { name: 'activity' };
  if (parts[0] === 'projects' && !parts[1]) return { name: 'projects' };
  if (parts[0] === 'projects' && parts[1]) return { name: 'project', id: parts[1] };
  if (parts[0] === 'repos' && parts[2] === 'plans' && parts[1] && parts[3]) return { name: 'plan', rid: parts[1], slug: parts[3], task: parts[4] === 'tasks' ? parts[5] : undefined };
  if (parts[0] === 'brain') return { name: 'brain', tab: parts[1] };
  if (parts[0] === 'launches') return parts[1] ? { name: 'launch', id: parts[1] } : { name: 'launches' };
  if (parts[0] === 'routines') return parts[1] ? { name: 'routine', id: parts[1] } : { name: 'routines' };
  return { name: 'home' };
}

function fatal(err) {
  stopped = true;
  fill(crumbsEl);
  fill(main, err?.status === 401 ? errorBox(new Error('The access key is no longer valid. Run relay hq again.')) : errorBox(err));
}

// ---- top bar and sidebar -------------------------------------------------

async function refreshChrome(home) {
  try {
    const data = home ?? (await api('/api/home'));
    lastRepos = data.repos ?? [];
    lastActive = (data.activity ?? []).find((e) => e.rid && lastRepos.some((r) => r.rid === e.rid))?.rid ?? lastRepos[0]?.rid ?? null;
    const b = data.budget;
    budgetEl.className = `budget ${b?.level ?? ''}`;
    fill(budgetEl, ...(b ? [h('span', {}, '5h ', h('b', {}, `${b.fiveHour ?? '?'}%`)), h('span', {}, '7d ', h('b', {}, `${b.sevenDay ?? '?'}%`))] : [h('span', {}, 'budget unknown')]));
    const r = parseRoute();
    const here = r.name === 'home' ? 'home' : r.name === 'projects' ? 'projects' : r.name === 'project' ? `project:${r.id}` : r.name === 'brain' ? 'brain' : r.name === 'launches' || r.name === 'launch' ? 'launches' : r.name === 'routines' || r.name === 'routine' ? 'routines' : '';
    const projects = (data.projects ?? []).filter((p) => p.id !== unassigned.id);
    fill(sideEl, 
      h('h4', {}, 'Projects'),
      ...[...projects, unassigned].map((p) => h('a', { href: `#/projects/${encodeURIComponent(p.id)}`, 'aria-current': here === `project:${p.id}` ? 'page' : undefined }, avatar(p.name, p.id, undefined, (p.waiting ?? 0) > 0), p.name)));
  } catch (err) {
    if (err.status === 401) fatal(err);
  }
}

// ---- shared pieces -------------------------------------------------------

async function post(path, body) {
  try {
    return await api(path, { method: 'POST', body });
  } catch (err) {
    alert(err.message);
    throw err;
  }
}

const registry = (body) => post('/api/registry', body).then(() => route());

function section(title, ...kids) {
  return h('section', {}, h('h2', {}, title), ...kids);
}

const addButton = (projects, selected) => h('button', { class: 'btn', type: 'button', onclick: () => openAddDialog({ projects: projects.filter((p) => p.id !== unassigned.id), selected, onDone: () => route() }) }, 'Add repository');

function projectsList(projects, repoCount) {
  const add = addButton(projects ?? []);
  if (!repoCount && !projects?.length) {
    return h('div', { class: 'stack' }, empty('No repositories yet.'), h('div', { class: 'row' }, add), h('pre', { class: 'code' }, 'relay hq add <path> --project <name>'));
  }
  if (!projects?.length) return h('div', { class: 'stack' }, empty('No projects yet.'), h('div', { class: 'row' }, add));
  return h('div', { class: 'stack' }, h('div', { class: 'row' }, add), projectGrid(projects));
}

function menuFor(p, repoCount, projects, onDeleted) {
  return projectMenu({ project: p, repoCount, projects: projects.filter((x) => x.id !== unassigned.id), onChange: () => route(), onDeleted });
}

function projectGrid(projects) {
  return h('div', { class: 'grid' }, projects.map((p) => h('div', { class: 'card stack' },
    h('div', { class: 'row between' }, h('div', { class: 'row' }, avatar(p.name, p.id), h('h3', {}, link(`#/projects/${encodeURIComponent(p.id)}`, p.name))), p.id === unassigned.id ? null : menuFor(p, p.repos, projects, () => route())),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, plural(p.repos, 'repo', 'repos')), h('span', { class: 'muted' }, `${p.running} running`), PROJECT_STATE[p.worst] ? light(p.worst, PROJECT_STATE[p.worst]) : null))));
}

function activityList(events, projectOf) {
  return activityGroups(events, projectOf, empty);
}

// ---- project -------------------------------------------------------------

function githubBlock(rid) {
  const box = h('div', { class: 'stack' }, h('span', { class: 'muted' }, 'GitHub…'));
  api(`/api/repos/${rid}/github`).then((g) => {
    if (!g.connected) return fill(box, h('span', { class: 'muted' }, `not connected: ${g.reason ?? 'unknown'}`));
    const ci = { pass: 'green', fail: 'red', pending: 'yellow', none: 'grey' };
    fill(box, ...(g.prs?.length ? g.prs.map((p) => h('div', { class: 'row' }, light(ci[p.ci] ?? 'grey', p.ci ?? 'none'), link(p.url, `#${p.number} ${p.title}`), h('span', { class: 'muted' }, `${p.draft ? 'draft · ' : ''}${p.review ?? ''}`))) : [h('span', { class: 'muted' }, 'No open PRs')]));
  }).catch((err) => fill(box, h('span', { class: 'muted' }, `not connected: ${err.message}`)));
  return box;
}

function planRow(repo, plan, launches) {
  const live = launches.find((l) => l.status === 'running' && l.repo === repo.path && l.plan === plan.file);
  const can = plan.status !== 'running' && plan.status !== 'complete';
  const board = `#/repos/${repo.rid}/plans/${plan.slug}`;
  return h('div', { class: 'row' },
    planLight(plan.status),
    h('span', {}, plan.title ?? plan.slug),
    progress(plan.green, plan.totals?.tasks, plan.status === 'running'),
    link(board, 'Board'),
    can ? h('button', { class: 'btn', type: 'button', onclick: () => openLaunchDialog({ action: 'run', rid: repo.rid, plan: plan.file }) }, 'Run') : null,
    can ? h('button', { class: 'btn', type: 'button', onclick: () => openLaunchDialog({ action: 'marathon', rid: repo.rid, plan: plan.file, hours: 8 }) }, 'Marathon') : null,
    link(board, 'Status'),
    live ? h('button', { class: 'btn danger', type: 'button', onclick: () => post(`/api/launches/${live.id}/stop`, {}).then(() => route()) }, 'Stop') : null);
}

function moveSelect(repo, projects, projectId) {
  const sel = h('select', { 'aria-label': 'Move to project' },
    h('option', { value: '' }, 'No project'),
    projects.map((p) => h('option', { value: p.id }, p.name)),
    h('option', { value: '__new' }, 'New project…'));
  sel.value = projectId === unassigned.id ? '' : projectId;
  sel.addEventListener('change', async () => {
    try {
      let target = sel.value || null;
      if (sel.value === '__new') {
        const name = prompt('Project name');
        if (!name) return route();
        target = (await post('/api/registry', { op: 'create-project', name })).id;
      }
      await registry({ op: 'assign', rid: repo.rid, project: target });
    } catch {
      route();
    }
  });
  return sel;
}

function repoCard(repo, data, launches) {
  const g = repo.git ?? {};
  const head = repo.missing
    ? h('div', { class: 'row' }, h('span', { class: 'error' }, 'missing on disk'), h('button', { class: 'btn danger', type: 'button', onclick: () => confirm(`Remove ${repo.name} from HQ?`) && registry({ op: 'remove', rid: repo.rid }) }, 'Remove'))
    : h('div', { class: 'row' },
      h('span', { class: 'chip' }, g.branch ?? '?'),
      h('span', { class: 'muted' }, `${g.dirty ?? 0} uncommitted`),
      h('span', { class: 'muted' }, `↑${g.ahead ?? 0} ↓${g.behind ?? 0}`),
      h('span', { class: 'muted' }, plural(repo.worktrees?.length ?? 0, 'lane worktree', 'lane worktrees')));
  return h('div', { class: 'card accent stack' },
    h('h3', {}, repo.name ?? tilde(repo.path)),
    h('span', { class: 'muted' }, tilde(repo.path)),
    head,
    repo.error ? errorBox(new Error(repo.error)) : null,
    repo.missing ? null : (repo.plans ?? []).map((p) => planRow(repo, p, launches)),
    repo.missing ? null : h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => openLaunchDialog({ action: 'plan', rid: repo.rid }) }, '+ New plan'),
      repo.codexSetup ? null : h('button', { class: 'btn', type: 'button', onclick: () => openLaunchDialog({ action: 'setup-codex', rid: repo.rid }) }, 'Set up Codex')),
    h('div', { class: 'row' },
      moveSelect(repo, data.projects ?? [], data.project.id),
      h('button', { class: 'btn', type: 'button', onclick: () => registry({ op: repo.hidden ? 'unhide' : 'hide', rid: repo.rid }) }, repo.hidden ? 'Unhide' : 'Hide')),
    repo.missing ? null : githubBlock(repo.rid));
}

async function renderProjects() {
  ctx.crumbs([['Home', '#/'], ['Projects']]);
  const data = await api('/api/home');
  refreshChrome(data);
  fill(main, h('h1', {}, 'Projects'), projectsList(data.projects, data.repos?.length));
}

async function renderProject({ id }) {
  const [data, ls] = await Promise.all([api(`/api/projects/${encodeURIComponent(id)}`), api('/api/launches')]);
  refreshChrome();
  const p = data.project;
  ctx.crumbs([['Home', '#/'], [p.name]]);
  const visible = data.repos.filter((r) => !r.hidden);
  const hidden = data.repos.filter((r) => r.hidden);
  const menu = p.id === unassigned.id ? null : menuFor(p, data.repos.length, data.projects ?? [], () => ctx.navigate('#/'));
  fill(main, 
    h('div', { class: 'row' }, avatar(p.name, p.id, 'lg'), h('h1', {}, p.name), menu, addButton(data.projects ?? [], p.id)),
    h('div', { class: 'two-col' },
      h('div', {},
        visible.length ? visible.map((r) => repoCard(r, data, ls.launches ?? [])) : empty('No repositories here.'),
        hidden.length ? [h('h2', {}, 'Hidden'), hidden.map((r) => repoCard(r, data, ls.launches ?? []))] : null),
      h('div', { class: 'aside' }, section('Activity', activityList(data.activity, () => p.id)))));
}

async function renderActivity() {
  ctx.crumbs([['Home', '#/'], ['Activity']]);
  const data = await api('/api/home');
  refreshChrome(data);
  const projectByRid = new Map((data.repos ?? []).map((r) => [r.rid, r.project]));
  fill(main, h('h1', {}, 'Activity'), activityList(data.activity, (e) => projectByRid.get(e.rid) ?? unassigned.id));
}

// ---- launches ------------------------------------------------------------

async function renderLaunches() {
  ctx.crumbs([['Home', '#/'], ['Launches']]);
  const { launches } = await api('/api/launches');
  refreshChrome();
  const rows = launches.map((l) => h('tr', {},
    h('td', {}, link(`#/launches/${l.id}`, l.action)),
    h('td', {}, tilde(l.repo ?? '')),
    h('td', {}, harnessLabel(l.harness)),
    h('td', {}, l.model ?? ''),
    h('td', {}, light(LAUNCH_LIGHT[l.status] ?? 'grey', l.status), l.outcome ? h('span', { class: 'muted' }, ` ${l.outcome}`) : null),
    h('td', {}, duration(l.durationMs)),
    h('td', {}, usd(l.costUsd))));
  fill(main, h('h1', {}, 'Launches'), launches.length
    ? h('table', { class: 'list' }, h('thead', {}, h('tr', {}, ['Action', 'Repository', 'Harness', 'Model', 'Status', 'Duration', 'Cost'].map((c) => h('th', {}, c)))), h('tbody', {}, rows))
    : empty('No launches yet.'));
}

async function renderLaunch({ id }) {
  ctx.crumbs([['Home', '#/'], ['Launches', '#/launches'], [id]]);
  const l = await api(`/api/launches/${encodeURIComponent(id)}`);
  const log = h('pre', { class: 'code', 'aria-label': 'Log' }, l.log ?? '');
  fill(main, 
    h('h1', {}, `${l.action} · ${tilde(l.repo ?? '')}`),
    h('div', { class: 'row' }, light(LAUNCH_LIGHT[l.status] ?? 'grey', l.status), l.status === 'running' ? h('button', { class: 'btn danger', type: 'button', onclick: () => post(`/api/launches/${l.id}/stop`, {}).then(() => route()) }, 'Stop') : null, l.outcome ? h('span', { class: 'muted' }, `outcome ${l.outcome}`) : null),
    h('div', { class: 'row muted' }, l.display ? copyButton('Copy command', l.display) : null, h('span', {}, `exit code ${l.exitCode ?? '-'}`), h('span', {}, `cost ${usd(l.costUsd)}`), h('span', {}, `started ${when(l.startedAt)}`), h('span', {}, l.endedAt ? `ended ${when(l.endedAt)}` : '')),
    l.error ? errorBox(new Error(l.error)) : null,
    h('h2', {}, 'Log'),
    log);
  log.scrollTop = log.scrollHeight;
}

// ---- router and polling --------------------------------------------------

async function lazy(file, fn) {
  try {
    const mod = await import(file);
    return await fn(mod);
  } catch (err) {
    if (err.status === 401) throw err;
    fill(main, errorBox(err));
    return { poll: false };
  }
}

async function route() {
  if (stopped) return;
  if (rendering) { again = true; return; }
  rendering = true;
  try {
    const r = parseRoute();
    let out;
    document.body.classList.toggle('home', r.name === 'home');
    if (r.name === 'home') out = await lazy('./home.js', (m) => m.renderHome(main, {}, ctx));
    else if (r.name === 'recos') {
      ctx.crumbs([['Home', '#/'], ['Recos']]);
      out = await lazy('./recos.js', (m) => m.renderRecos(main, {}, ctx));
    } else if (r.name === 'activity') out = await renderActivity();
    else if (r.name === 'projects') out = await renderProjects();
    else if (r.name === 'project') out = await renderProject(r);
    else if (r.name === 'launches') out = await renderLaunches();
    else if (r.name === 'launch') out = await renderLaunch(r);
    else if (r.name === 'plan') {
      ctx.crumbs([['Home', '#/'], [r.slug]]);
      out = await lazy('./plan.js', (m) => m.renderPlan(main, { rid: r.rid, slug: r.slug, task: r.task }, ctx));
    } else if (r.name === 'brain') {
      ctx.crumbs([['Home', '#/'], ['Brain']]);
      out = await lazy('./brain.js', (m) => m.renderBrain(main, { tab: r.tab }, ctx));
    } else if (r.name === 'routines') {
      ctx.crumbs([['Home', '#/'], ['Routines']]);
      out = await lazy('./routines.js', (m) => m.renderRoutines(main, {}, ctx));
    } else if (r.name === 'routine') {
      ctx.crumbs([['Home', '#/'], ['Routines', '#/routines'], [r.id]]);
      out = await lazy('./routines.js', (m) => m.renderRoutine(main, { id: r.id }, ctx));
    }
    current = out ?? { poll: true };
  } catch (err) {
    if (err.status === 401) fatal(err);
    else {
      current = { poll: true };
      fill(main, errorBox(err));
    }
  } finally {
    rendering = false;
    if (fresh) {
      fresh = false;
      main.classList.remove('rise');
      void main.offsetWidth;
      main.classList.add('rise');
    }
    if (again) { again = false; route(); }
  }
}

function onRoute() {
  const home = parseRoute().name === 'home';
  // The layout (side, top bar) and main switch together: the old view never shows in the other layout while the new one loads.
  if (document.body.classList.contains('home') !== home) fill(main);
  document.body.classList.toggle('home', home);
  current = { poll: true };
  fresh = true;
  refreshChrome();
  route();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || dialog.open) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
  e.preventDefault();
  if (parseRoute().name === 'recos') document.querySelector('[data-filter]')?.focus();
  else import('./search.js').then((m) => m.openSearch(ctx)).catch(() => {});
});

captureToken();
if (!token()) {
  fill(main, h('p', { class: 'empty' }, 'Open relay HQ with `relay hq`; the link it opens carries the access key.'));
} else {
  window.addEventListener('hashchange', onRoute);
  onRoute();
  setInterval(() => !stopped && refreshChrome(), 30_000);
  setInterval(() => {
    if (stopped || document.visibilityState !== 'visible' || dialog.open || document.querySelector('details.menu[open]') || current?.poll === false) return;
    route();
  }, 5000);
}
