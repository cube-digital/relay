// relay HQ page: router, the section sidebar and top bar, polling, and the Activity and
// Launches views. Home, Projects, Plans, a plan's board, Recos, Routines and Brain are loaded
// on demand from their own modules.

import { api, captureToken, copyButton, duration, empty, errorBox, fill, h, harnessLabel, light, link, tabNav, tilde, token } from './dom.js';
import { activityGroups } from './activity.js';

const main = document.getElementById('view');
const crumbsEl = document.querySelector('.crumbs');
const budgetEl = document.querySelector('.budget');
const sideEl = document.querySelector('.side');
const dialog = document.getElementById('launch');

const LAUNCH_LIGHT = { running: 'yellow', done: 'green', failed: 'red', lost: 'red', stopped: 'grey' };
const usd = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');
const UNASSIGNED = '_unassigned';

let stopped = false;
let current = { poll: true };
let rendering = false;
let again = false;
let fresh = false; // the next finished render follows a route change: rise in once
let lastActive = null; // rid of the most recently active repository
let lastRepos = []; // repos of the last /api/home, for the launch dialog
let homeCache = null; // { at, promise }: one /api/home for the chrome and the view

const ctx = {
  crumbs(items) {
    fill(crumbsEl, ...items.map(([label, href]) => (href ? link(href, label) : h('span', { 'aria-current': 'page' }, label))));
  },
  navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
  refresh: () => {
    homeCache = null;
    return route().then(() => refreshChrome());
  },
  // /api/home, shared by the sidebar and the view for 2 s.
  home() {
    if (!homeCache || Date.now() - homeCache.at > 2000) homeCache = { at: Date.now(), promise: api('/api/home') };
    homeCache.promise.catch(() => { homeCache = null; });
    return homeCache.promise;
  },
  get repos() { return lastRepos; },
  openLaunch: (intent) => import('./launch-dialog.js').then((m) => m.openLaunchDialog(intent, { repos: ctx.repos, defaultRid: lastActive })),
};

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'recos') return { name: 'recos' };
  if (parts[0] === 'activity') return { name: 'activity' };
  if (parts[0] === 'plans') return { name: 'plans' };
  if (parts[0] === 'projects' && !parts[1]) return { name: 'projects' };
  if (parts[0] === 'projects' && parts[1]) return { name: 'project', id: parts[1], tab: parts[2] };
  if (parts[0] === 'repos' && parts[2] === 'plans' && parts[1] && parts[3]) return { name: 'plan', rid: parts[1], slug: parts[3], task: parts[4] === 'tasks' ? parts[5] : undefined };
  if (parts[0] === 'brain') return { name: 'brain', tab: parts[1] };
  if (parts[0] === 'launches') return parts[1] ? { name: 'launch', id: parts[1] } : { name: 'launches' };
  if (parts[0] === 'routines') return parts[1] ? { name: 'routine', id: parts[1] } : { name: 'routines' };
  return { name: 'home' };
}

// The sidebar section a route belongs to.
const SECTION = { home: 'home', projects: 'projects', project: 'projects', plans: 'plans', plan: 'plans', routines: 'routines', routine: 'routines', recos: 'recos', activity: 'activity', launches: 'activity', launch: 'activity', brain: 'brain' };

function fatal(err) {
  stopped = true;
  fill(crumbsEl);
  fill(main, err?.status === 401 ? errorBox(new Error('The access key is no longer valid. Run relay hq again.')) : errorBox(err));
}

// ---- sidebar and top bar ---------------------------------------------------

