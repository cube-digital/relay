// relay HQ page: router, the sidebar (All, projects, Setup) and top bar, polling, and a launch's
// log. All and a project, a run, Setup and a routine's history load on demand from their own modules.

import { api, captureToken, copyButton, errorBox, fill, h, light, link, tilde, token } from './dom.js';
import { parseRoute } from './routes.js';

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
let lastSidebar = null; // the last /api/sidebar
let sidebarCache = null; // { at, promise }: one /api/sidebar for the chrome and the view

const ctx = {
  crumbs(items) {
    fill(crumbsEl, ...items.map(([label, href]) => (href ? link(href, label) : h('span', { 'aria-current': 'page' }, label))));
  },
  navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
  refresh: () => {
    sidebarCache = null;
    return route().then(() => refreshChrome());
  },
  // /api/sidebar, shared by the sidebar and the view for 2 s.
  sidebar() {
    if (!sidebarCache || Date.now() - sidebarCache.at > 2000) sidebarCache = { at: Date.now(), promise: api('/api/sidebar') };
    sidebarCache.promise.catch(() => { sidebarCache = null; });
    return sidebarCache.promise;
  },
  get repos() { return lastSidebar?.repos ?? []; },
  projectOf(rid) {
    const repo = ctx.repos.find((r) => r.rid === rid);
    if (!repo) return null;
    const id = repo.projectId ?? UNASSIGNED;
    const p = (lastSidebar?.projects ?? []).find((x) => x.id === id);
    return p ? { id: p.id, name: p.name } : null;
  },
  openLaunch: (intent, opts = {}) => import('./launch-dialog.js').then((m) => m.openLaunchDialog(intent, { repos: opts.repos ?? ctx.repos, defaultRid: lastActive })),
};

function fatal(err) {
  stopped = true;
  fill(crumbsEl);
  fill(main, err?.status === 401 ? errorBox(new Error('The access key is no longer valid. Run relay hq again.')) : errorBox(err));
}

// ---- sidebar and top bar ---------------------------------------------------

async function refreshChrome() {
  try {
    const data = await ctx.sidebar();
    lastSidebar = data;
    lastActive = data.repos?.[0]?.rid ?? null;
    const b = data.budget;
    budgetEl.className = `budget ${b?.level ?? ''}`;
    budgetEl.title = b?.resetsAt ? `5h window resets ${new Date(b.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
    fill(budgetEl, ...(b ? [h('span', {}, '5h ', h('b', {}, `${b.fiveHour ?? '?'}%`)), h('span', {}, '7d ', h('b', {}, `${b.sevenDay ?? '?'}%`))] : [h('span', {}, 'budget unknown')]));
    const r = parseRoute(location.hash);
    const here = r.name === 'run' ? ctx.projectOf(r.rid)?.id : r.name === 'project' ? r.id : null;
    const badges = (needs, live) => ((needs > 0 || live > 0)
      ? h('span', { class: 'b' }, needs > 0 ? h('span', { class: 'n r' }, `●${needs}`) : null, live > 0 ? h('span', { class: 'n l' }, `▶${live}`) : null)
      : null);
    const all = data.all ?? {};
    const projects = data.projects ?? [];
    fill(sideEl,
      h('a', { class: 'brand', href: '#/' }, h('span', { class: 'hex', 'aria-hidden': 'true' }), 'RELAY ', h('span', {}, 'HQ')),
      h('a', { href: '#/', 'aria-current': r.name === 'all' ? 'page' : undefined }, '★ All', all.needs > 0 ? h('span', { class: 'b' }, h('span', { class: 'n r' }, `●${all.needs}`)) : null),
      h('div', { class: 'sep' }),
      projects.map((p) => h('a', { href: `#/projects/${encodeURIComponent(p.id)}`, 'aria-current': here === p.id ? 'page' : undefined }, h('span', { class: 'lb' }, p.name), badges(p.needs, p.live))),
      h('div', { class: 'grow' }),
      h('a', { href: '#/setup/team', 'aria-current': r.name === 'setup' || r.name === 'routine' ? 'page' : undefined }, '⚙ Setup'));
  } catch (err) {
    if (err.status === 401) fatal(err);
  }
}

// ---- a launch --------------------------------------------------------------

async function renderLaunch({ id }) {
  ctx.crumbs([['All', '#/'], [id]]);
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
  const retry = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const next = await api(`/api/launches/${encodeURIComponent(l.id)}/retry`, { method: 'POST', body: {} });
      ctx.navigate(`#/launches/${encodeURIComponent(next.id ?? next.launch?.id ?? "")}`);
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
    }
  };
  fill(main,
    h('h1', {}, `${l.action} · ${tilde(l.repo ?? '')}`),
    h('div', { class: 'row' }, light(LAUNCH_LIGHT[l.status] ?? 'grey', l.status), l.status === 'running' ? h('button', { class: 'btn danger', type: 'button', onclick: stop }, 'Stop') : null, l.retryable ? h('button', { class: 'btn ac', type: 'button', onclick: retry }, 'Retry') : null, l.outcome ? h('span', { class: 'muted' }, `outcome ${l.outcome}`) : null),
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
    const r = parseRoute(location.hash);
    let out;
    if (r.name === 'all' || r.name === 'project') out = await lazy('./overview.js', (m) => m.renderOverview(main, { project: r.name === 'all' ? 'all' : r.id }, ctx));
    else if (r.name === 'run') {
      ctx.crumbs([['All', '#/'], [r.slug]]);
      out = await lazy('./plan.js', (m) => m.renderPlan(main, { rid: r.rid, slug: r.slug, task: r.task }, ctx));
    } else if (r.name === 'setup') {
      ctx.crumbs([['Setup', '#/setup/team']]);
      out = await lazy('./setup.js', (m) => m.renderSetup(main, { tab: r.tab }, ctx));
    } else if (r.name === 'routine') {
      ctx.crumbs([['Setup', '#/setup/team'], ['Routines', '#/setup/routines'], [r.id]]);
      out = await lazy('./routines.js', (m) => m.renderRoutine(main, { id: r.id }, ctx));
    } else if (r.name === 'launch') out = await renderLaunch(r);
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
      if (parseRoute(location.hash).name !== 'all') main.focus({ preventScroll: true });
    }
    if (again) { again = false; route(); }
  }
}

function onRoute() {
  const r = parseRoute(location.hash);
  if (r.redirect && r.redirect !== location.hash) history.replaceState(null, '', r.redirect);
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
  import('./search.js').then((m) => m.openSearch(ctx)).catch(() => {});
});

for (const el of document.querySelectorAll('[data-search]')) el.addEventListener('click', () => import('./search.js').then((m) => m.openSearch(ctx)));

captureToken();
if (!token()) {
  fill(main, h('p', { class: 'empty' }, 'Open relay HQ with `relay hq`; the link it opens carries the access key.'));
} else {
  window.addEventListener('hashchange', onRoute);
  onRoute();
  setInterval(() => !stopped && document.visibilityState === 'visible' && refreshChrome(), 30_000);
  setInterval(() => {
    if (stopped || document.visibilityState !== 'visible' || busy() || current?.poll === false) return;
    sidebarCache = null;
    route().then(() => refreshChrome());
  }, 5000);
}
