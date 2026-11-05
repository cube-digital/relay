// relay HQ Run page: header, waves and lanes, live log, launches, review and merge, task panel. Everything from the API goes in as text.

import { ago, api, duration, empty, fill, h, openPath, panelHead, planLight, mascot, tag, useStyle, GLYPH } from './dom.js';
import { openLaunchDialog } from './launch-dialog.js';
import { openMergeDialog, openPrDialog } from './merge-dialog.js';

const FILTERS = [
  ['all', 'All', () => true],
  ['blocked', 'Blocked', (s) => s === 'blocked'],
  ['working', 'In progress', (s) => s === 'working'],
  ['done', 'Done', (s) => s === 'done' || s === 'merged'],
  ['planned', 'Planned', (s) => s === 'planned' || s === 'queued'],
];
let filter = 'all'; // survives refreshes

const PIECE_LIGHT = { pass: 'green', findings: 'yellow', blocked: 'red', skipped: 'grey', pending: 'grey' };
const pieceChip = (p) => h('span', { class: `light ${PIECE_LIGHT[p.status] ?? 'grey'}`, title: `${p.piece}: ${p.status}` }, p.piece);
const tierTag = (tier, text) => h('span', { class: `tag tier-${tier}` }, text);
const stateTag = (state) => tag(state ?? '', state === 'working' ? 'ac' : state === 'blocked' ? 'red' : undefined);

const base = (p) => String(p ?? '').split('/').filter(Boolean).pop() ?? '';

// The API gives the run directory (<root>/.relay/runs/<slug>); the repository root is above it.
const rootOf = (runDir) => (/^(.*?)\/\.relay\/runs\//.exec(String(runDir ?? '')) ?? [])[1] || null;

function fileButton(label, path) {
  return h('button', { class: 'btn', type: 'button', disabled: path == null, onclick: () => openPath(path).catch((e) => alert(e.message)) }, label);
}

function taskPanel(data, found) {
  const { task: t, lane } = found;
  const info = data.lanes?.[lane.id] ?? {};
  const findings = info.latestFindings;
  const list = (items) => (items?.length ? h('ul', {}, items.map((x) => h('li', {}, x))) : h('p', { class: 'muted' }, 'none'));
  return h('div', { class: 'panel stack', id: 'task-panel' },
    h('h3', {}, `${t.id} ${t.title}`),
    h('div', { class: 'row' }, stateTag(t.state), tierTag(t.tier, `tier ${t.tier}`), tag(`risk ${t.risk}`), tag(`test budget ${t.tests ?? 0}`)),
    h('h4', {}, 'Behaviors'), list(t.behaviors),
    h('h4', {}, 'Files'), list(t.files),
    h('h4', {}, 'Done check'), h('pre', { class: 'code' }, t.done ?? ''),
    h('h4', {}, 'Latest review'),
    findings ? h('pre', { class: 'code' }, findings.text ?? '') : h('div', { class: 'row' }, h('span', { class: 'muted' }, 'no findings recorded'), info.latestReview ? fileButton('Open', info.latestReview.path) : null),
    h('h4', {}, 'Pieces on this lane'),
    info.pieces?.length
      ? h('div', { class: 'stack' }, info.pieces.map((p) => h('div', { class: 'row' },
        pieceChip(p), h('span', { class: 'muted' }, p.point ?? ''), h('span', {}, p.role ?? ''), tag(p.status),
        p.report ? h('button', { class: 'btn', type: 'button', onclick: () => openPath(p.report).catch((e) => alert(e.message)) }, 'Open report') : null)))
      : h('p', { class: 'muted' }, 'none'),
    h('div', { class: 'row' },
      fileButton('Brief', info.brief ?? null),
      fileButton('Report', info.report ?? null),
      (info.reviews ?? []).map((p) => fileButton(base(p), p)),
      (info.findings ?? []).map((p) => fileButton(base(p), p)),
      fileButton('Worktree', info.worktree ?? null),
      fileButton('Open in editor', info.worktree ?? data.repoPath ?? null)));
}

const taskChip = (t, selected, route) => h('a', {
  class: `tk${t.state === 'done' || t.state === 'merged' ? ' done' : ''}${t.state === 'working' ? ' now' : ''}`,
  href: `${route}/tasks/${encodeURIComponent(t.id)}`, 'aria-selected': selected ? 'true' : undefined, title: t.title,
}, t.state === 'working' ? `${t.id} ${t.title}` : t.id);

function laneRow(data, lane, visible, route) {
  const tasks = lane.tasks.filter((t) => visible(t.state));
  if (!tasks.length) return null;
  const role = lane.agents?.[0];
  const m = data.team?.[role];
  return h('div', { class: lane.state === 'blocked' ? 'rlane red' : 'rlane' },
    h('div', { class: 'lh' },
      h('span', { class: 'id' }, `lane ${lane.id}`),
      mascot(m?.kind ?? 'builder', lane.state === 'working', m?.title ?? role ?? '', m?.hex),
      h('span', { class: 't' }, [m?.title ?? role, lane.note].filter(Boolean).join(' · ')),
      stateTag(lane.state)),
    h('div', { class: 'tasks' }, tasks.map((t) => taskChip(t, t.id === data.selected, route))),
    (lane.pieces ?? []).length ? h('div', { class: 'row' }, lane.pieces.map(pieceChip)) : null);
}

const elapsed = (iso) => {
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) && ms >= 0 ? duration(ms) : '';
};

function post(path, ctx, body = {}) {
  return api(path, { method: 'POST', body }).then(ctx.refresh).catch((e) => alert(e.message));
}