async function refreshChrome() {
  try {
    const data = await ctx.home();
    lastRepos = data.repos ?? [];
    lastActive = (data.activity ?? []).find((e) => e.rid && lastRepos.some((r) => r.rid === e.rid))?.rid ?? lastRepos[0]?.rid ?? null;
    const b = data.budget;
    budgetEl.className = `budget ${b?.level ?? ''}`;
    budgetEl.title = b?.resetsAt ? `5h window resets ${new Date(b.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
    fill(budgetEl, ...(b ? [h('span', {}, '5h ', h('b', {}, `${b.fiveHour ?? '?'}%`)), h('span', {}, '7d ', h('b', {}, `${b.sevenDay ?? '?'}%`))] : [h('span', {}, 'budget unknown')]));
    const r = parseRoute();
    const here = SECTION[r.name];
    const ring = Object.fromEntries((data.ring ?? []).map((i) => [i.id, i]));
    const waiting = (data.attention ?? []).length;
    const live = data.running?.plans ?? [];
    const running = live.filter((p) => p.status === 'running').length;
    const blockedPlans = live.filter((p) => p.status === 'blocked').length;
    const badge = (text, hot) => (text ? h('span', { class: hot ? 'badge hot' : 'badge' }, text) : null);
    const item = (id, label, glyph, href, b) => h('a', { href, class: 'nav', 'aria-current': here === id ? 'page' : undefined }, h('span', { class: 'gl', 'aria-hidden': 'true' }, glyph), h('span', { class: 'lb' }, label), b);
    const projects = data.projects ?? [];
    const ordered = [...projects.filter((p) => p.id !== UNASSIGNED), ...projects.filter((p) => p.id === UNASSIGNED)];
    fill(sideEl,
      h('a', { class: 'brand', href: '#/' }, h('span', { class: 'hex', 'aria-hidden': 'true' }), 'RELAY ', h('span', {}, 'HQ')),
      h('nav', { class: 'sections', 'aria-label': 'Sections' },
        item('home', 'Home', '◎', '#/', badge(waiting ? String(waiting) : '', waiting > 0)),
        item('projects', 'Projects', '▦', '#/projects', null),
        item('plans', 'Plans', '☰', '#/plans', blockedPlans ? h('span', { class: 'badge red' }, `${blockedPlans} blocked`) : badge(running ? `${running} live` : '', false)),
        item('routines', 'Routines', '◷', '#/routines', badge(ring.routines?.hot ? 'new' : '', ring.routines?.hot)),
        item('recos', 'Recos', '✦', '#/recos', badge(ring.recos?.count && ring.recos.count !== '0' ? ring.recos.count : '', ring.recos?.hot)),
        item('activity', 'Activity', '≋', '#/activity', null),
        item('brain', 'Brain', '⚙', '#/brain', badge(ring.brain?.hot ? '!' : '', ring.brain?.hot))),
      h('h4', {}, 'Projects'),
      h('nav', { class: 'plinks', 'aria-label': 'Projects' }, ordered.length
        ? ordered.map((p) => {
          const dot = p.blocked > 0 ? 'red' : (p.waiting ?? 0) > 0 ? 'ac' : p.running > 0 ? 'run' : '';
          const id = encodeURIComponent(p.id);
          return h('a', { href: `#/projects/${id}`, 'aria-current': r.name === 'project' && r.id === p.id ? 'page' : undefined },
            h('span', { class: `dot ${dot}`, 'aria-hidden': 'true' }), h('span', { class: 'lb' }, p.name), (p.waiting ?? 0) > 0 ? h('span', { class: 'badge hot' }, String(p.waiting)) : null);
        })
        : h('span', { class: 'muted' }, 'No projects yet.')));
  } catch (err) {
    if (err.status === 401) fatal(err);
  }
}

// ---- activity and launches -------------------------------------------------

const activityTabs = (current, launches) => tabNav([['activity', 'Activity', '#/activity'], ['launches', 'Launches', '#/launches', launches]], current);

async function renderActivity() {
  ctx.crumbs([['Home', '#/'], ['Activity']]);
  const [data, { launches }] = await Promise.all([ctx.home(), api('/api/launches')]);
  const projectByRid = new Map((data.repos ?? []).map((r) => [r.rid, r.project]));
  fill(main, h('h1', {}, 'Activity'), activityTabs('activity', launches.length), activityGroups(data.activity, (e) => projectByRid.get(e.rid) ?? UNASSIGNED, empty));
}

async function renderLaunches() {
  ctx.crumbs([['Home', '#/'], ['Activity', '#/activity'], ['Launches']]);
  const { launches } = await api('/api/launches');
  const rows = launches.map((l) => h('tr', {},
    h('td', {}, link(`#/launches/${l.id}`, l.action)),
    h('td', {}, tilde(l.repo ?? '')),
    h('td', {}, harnessLabel(l.harness)),
    h('td', {}, l.model ?? ''),
    h('td', {}, light(LAUNCH_LIGHT[l.status] ?? 'grey', l.status), l.outcome ? h('span', { class: 'muted' }, ` ${l.outcome}`) : null),
    h('td', {}, duration(l.durationMs)),
    h('td', {}, usd(l.costUsd))));
  fill(main, h('h1', {}, 'Activity'), activityTabs('launches', launches.length), launches.length
    ? h('table', { class: 'list' }, h('thead', {}, h('tr', {}, ['Action', 'Repository', 'Harness', 'Model', 'Status', 'Duration', 'Cost'].map((c) => h('th', {}, c)))), h('tbody', {}, rows))
    : empty('No launches yet.'));
}

