// The Projects page (one card per project) and a project's page: Overview (what needs you,
// what is running, the plans), Tasks (every task of every plan, filtered by state), Plans,
// Repositories and Activity. Everything from the API goes in as text.

import { ago, api, avatar, empty, errorBox, fill, githubOf, h, kpi, light, link, planTag, plural, progress, tabNav, tag, tilde, GLYPH } from './dom.js';
import { openAddDialog } from './add-dialog.js';
import { openLaunchDialog } from './launch-dialog.js';
import { activityGroups } from './activity.js';
import { projectMenu } from './project-menu.js';
import { needsRow, planList, planRow } from './plan-row.js';
import { planPanel } from './running.js';

const UNASSIGNED = '_unassigned';
const TABS = ['overview', 'tasks', 'plans', 'repos', 'activity'];
const TASK_FILTERS = [
  ['open', 'Open', (s) => s !== 'done' && s !== 'merged'],
  ['working', 'In progress', (s) => s === 'working'],
  ['blocked', 'Blocked', (s) => s === 'blocked'],
  ['todo', 'To do', (s) => s === 'planned' || s === 'queued'],
  ['done', 'Implemented', (s) => s === 'done' || s === 'merged'],
  ['all', 'All', () => true],
];
const TASK_TAG = { planned: ['to do'], queued: ['queued'], working: ['in progress', 'ac'], blocked: ['blocked', 'red'], done: ['done, not merged', 'ac'], merged: ['merged'] };

const STATE_ORDER = { blocked: 0, working: 1, queued: 2, planned: 3, done: 4, merged: 5 };
let taskFilter = 'open'; // survives the 5 s refresh
let taskQuery = '';
let hideDonePlans = true;

const btn = (label, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, label);

async function post(path, body) {
  try {
    return await api(path, { method: 'POST', body });
  } catch (err) {
    alert(err.message);
    throw err;
  }
}

// ---- the Projects page ------------------------------------------------------

function projectCard(p, plans, repos, projects, ctx) {
  const mine = plans.filter((x) => x.project === p.id);
  const active = mine.filter((x) => x.status !== 'complete');
  const tasks = mine.reduce((n, x) => n + (x.totals?.tasks ?? 0), 0);
  const green = mine.reduce((n, x) => n + (x.green ?? 0), 0);
  const open = active.reduce((n, x) => n + Math.max(0, (x.totals?.tasks ?? 0) - (x.green ?? 0)), 0);
  const running = mine.filter((x) => x.status === 'running').length;
  const names = repos.filter((r) => (r.project ?? UNASSIGNED) === p.id).map((r) => r.name);
  const href = `#/projects/${encodeURIComponent(p.id)}`;
  const latest = mine.map((x) => x.lastAt).filter(Boolean).sort().pop();
  const menu = p.id === UNASSIGNED ? null : projectMenu({ project: p, repoCount: p.repos ?? 0, projects: projects.filter((x) => x.id !== UNASSIGNED), onChange: () => ctx.refresh(), onDeleted: () => ctx.refresh() });
  return h('div', { class: (p.waiting ?? 0) > 0 ? 'card pcard hot' : 'card pcard' },
    h('div', { class: 'row between' },
      h('a', { class: 'pname', href }, avatar(p.name, p.id, null, (p.waiting ?? 0) > 0), h('h3', {}, p.name)),
      menu),
    h('div', { class: 'row chips' },
      (p.waiting ?? 0) > 0 ? tag(`${p.waiting} need you`, p.blocked > 0 ? 'red' : 'ac') : null,
      running ? tag(`${running} running`, 'ac') : null,
      tag(plural(mine.length, 'plan', 'plans')),
      tag(plural(p.repos ?? 0, 'repo', 'repos'))),
    tasks ? h('div', { class: 'row' }, progress(green, tasks, running > 0), h('span', { class: 'mono muted' }, `${green}/${tasks} tasks green · ${open} open`)) : h('span', { class: 'muted' }, 'No plans yet.'),
    h('span', { class: 'muted repos' }, names.join(' · ') || 'No repositories.'),
    h('div', { class: 'row between foot' }, h('span', { class: 'muted' }, latest ? `active ${ago(latest)}` : ''), h('a', { class: 'btn ac', href }, 'Open →')));
}

