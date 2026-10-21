// relay HQ page: router, sidebar, top-bar budget, polling, and the home, project and
// launches views. Plan and Brain views are loaded on demand from plan.js and brain.js.

import { ago, api, avatar, captureToken, colorOf, duration, empty, errorBox, h, light, link, planLight, progress, roleTile, tilde, token } from './dom.js';
import { openAddDialog } from './add-dialog.js';
import { openLaunchDialog } from './launch-dialog.js';
import { activityGroups } from './activity.js';
import { projectMenu } from './project-menu.js';

const main = document.getElementById('view');
const crumbsEl = document.querySelector('.crumbs');
const budgetEl = document.querySelector('.budget');
const navEl = document.querySelector('.nav');
const sideEl = document.querySelector('.side');
const dialog = document.getElementById('launch');

const LAUNCH_LIGHT = { running: 'yellow', done: 'green', failed: 'red', lost: 'red', stopped: 'grey' };
const usd = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');
const KIND = {
  'lane-blocked': ['blocked', 'r'], 'suite-failed': ['suite failed', 'r'], 'marathon-blocked': ['marathon blocked', 'r'], 'ci-red': ['CI red', 'r'],
  'ready-to-merge': ['ready to merge', 'y'], 'review-requested': ['review', 'y'],
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const PROJECT_STATE = { red: 'needs you', yellow: 'running', green: 'all green' };
const unassigned = { id: '_unassigned', name: 'Unassigned' };

let stopped = false;
let current = { poll: true };
let rendering = false;
let again = false;
let fresh = false; // the next finished render follows a route change: rise in once
let ghAttention = new Map(); // rid -> attention items, kept so a refresh does not blank GitHub items

const ctx = {
  crumbs(items) {
    crumbsEl.hidden = items.length === 1 && items[0][0] === 'Home';
    crumbsEl.replaceChildren(...items.map(([label, href]) => (href ? link(href, label) : h('span', { 'aria-current': 'page' }, label))));
  },
  navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
  refresh: () => route(),
};

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'projects' && !parts[1]) return { name: 'projects' };
  if (parts[0] === 'projects' && parts[1]) return { name: 'project', id: parts[1] };
  if (parts[0] === 'repos' && parts[2] === 'plans' && parts[1] && parts[3]) return { name: 'plan', rid: parts[1], slug: parts[3], task: parts[4] === 'tasks' ? parts[5] : undefined };
  if (parts[0] === 'brain') return { name: 'brain', tab: parts[1] };
  if (parts[0] === 'launches') return parts[1] ? { name: 'launch', id: parts[1] } : { name: 'launches' };
  return { name: 'home' };
}

function fatal(err) {
  stopped = true;
  crumbsEl.replaceChildren();
  main.replaceChildren(err?.status === 401 ? errorBox(new Error('The access key is no longer valid. Run relay hq again.')) : errorBox(err));
}

// ---- top bar and sidebar -------------------------------------------------