async function renderLaunch({ id }) {
  ctx.crumbs([['Home', '#/'], ['Activity', '#/activity'], ['Launches', '#/launches'], [id]]);
  const l = await api(`/api/launches/${encodeURIComponent(id)}`);
  const log = h('pre', { class: 'code log', 'aria-label': 'Log' }, l.log ?? '');
  const stop = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api(`/api/launches/${l.id}/stop`, { method: 'POST', body: {} });
    } catch (err) {
      alert(err.message);
    }
    route();
  };
  fill(main,
    h('h1', {}, `${l.action} · ${tilde(l.repo ?? '')}`),
    h('div', { class: 'row' }, light(LAUNCH_LIGHT[l.status] ?? 'grey', l.status), l.status === 'running' ? h('button', { class: 'btn danger', type: 'button', onclick: stop }, 'Stop') : null, l.outcome ? h('span', { class: 'muted' }, `outcome ${l.outcome}`) : null),
    h('div', { class: 'row muted' }, l.display ? copyButton('Copy command', l.display) : null, h('span', {}, `exit code ${l.exitCode ?? '-'}`), h('span', {}, `cost ${usd(l.costUsd)}`), h('span', {}, `started ${when(l.startedAt)}`), h('span', {}, l.endedAt ? `ended ${when(l.endedAt)}` : '')),
    l.error ? errorBox(new Error(l.error)) : null,
    h('h2', {}, 'Log'),
    log);
  log.scrollTop = log.scrollHeight;
  return { poll: l.status === 'running' };
}

// ---- router and polling ----------------------------------------------------

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
    else if (r.name === 'projects') out = await lazy('./projects.js', (m) => m.renderProjects(main, {}, ctx));
    else if (r.name === 'project') out = await lazy('./projects.js', (m) => m.renderProject(main, { id: r.id, tab: r.tab }, ctx));
    else if (r.name === 'plans') out = await lazy('./plans.js', (m) => m.renderPlans(main, {}, ctx));
    else if (r.name === 'launches') out = await renderLaunches();
    else if (r.name === 'launch') out = await renderLaunch(r);
    else if (r.name === 'plan') {
      ctx.crumbs([['Home', '#/'], ['Plans', '#/plans'], [r.slug]]);
      out = await lazy('./plan.js', (m) => m.renderPlan(main, { rid: r.rid, slug: r.slug, task: r.task }, ctx));
    } else if (r.name === 'brain') {
      ctx.crumbs([['Home', '#/'], ['Brain', '#/brain']]);
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
      if (parseRoute().name !== 'home') main.focus({ preventScroll: true });
    }
    if (again) { again = false; route(); }
  }
}

function onRoute() {
  const home = parseRoute().name === 'home';
  // The layout (side, top bar) and main switch together: the old view never shows in the other layout while the new one loads.
  if (document.body.classList.contains('home') !== home) fill(main);
  document.body.classList.toggle('home', home);
  if (dialog.open) dialog.close();
  current = { poll: true };
  fresh = true;
  window.scrollTo?.(0, 0);
  refreshChrome();
  route();
}

// The user is typing or has a menu open: a re-render would throw that away.
function busy() {
  if (dialog.open || document.querySelector('details.menu[open]')) return true;
  const a = document.activeElement;
  return Boolean(a && main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || dialog.open) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
  e.preventDefault();
  if (parseRoute().name === 'recos') document.querySelector('[data-filter]')?.focus();
  else import('./search.js').then((m) => m.openSearch(ctx)).catch(() => {});
});

for (const el of document.querySelectorAll('[data-search]')) el.addEventListener('click', () => import('./search.js').then((m) => m.openSearch(ctx)));
for (const el of document.querySelectorAll('[data-run]')) el.addEventListener('click', () => ctx.openLaunch({ action: 'skill' }));

captureToken();
if (!token()) {
  fill(main, h('p', { class: 'empty' }, 'Open relay HQ with `relay hq`; the link it opens carries the access key.'));
} else {
  window.addEventListener('hashchange', onRoute);
  onRoute();
  setInterval(() => !stopped && document.visibilityState === 'visible' && refreshChrome(), 30_000);
  setInterval(() => {
    if (stopped || document.visibilityState !== 'visible' || busy() || current?.poll === false) return;
    homeCache = null;
    route().then(() => refreshChrome());
  }, 5000);
}