export async function renderProjects(main, _params, ctx) {
  ctx.crumbs([['Home', '#/'], ['Projects']]);
  const [home, { plans }] = await Promise.all([ctx.home(), api('/api/plans')]);
  const projects = home.projects ?? [];
  const real = projects.filter((p) => p.id !== UNASSIGNED);
  const add = btn('Add repository', () => openAddDialog({ projects: real, onDone: () => ctx.refresh() }), 'btn ac');
  const create = btn('New project', async () => {
    const name = prompt('Project name');
    if (!name?.trim()) return;
    try {
      const r = await post('/api/registry', { op: 'create-project', name: name.trim() });
      ctx.navigate(`#/projects/${encodeURIComponent(r.id)}`);
    } catch { /* alerted */ }
  });
  const head = h('div', { class: 'phead' }, h('h1', {}, 'Projects'), h('div', { class: 'row' }, create, add));
  if (!projects.length) {
    fill(main, head, empty('No repositories yet.'), h('pre', { class: 'code' }, 'relay hq add <path> --project <name>'));
    return { poll: true };
  }
  const ordered = [...real, ...projects.filter((p) => p.id === UNASSIGNED)];
  fill(main, head, h('div', { class: 'grid pgrid' }, ordered.map((p) => projectCard(p, plans ?? [], home.repos ?? [], projects, ctx))));
  return { poll: true };
}

// ---- a project ---------------------------------------------------------------

function githubBlock(rid) {
  const box = h('div', { class: 'stack' }, h('span', { class: 'muted' }, 'GitHub…'));
  githubOf(rid).then((g) => {
    if (!g.connected) return fill(box, h('span', { class: 'muted' }, `GitHub not connected: ${g.reason ?? 'unknown'}`));
    const ci = { pass: 'green', fail: 'red', pending: 'yellow', none: 'grey' };
    fill(box, ...(g.prs?.length ? g.prs.map((p) => h('div', { class: 'row' }, light(ci[p.ci] ?? 'grey', p.ci ?? 'none'), link(p.url, `#${p.number} ${p.title}`), h('span', { class: 'muted' }, `${p.draft ? 'draft · ' : ''}${p.review ?? ''}`))) : [h('span', { class: 'muted' }, 'No open PRs')]));
  });
  return box;
}

function moveSelect(repo, projects, projectId, ctx) {
  const sel = h('select', { 'aria-label': `Project of ${repo.name}` },
    h('option', { value: '' }, 'No project'),
    projects.map((p) => h('option', { value: p.id }, p.name)),
    h('option', { value: '__new' }, 'New project…'));
  sel.value = projectId === UNASSIGNED ? '' : projectId;
  sel.addEventListener('change', async () => {
    try {
      let target = sel.value || null;
      if (sel.value === '__new') {
        const name = prompt('Project name');
        if (!name?.trim()) return ctx.refresh();
        target = (await post('/api/registry', { op: 'create-project', name: name.trim() })).id;
      }
      await post('/api/registry', { op: 'assign', rid: repo.rid, project: target });
    } catch { /* alerted */ }
    ctx.refresh();
  });
  return sel;
}