async function refreshChrome(home) {
  try {
    const data = home ?? (await api('/api/home'));
    const b = data.budget;
    budgetEl.className = `budget ${b?.level ?? ''}`;
    budgetEl.replaceChildren(...(b ? [h('span', {}, '5h ', h('b', {}, `${b.fiveHour ?? '?'}%`)), h('span', {}, '7d ', h('b', {}, `${b.sevenDay ?? '?'}%`))] : [h('span', {}, 'budget unknown')]));
    const r = parseRoute();
    const here = r.name === 'home' ? 'home' : r.name === 'projects' ? 'projects' : r.name === 'project' ? `project:${r.id}` : r.name === 'brain' ? 'brain' : r.name === 'launches' || r.name === 'launch' ? 'launches' : '';
    const tab = (key, href, label) => h('a', { href, 'aria-current': here === key || (key === 'projects' && here.startsWith('project:')) ? 'page' : undefined }, label);
    navEl.replaceChildren(tab('home', '#/', 'Home'), tab('projects', '#/projects', 'Projects'), tab('brain', '#/brain', 'Brain'), tab('launches', '#/launches', 'Launches'));
    const projects = (data.projects ?? []).filter((p) => p.id !== unassigned.id);
    sideEl.replaceChildren(
      h('h4', {}, 'Projects'),
      ...[...projects, unassigned].map((p) => h('a', { href: `#/projects/${encodeURIComponent(p.id)}`, 'aria-current': here === `project:${p.id}` ? 'page' : undefined }, avatar(p.name, p.id), p.name)));
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

// ---- home ----------------------------------------------------------------

function attentionRow(a) {
  const [label, sev] = KIND[a.kind] ?? [a.kind, 'r'];
  const warn = sev === 'y';
  const open = a.href ? link(a.href, 'Open') : null;
  open?.classList.add('open-link');
  return h('div', { class: warn ? 'alert y' : 'alert' }, h('span', { class: warn ? 'tag y' : 'tag r' }, label), h('span', {}, a.text), h('span', { class: 'muted' }, a.repoName), h('span', { class: 'muted' }, ago(a.at)), open);
}

function waitingList(items) {
  const sorted = [...items].sort((x, y) => (Date.parse(y.at) || 0) - (Date.parse(x.at) || 0));
  return sorted.length ? h('div', {}, sorted.map(attentionRow)) : empty('Nothing is waiting on you.');
}

function runningNow(running) {
  const rows = [];
  for (const l of running?.launches ?? []) {
    rows.push(h('div', { class: 'card row' }, h('span', { class: 'live', role: 'img', 'aria-label': 'running' }), link(`#/launches/${l.id}`, l.action), h('span', {}, tilde(l.repo ?? '')), h('span', { class: 'muted' }, `${l.harness ?? ''} ${l.model ?? ''}`), h('span', { class: 'muted' }, duration(Date.now() - Date.parse(l.startedAt)))));
  }
  for (const p of running?.plans ?? []) {
    rows.push(h('div', { class: 'card row' },
      h('span', { class: 'live', role: 'img', 'aria-label': 'running' }),
      h('span', {}, p.repoName),
      link(`#/repos/${p.rid}/plans/${p.slug}`, p.title ?? p.slug),
      (p.roles ?? []).length ? h('span', { class: 'tiles' }, p.roles.map((r) => roleTile(r, 'sm'))) : null,
      progress(p.green, p.totals?.tasks, true),
      h('span', { class: 'muted' }, `wave ${p.currentWave ?? '?'}/${p.waveCount ?? '?'}`),
      p.launch ? h('span', { class: 'muted' }, `${p.launch.harness ?? ''} ${p.launch.model ?? ''}`) : null));
  }
  return rows.length ? h('div', {}, rows) : empty('Nothing is running.');
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

async function renderHome() {
  ctx.crumbs([['Home']]);
  const data = await api('/api/home');
  refreshChrome(data);
  const projectByRid = new Map((data.repos ?? []).map((r) => [r.rid, r.project]));
  const waiting = h('div', {});
  const paint = () => waiting.replaceChildren(waitingList([...data.attention, ...[...ghAttention.values()].flat()].filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i)));
  paint();
  const skillRepos = (data.repos ?? []).filter((r) => !r.hidden && !r.missing);
  const skillPick = h('select', { 'aria-label': 'Repository for skill' }, skillRepos.map((r) => h('option', { value: r.rid }, r.name ?? tilde(r.path ?? r.rid))));
  const skillRun = skillRepos.length ? h('div', { class: 'row' }, skillPick, h('button', { class: 'btn', type: 'button', onclick: () => openLaunchDialog({ action: 'skill', rid: skillPick.value }) }, 'Run a skill')) : null;
  main.replaceChildren(h('h1', {}, 'Home'), section('Waiting on you', waiting), section('Running now', runningNow(data.running), skillRun), section('Projects', projectsList(data.projects, data.repos?.length)), section('Activity', activityList(data.activity, (e) => projectByRid.get(e.rid) ?? unassigned.id)));
  // GitHub arrives later, one repository at a time, and joins the list as it comes.
  for (const r of data.repos ?? []) {
    api(`/api/repos/${r.rid}/github`).then((g) => {
      ghAttention.set(r.rid, g.attention ?? []);
      if (waiting.isConnected) paint();
    }).catch((err) => { if (err.status === 401) fatal(err); });
  }
}

// ---- project -------------------------------------------------------------

function githubBlock(rid) {
  const box = h('div', { class: 'stack' }, h('span', { class: 'muted' }, 'GitHub…'));
  api(`/api/repos/${rid}/github`).then((g) => {
    if (!g.connected) return box.replaceChildren(h('span', { class: 'muted' }, `not connected: ${g.reason ?? 'unknown'}`));
    const ci = { pass: 'green', fail: 'red', pending: 'yellow', none: 'grey' };
    box.replaceChildren(...(g.prs?.length ? g.prs.map((p) => h('div', { class: 'row' }, light(ci[p.ci] ?? 'grey', p.ci ?? 'none'), link(p.url, `#${p.number} ${p.title}`), h('span', { class: 'muted' }, `${p.draft ? 'draft · ' : ''}${p.review ?? ''}`))) : [h('span', { class: 'muted' }, 'No open PRs')]));
  }).catch((err) => box.replaceChildren(h('span', { class: 'muted' }, `not connected: ${err.message}`)));
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
  const card = h('div', { class: 'card accent stack' },
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
  card.style.setProperty('--accent', colorOf(data.project.id));
  return card;
}

async function renderProjects() {
  ctx.crumbs([['Home', '#/'], ['Projects']]);
  const data = await api('/api/home');
  refreshChrome(data);
  main.replaceChildren(h('h1', {}, 'Projects'), projectsList(data.projects, data.repos?.length));
}

async function renderProject({ id }) {
  const [data, ls] = await Promise.all([api(`/api/projects/${encodeURIComponent(id)}`), api('/api/launches')]);
  refreshChrome();
  const p = data.project;
  ctx.crumbs([['Home', '#/'], [p.name]]);
  const visible = data.repos.filter((r) => !r.hidden);
  const hidden = data.repos.filter((r) => r.hidden);
  const menu = p.id === unassigned.id ? null : menuFor(p, data.repos.length, data.projects ?? [], () => ctx.navigate('#/'));
  main.replaceChildren(
    h('div', { class: 'row' }, avatar(p.name, p.id, 'lg'), h('h1', {}, p.name), menu, addButton(data.projects ?? [], p.id)),
    h('div', { class: 'two-col' },
      h('div', {},
        visible.length ? visible.map((r) => repoCard(r, data, ls.launches ?? [])) : empty('No repositories here.'),
        hidden.length ? [h('h2', {}, 'Hidden'), hidden.map((r) => repoCard(r, data, ls.launches ?? []))] : null),
      h('div', { class: 'aside' }, section('Activity', activityList(data.activity, () => p.id)))));
}

// ---- launches ------------------------------------------------------------

async function renderLaunches() {
  ctx.crumbs([['Home', '#/'], ['Launches']]);
  const { launches } = await api('/api/launches');
  refreshChrome();
  const rows = launches.map((l) => h('tr', {},
    h('td', {}, link(`#/launches/${l.id}`, l.action)),
    h('td', {}, tilde(l.repo ?? '')),
    h('td', {}, l.harness ?? ''),
    h('td', {}, l.model ?? ''),
    h('td', {}, light(LAUNCH_LIGHT[l.status] ?? 'grey', l.status), l.outcome ? h('span', { class: 'muted' }, ` ${l.outcome}`) : null),
    h('td', {}, duration(l.durationMs)),
    h('td', {}, usd(l.costUsd))));
  main.replaceChildren(h('h1', {}, 'Launches'), launches.length
    ? h('table', { class: 'list' }, h('thead', {}, h('tr', {}, ['Action', 'Repository', 'Harness', 'Model', 'Status', 'Duration', 'Cost'].map((c) => h('th', {}, c)))), h('tbody', {}, rows))
    : empty('No launches yet.'));
}

async function renderLaunch({ id }) {
  ctx.crumbs([['Home', '#/'], ['Launches', '#/launches'], [id]]);
  const l = await api(`/api/launches/${encodeURIComponent(id)}`);
  const log = h('pre', { class: 'code', 'aria-label': 'Log' }, l.log ?? '');
  main.replaceChildren(
    h('h1', {}, `${l.action} · ${tilde(l.repo ?? '')}`),
    h('div', { class: 'row' }, light(LAUNCH_LIGHT[l.status] ?? 'grey', l.status), l.status === 'running' ? h('button', { class: 'btn danger', type: 'button', onclick: () => post(`/api/launches/${l.id}/stop`, {}).then(() => route()) }, 'Stop') : null, l.outcome ? h('span', { class: 'muted' }, `outcome ${l.outcome}`) : null),
    h('pre', { class: 'code', 'aria-label': 'Command' }, l.display ?? ''),
    h('div', { class: 'row muted' }, h('span', {}, `exit code ${l.exitCode ?? '-'}`), h('span', {}, `cost ${usd(l.costUsd)}`), h('span', {}, `started ${when(l.startedAt)}`), h('span', {}, l.endedAt ? `ended ${when(l.endedAt)}` : '')),
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
    main.replaceChildren(errorBox(err));
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
    if (r.name === 'home') out = await renderHome();
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
    }
    current = out ?? { poll: true };
  } catch (err) {
    if (err.status === 401) fatal(err);
    else {
      current = { poll: true };
      main.replaceChildren(errorBox(err));
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
  current = { poll: true };
  fresh = true;
  refreshChrome();
  route();
}

captureToken();
if (!token()) {
  main.replaceChildren(h('p', { class: 'empty' }, 'Open relay HQ with `relay hq`; the link it opens carries the access key.'));
} else {
  window.addEventListener('hashchange', onRoute);
  onRoute();
  setInterval(() => !stopped && refreshChrome(), 30_000);
  setInterval(() => {
    if (stopped || document.visibilityState !== 'visible' || dialog.open || document.querySelector('details.menu[open]') || current?.poll === false) return;
    route();
  }, 5000);
}