function launchRow(l, ctx) {
  return h('div', { class: 'lrow' },
    h('b', {}, l.action ?? ''), tag(l.status ?? ''), h('span', { class: 'muted' }, l.outcome ?? ''), h('span', { class: 'muted' }, ago(l.startedAt) || l.startedAt || ''),
    h('a', { class: 'btn', href: `#/launches/${encodeURIComponent(l.id)}` }, 'Log'),
    l.retryable ? h('button', { class: 'btn', type: 'button', onclick: () => api(`/api/launches/${encodeURIComponent(l.id)}/retry`, { method: 'POST', body: {} }).then((r) => { location.hash = `#/launches/${encodeURIComponent(r.id ?? r.launch?.id ?? l.id)}`; }).catch((e) => alert(e.message)) }, 'Retry') : null);
}

function reviewPanel(data, run, rid, slug, ctx) {
  const r = run.review;
  if (!r) return null;
  const reports = [...(r.reports ?? []), ...(data.planPieces ?? []).map((p) => p.report).filter(Boolean)];
  const list = (title, items) => (items?.length ? [h('h4', {}, title), h('ul', {}, items.map((x) => h('li', {}, x)))] : []);
  const intent = { rid, slug };
  return h('div', { class: 'review stack', id: 'review' },
    h('h2', {}, 'Review and merge'),
    r.tests ? h('div', { class: 'row' }, tag(`tests +${r.tests.added ?? 0}`), tag(`-${r.tests.removed ?? 0}`)) : null,
    list('Rulings', r.rulings), list('Deferred findings', r.deferred),
    r.finalFindings ? h('pre', { class: 'code' }, r.finalFindings) : null,
    reports.length ? h('div', { class: 'row' }, reports.map((p) => h('button', { class: 'btn', type: 'button', onclick: () => openPath(p).catch((e) => alert(e.message)) }, base(p)))) : null,
    r.ready ? h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => openPrDialog(intent, { onDone: ctx.refresh }) }, 'Open PR'),
      h('button', { class: 'btn', type: 'button', onclick: () => openMergeDialog(intent, { onDone: ctx.refresh }) }, 'Merge locally'),
      h('button', { class: 'btn', type: 'button', onclick: () => post('/api/plans/merged', ctx, intent) }, 'Mark merged')) : null);
}

let scrolled = false; // scroll to the review once per page load

export async function renderPlan(main, { rid, slug, task }, ctx) {
  useStyle('/run.css');
  const data = await api(`/api/repos/${encodeURIComponent(rid)}/plans/${encodeURIComponent(slug)}`);
  const b = data.board;
  const run = data.run ?? {};
  const route = `#/repos/${rid}/plans/${slug}`;
  const project = ctx.projectOf?.(rid) ?? null;
  ctx.crumbs([['All', '#/'], ...(project ? [[project.name, `#/projects/${project.id}`]] : []), task ? [slug, route] : [slug], ...(task ? [[task]] : [])]);

  let found = null;
  for (const w of b.waves) for (const lane of w.lanes) for (const t of lane.tasks) if (t.id === task) found = { task: t, lane };
  data.selected = found ? task : undefined;

  const can = b.status !== 'running' && b.status !== 'complete';
  const launch = (action, extra = {}) => () => openLaunchDialog({ action, rid, plan: data.file, ...extra });
  const left = run.leftMin ? `~${duration(run.leftMin * 60000)} left` : '';
  const meta = [base(data.repo), `flow ${b.flow ?? 'feature'}`, b.status, run.branch, run.startedAt ? elapsed(run.startedAt) : '', left].filter(Boolean).join(' · ');
  const header = h('div', { class: 'top' },
    h('h1', {}, slug), planLight(b.status), h('span', { class: 'meta' }, meta),
    h('span', { class: 'act' },
      run.live ? h('button', { class: 'btn danger', type: 'button', onclick: () => post(`/api/launches/${encodeURIComponent(run.live.id)}/stop`, ctx) }, 'Stop') : null,
      can ? h('button', { class: 'btn primary', type: 'button', onclick: launch('run') }, b.status === 'blocked' ? 'Resume' : 'Run') : null,
      can ? h('button', { class: 'btn', type: 'button', onclick: launch('marathon', { hours: 8 }) }, 'Marathon') : null));

  const filters = h('div', { class: 'filters' }, FILTERS.map(([key, label]) => h('button', { type: 'button', 'aria-pressed': filter === key ? 'true' : 'false', onclick: () => { filter = key; ctx.refresh(); } }, label)));
  const visible = FILTERS.find(([k]) => k === filter)[2];
  const waves = h('div', { class: 'waves' }, b.waves.map((w) => h('div', { class: 'wave' },
    panelHead(`Wave ${w.wave}`, stateTag(w.state)),
    w.lanes.map((l) => laneRow(data, l, visible, route)))));

  const log = [...(run.ledger ?? [])];
  if (run.live) log.push(`[launch ${run.live.id}]`, run.live.log ?? '');
  const review = reviewPanel(data, run, rid, slug, ctx);
  const side = h('div', { class: 'stack' },
    h('h2', {}, 'Live log'), log.length ? h('pre', { class: 'code' }, log.join('\n')) : empty('No log yet.'),
    h('h2', {}, 'Launches'), run.launches?.length ? h('div', { class: 'stack' }, run.launches.map((l) => launchRow(l, ctx))) : empty('No launches.'),
    review);

  fill(main, header, filters,
    h('div', { class: 'run-grid' }, h('div', { class: 'stack' }, waves,
      task ? (found ? taskPanel({ ...data, repoPath: rootOf(data.runDir) }, found) : empty(`No task ${task} in this plan.`)) : null), side));
  if (!scrolled && !task && run.review?.ready) {
    scrolled = true;
    document.getElementById('review')?.scrollIntoView?.();
  }
  return { poll: true };
}