function repoCard(repo, data, ctx) {
  const g = repo.git ?? {};
  const registry = (body) => post('/api/registry', body).then(() => ctx.refresh()).catch(() => {});
  const head = repo.missing
    ? h('div', { class: 'row' }, h('span', { class: 'error' }, 'missing on disk'), btn('Remove from HQ', () => confirm(`Remove ${repo.name} from HQ?`) && registry({ op: 'remove', rid: repo.rid }), 'btn danger'))
    : h('div', { class: 'row' },
      h('span', { class: 'chip' }, g.branch ?? '?'),
      h('span', { class: 'muted' }, `${g.dirty ?? 0} uncommitted`),
      h('span', { class: 'muted' }, `↑${g.ahead ?? 0} ↓${g.behind ?? 0}`),
      h('span', { class: 'muted' }, plural(repo.worktrees?.length ?? 0, 'lane worktree', 'lane worktrees')),
      h('span', { class: 'muted' }, plural(repo.plans?.length ?? 0, 'plan', 'plans')));
  return h('div', { class: 'card stack repo' },
    h('div', { class: 'row between' }, h('div', {}, h('h3', {}, repo.name ?? tilde(repo.path)), h('span', { class: 'muted' }, tilde(repo.path))), repo.hidden ? tag('hidden') : null),
    head,
    repo.error ? errorBox(new Error(repo.error)) : null,
    repo.missing ? null : h('div', { class: 'row' },
      btn('+ New plan', () => openLaunchDialog({ action: 'plan', rid: repo.rid }), 'btn ac'),
      repo.codexSetup ? null : btn('Set up Codex', () => openLaunchDialog({ action: 'setup-codex', rid: repo.rid }))),
    h('div', { class: 'row' },
      h('label', { class: 'inline' }, 'Project ', moveSelect(repo, data.projects ?? [], data.project.id, ctx)),
      btn(repo.hidden ? 'Unhide' : 'Hide', () => registry({ op: repo.hidden ? 'unhide' : 'hide', rid: repo.rid })),
      repo.missing ? null : btn('Remove from HQ', () => confirm(`Remove ${repo.name} from HQ? Nothing on disk changes.`) && registry({ op: 'remove', rid: repo.rid }), 'btn danger')),
    repo.missing ? null : githubBlock(repo.rid));
}

