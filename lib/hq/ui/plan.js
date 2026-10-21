// relay HQ plan page: the board (waves, lanes, tasks) with filters, the task panel,
// rulings and the ledger tail. Everything from the API goes in as text.

import { ago, api, empty, fill, h, link, openPath, planLight, progress, roleTile, stateLight, GLYPH } from './dom.js';
import { openLaunchDialog } from './launch-dialog.js';

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
const tilesOf = (roles, team) => h('span', { class: 'tiles' }, [...new Set(roles ?? [])].map((r) => roleTile({ avatar: team?.[r]?.avatar ?? r.slice(0, 2).toUpperCase(), title: team?.[r]?.title ?? r, hex: team?.[r]?.hex }, 'sm')));

const base = (p) => String(p ?? '').split('/').filter(Boolean).pop() ?? '';

// The API gives the run directory (<root>/.relay/runs/<slug>); the repository root is above it.
const rootOf = (runDir) => (/^(.*?)\/\.relay\/runs\//.exec(String(runDir ?? '')) ?? [])[1] || null;

function budgetText(b) {
  if (!b || typeof b !== 'object') return '';
  const parts = Object.entries(b).filter(([, v]) => ['string', 'number'].includes(typeof v)).map(([k, v]) => `${k} ${v}`);
  return parts.join(' · ');
}

function marathonLine(m) {
  const phase = typeof m.phase === 'object' && m.phase ? m.phase.kind : m.phase;
  const bits = [`marathon ${phase ?? '?'}`, `${m.legs ?? 0} legs`];
  if (m.endedAt) bits.push(`ended ${ago(m.endedAt) || m.endedAt}`);
  if (m.stopReason) bits.push(`stopped: ${m.stopReason}`);
  return h('p', { class: 'muted' }, bits.join(' · '));
}

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
    h('div', { class: 'row' }, stateLight(t.state), h('span', { class: `tag tier-${t.tier}` }, `tier ${t.tier}`), h('span', { class: 'tag' }, `risk ${t.risk}`), h('span', { class: 'tag' }, `test budget ${t.tests ?? 0}`)),
    h('h4', {}, 'Behaviors'), list(t.behaviors),
    h('h4', {}, 'Files'), list(t.files),
    h('h4', {}, 'Done check'), h('pre', { class: 'code' }, t.done ?? ''),
    h('h4', {}, 'Latest review'),
    findings ? h('pre', { class: 'code' }, findings.text ?? '') : h('div', { class: 'row' }, h('span', { class: 'muted' }, 'no findings recorded'), info.latestReview ? fileButton('Open', info.latestReview.path) : null),
    h('h4', {}, 'Pieces on this lane'),
    info.pieces?.length
      ? h('div', { class: 'stack' }, info.pieces.map((p) => h('div', { class: 'row' },
        pieceChip(p), h('span', { class: 'muted' }, p.point ?? ''), h('span', {}, p.role ?? ''), h('span', { class: 'tag' }, p.status),
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

function laneCard(data, lane, visible, route) {
  const rows = lane.tasks.filter((t) => visible(t.state)).map((t) => h('a', { class: 'task', href: `${route}/tasks/${encodeURIComponent(t.id)}`, 'aria-selected': t.id === data.selected ? 'true' : undefined },
    h('span', {}, GLYPH[t.state] ?? '○'), h('b', { class: 'tid' }, t.id), h('span', {}, t.title)));
  if (!rows.length) return null;
  return h('div', { class: 'lane card stack' },
    h('div', { class: 'row' }, h('b', {}, `lane ${lane.id}`), stateLight(lane.state)),
    h('span', { class: 'muted' }, lane.note ?? ''),
    h('div', { class: 'row' }, tilesOf(lane.agents, data.team), h('span', { class: 'muted' }, (lane.agents ?? []).join(', ')), h('span', { class: `tag tier-${lane.tier}` }, lane.tier ?? ''), h('span', { class: 'tag' }, `risk ${lane.risk ?? '?'}`)),
    (lane.pieces ?? []).length ? h('div', { class: 'row' }, lane.pieces.map(pieceChip)) : null,
    rows);
}

export async function renderPlan(main, { rid, slug, task }, ctx) {
  const data = await api(`/api/repos/${encodeURIComponent(rid)}/plans/${encodeURIComponent(slug)}`);
  const b = data.board;
  const route = `#/repos/${rid}/plans/${slug}`;
  const repoName = base(data.repo);
  ctx.crumbs([['Home', '#/'], [repoName], [slug, route], ...(task ? [[task]] : [])]);

  let found = null;
  for (const w of b.waves) for (const lane of w.lanes) for (const t of lane.tasks) if (t.id === task) found = { task: t, lane };
  data.selected = found ? task : undefined;

  const can = b.status !== 'running' && b.status !== 'complete';
  const launch = (action, extra = {}) => () => openLaunchDialog({ action, rid, plan: data.file, ...extra });
  const bud = budgetText(b.budget);
  const header = h('div', { class: 'stack' },
    h('div', { class: 'row' }, h('h1', {}, slug), h('span', { class: 'tag' }, `flow ${b.flow ?? 'feature'}`), planLight(b.status), progress(b.green, b.totals?.tasks, b.status === 'running'),
      h('span', { class: 'muted' }, `wave ${b.currentWave}/${b.waveCount}`), bud ? h('span', { class: 'muted' }, bud) : null,
      can ? h('button', { class: 'btn primary', type: 'button', onclick: launch('run') }, 'Run') : null,
      can ? h('button', { class: 'btn', type: 'button', onclick: launch('marathon', { hours: 8 }) }, 'Marathon') : null),
    b.goal ? h('p', { class: 'goal', title: b.goal }, b.goal) : null,
    b.marathon ? marathonLine(b.marathon) : null);

  const filters = h('div', { class: 'filters' }, FILTERS.map(([key, label]) => h('button', { type: 'button', 'aria-pressed': filter === key ? 'true' : 'false', onclick: () => { filter = key; ctx.refresh(); } }, label)));
  const visible = FILTERS.find(([k]) => k === filter)[2];
  const waves = h('div', { class: 'waves' }, b.waves.map((w) => h('div', { class: 'wave stack' },
    h('div', { class: 'row' }, h('h3', {}, `Wave ${w.wave}`), stateLight(w.state)),
    w.lanes.map((l) => laneCard(data, l, visible, route)))));

  const ledger = b.ledgerTail ?? [];
  fill(main, 
    header, filters,
    h('div', { class: task ? 'plan-grid has-panel' : 'plan-grid' }, waves,
      task ? (found ? taskPanel({ ...data, repoPath: rootOf(data.runDir) }, found) : empty(`No task ${task} in this plan.`)) : null),
    b.planPieces?.length ? h('div', { class: 'row' }, h('b', {}, 'Plan pieces'), b.planPieces.map(pieceChip)) : null,
    h('h2', {}, 'Rulings'),
    b.rulings?.length ? h('ul', {}, b.rulings.map((r) => h('li', {}, r))) : empty('No rulings yet.'),
    h('h2', {}, 'Ledger'),
    ledger.length ? h('pre', { class: 'code' }, ledger.join('\n')) : empty('The ledger is empty.'));
}