// Plans of a project's repositories, shaped like /api/plans rows.
function plansOf(data) {
  return data.repos.filter((r) => !r.hidden).flatMap((r) => (r.plans ?? []).map((p) => {
    const live = (data.launches ?? []).find((l) => l.repo === r.path && l.plan === p.file);
    const blockedLanes = (p.board?.waves ?? []).flatMap((w) => w.lanes.filter((l) => l.state === 'blocked').map((l) => ({ lane: l.id, note: l.note })));
    return { ...p, rid: r.rid, repoName: r.name, blockedLanes, launch: live ? { id: live.id } : null };
  })).sort((a, b) => String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')));
}

function tasksOf(plans) {
  return plans.flatMap((p) => (p.board?.waves ?? []).flatMap((w) => w.lanes.flatMap((l) => l.tasks.map((t) => ({ ...t, lane: l.id, wave: w.wave, plan: p })))));
}

function overview(data, plans, attention, ctx) {
  const running = data.running ?? [];
  const launches = (data.launches ?? []).filter((l) => !running.some((r) => r.launch?.id === l.id));
  const newPlan = () => openLaunchDialog({ action: 'plan' }, { repos: data.repos.filter((r) => !r.hidden && !r.missing).map((r) => ({ rid: r.rid, name: r.name })) });
  const active = plans.filter((p) => p.status !== 'complete' || p.readyToMerge);
  const done = plans.length - active.length;
  return [
    h('section', { class: 'needs' }, h('h2', {}, 'Needs you', h('span', { class: 'n' }, String(attention.length))),
      attention.length ? h('div', { class: 'nlist' }, attention.map((a) => needsRow(a, { refresh: ctx.refresh }))) : empty('Nothing needs you.')),
    h('section', {}, h('h2', {}, 'Running now', h('span', { class: 'n' }, String(running.length + launches.length))),
      running.length || launches.length
        ? h('div', { class: 'stack' },
          running.map((p) => planPanel(p)),
          launches.map((l) => h('div', { class: 'card row' }, tag('running', 'ac'), h('b', {}, l.action), h('span', { class: 'muted' }, `${tilde(l.repo ?? '')} · started ${ago(l.startedAt)}`), h('a', { class: 'btn', href: `#/launches/${l.id}` }, 'Log'), btn('Stop', () => post(`/api/launches/${l.id}/stop`, {}).then(ctx.refresh).catch(() => {}), 'btn danger'))))
        : h('div', { class: 'card row between idle' }, h('span', { class: 'muted' }, 'Nothing is running.'), btn('+ New plan', newPlan, 'btn ac'))),
    h('section', {}, h('h2', {}, 'Plans', h('span', { class: 'n' }, String(plans.length)), done ? h('a', { class: 'more-link', href: `#/projects/${encodeURIComponent(data.project.id)}/plans` }, `${done} done →`) : null),
      active.length ? h('div', { class: 'plist' }, active.map((p) => planRow(p, { refresh: ctx.refresh }))) : empty(plans.length ? 'Every plan is done.' : 'No plans yet.')),
  ];
}

function tasksView(plans, redraw) {
  const all = tasksOf(plans.filter((p) => !(hideDonePlans && p.status === 'complete' && !p.readyToMerge)));
  const count = (fn) => all.filter((t) => fn(t.state)).length;
  const [, , match] = TASK_FILTERS.find(([id]) => id === taskFilter) ?? TASK_FILTERS[0];
  const q = taskQuery.trim().toLowerCase();
  const shown = all.filter((t) => match(t.state) && (!q || `${t.id} ${t.title} ${t.plan.slug}`.toLowerCase().includes(q)));
  const search = h('input', { type: 'search', 'aria-label': 'Filter tasks', placeholder: 'Filter tasks', value: taskQuery });
  search.addEventListener('input', () => { taskQuery = search.value; redraw(true); });
  const doneToggle = h('label', { class: 'inline muted' }, h('input', { type: 'checkbox', checked: !hideDonePlans, onchange: (e) => { hideDonePlans = !e.target.checked; redraw(); } }), ' include finished plans');
  const byPlan = new Map();
  for (const t of shown) {
    const key = `${t.plan.rid}/${t.plan.slug}`;
    if (!byPlan.has(key)) byPlan.set(key, { plan: t.plan, tasks: [] });
    byPlan.get(key).tasks.push(t);
  }
  for (const g of byPlan.values()) g.tasks.sort((a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9));
  return [
    h('div', { class: 'row toolbar' },
      h('div', { class: 'filters' }, TASK_FILTERS.map(([id, label, fn]) => h('button', { type: 'button', 'aria-pressed': taskFilter === id ? 'true' : 'false', onclick: () => { taskFilter = id; redraw(); } }, `${label} `, h('span', { class: 'n' }, String(count(fn)))))),
      search, doneToggle),
    shown.length ? [...byPlan.values()].map(({ plan, tasks }) => {
      const board = `#/repos/${encodeURIComponent(plan.rid)}/plans/${encodeURIComponent(plan.slug)}`;
      return h('section', { class: 'tgroup' },
        h('div', { class: 'thead' }, planTag(plan), h('a', { href: board }, h('b', {}, plan.slug)), h('span', { class: 'muted' }, plan.repoName), h('span', { class: 'muted' }, plural(tasks.length, 'task', 'tasks'))),
        tasks.map((t) => {
          const [label, variant] = TASK_TAG[t.state] ?? [t.state];
          return h('a', { class: `trow ${t.state}`, href: `${board}/tasks/${encodeURIComponent(t.id)}` },
            h('span', { class: 'g', 'aria-hidden': 'true' }, GLYPH[t.state] ?? '○'),
            h('b', { class: 'tid' }, t.id),
            h('span', { class: 'tt' }, t.title),
            h('span', { class: 'muted mono' }, `lane ${t.lane} · wave ${t.wave}`),
            tag(label, variant));
        }));
    }) : all.length ? empty('No tasks match.')
      : plans.length ? h('div', { class: 'row' }, empty('No open tasks: every plan is finished.'), btn('Show finished plans', () => { hideDonePlans = false; redraw(); })) : empty('No tasks yet. Start a plan with + New plan.'),
  ];
}

export async function renderProject(main, { id, tab }, ctx) {
  const data = await api(`/api/projects/${encodeURIComponent(id)}`);
  const p = data.project;
  const current = TABS.includes(tab) ? tab : 'overview';
  ctx.crumbs([['Home', '#/'], ['Projects', '#/projects'], [p.name]]);
  const plans = plansOf(data);
  const tasks = tasksOf(plans);
  const base = `#/projects/${encodeURIComponent(p.id)}`;
  const attention = [...(data.attention ?? [])];
  const real = (data.projects ?? []).filter((x) => x.id !== UNASSIGNED);
  const visibleRepos = data.repos.filter((r) => !r.hidden && !r.missing);
  const menu = p.id === UNASSIGNED ? null : projectMenu({ project: p, repoCount: data.repos.length, projects: real, onChange: () => ctx.refresh(), onDeleted: () => ctx.navigate('#/projects') });
  const newPlan = btn('+ New plan', () => openLaunchDialog({ action: 'plan' }, { repos: visibleRepos.map((r) => ({ rid: r.rid, name: r.name })) }), 'btn ac');
  if (!visibleRepos.length) newPlan.disabled = true;

  const openTasks = tasks.filter((t) => t.state === 'planned' || t.state === 'queued').length;
  const working = tasks.filter((t) => t.state === 'working').length;
  const implemented = tasks.filter((t) => t.state === 'done' || t.state === 'merged').length;
  const needsKpi = h('b', {}, String(attention.length));
  const kpis = h('div', { class: 'kpis' },
    h('div', { class: attention.length ? 'kpi hot' : 'kpi' }, h('small', {}, 'Needs you'), needsKpi),
    kpi('Running', (data.running ?? []).length + (data.launches ?? []).filter((l) => !(data.running ?? []).some((r) => r.launch?.id === l.id)).length, (data.running ?? []).length ? 'ac' : undefined),
    kpi('In progress', working),
    kpi('To do', openTasks),
    kpi('Implemented', `${implemented}/${tasks.length}`));

  const head = h('div', { class: 'phead' },
    h('div', { class: 'row' }, avatar(p.name, p.id, 'lg', attention.length > 0), h('h1', {}, p.name), menu),
    h('div', { class: 'row' }, newPlan, btn('Add repository', () => openAddDialog({ projects: real, selected: p.id, onDone: () => ctx.refresh() }))));
  const tabs = tabNav([
    ['overview', 'Overview', base],
    ['tasks', 'Tasks', `${base}/tasks`, openTasks + working],
    ['plans', 'Plans', `${base}/plans`, plans.length],
    ['repos', 'Repositories', `${base}/repos`, data.repos.length],
    ['activity', 'Activity', `${base}/activity`],
  ], current);
  const body = h('div', { class: 'stack tabbody' });
  let focusSearch = false;
  const redraw = (keepFocus = false) => {
    focusSearch = keepFocus;
    let kids;
    if (current === 'overview') kids = overview(data, plans, attention, ctx);
    else if (current === 'tasks') kids = tasksView(plans, redraw);
    else if (current === 'plans') kids = planList(plans, { refresh: ctx.refresh, doneLimit: 20, emptyText: 'No plans yet.' });
    else if (current === 'repos') {
      const shown = data.repos.filter((r) => !r.hidden);
      const hidden = data.repos.filter((r) => r.hidden);
      kids = [shown.length ? h('div', { class: 'grid rgrid' }, shown.map((r) => repoCard(r, data, ctx))) : empty('No repositories here.'),
        hidden.length ? [h('h2', {}, 'Hidden'), h('div', { class: 'grid rgrid' }, hidden.map((r) => repoCard(r, data, ctx)))] : null];
    } else kids = activityGroups(data.activity, () => p.id, empty);
    fill(body, kids);
    if (focusSearch) {
      const s = body.querySelector('input[type=search]');
      s?.focus();
      s?.setSelectionRange?.(s.value.length, s.value.length);
    }
  };
  redraw();
  fill(main, head, kpis, tabs, body);

  // GitHub (CI red, reviews) joins Needs you as it arrives.
  if (current === 'overview') {
    for (const r of visibleRepos) {
      githubOf(r.rid).then((g) => {
        const seen = new Set(attention.map((a) => a.id));
        const extra = (g.attention ?? []).filter((a) => !seen.has(a.id));
        if (!extra.length || !body.isConnected) return;
        attention.push(...extra);
        attention.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
        fill(needsKpi, String(attention.length));
        needsKpi.parentElement.className = 'kpi hot';
        redraw();
      });
    }
  }
  // Typing in the task filter must not be wiped by the 5 s refresh.
  return { poll: current !== 'tasks' && current !== 'repos' };
}
