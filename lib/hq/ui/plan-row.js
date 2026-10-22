// Shared rows for the Projects, Plans and Home views: one plan with its state, progress and
// actions, and one "needs you" item with the action that clears it. All text through h().

import { ago, api, empty, fill, h, planState, planTag, progress, tag } from './dom.js';
import { openLaunchDialog } from './launch-dialog.js';

const RED = new Set(['lane-blocked', 'suite-failed', 'marathon-blocked', 'ci-red']);

async function post(path, body, refresh) {
  try {
    await api(path, { method: 'POST', body });
    refresh?.();
  } catch (err) {
    alert(err.message);
  }
}

const btn = (label, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, label);

// p: a plan from /api/plans or a repo summary's plans[] (with rid and repoName added).
export function planActions(p, { refresh, launch } = {}) {
  const board = `#/repos/${encodeURIComponent(p.rid)}/plans/${encodeURIComponent(p.slug)}`;
  const out = [h('a', { class: 'btn', href: board }, 'Board')];
  if (p.error) return out;
  if (launch?.id) {
    out.push(h('a', { class: 'btn ac', href: `#/launches/${launch.id}` }, 'Log'));
    out.push(btn('Stop', () => post(`/api/launches/${launch.id}/stop`, {}, refresh), 'btn danger'));
    return out;
  }
  if (p.status === 'planned' || p.status === 'blocked') {
    out.push(btn(p.status === 'blocked' ? 'Resume' : 'Run', () => openLaunchDialog({ action: 'run', rid: p.rid, plan: p.file }), 'btn ac'));
    out.push(btn('Marathon', () => openLaunchDialog({ action: 'marathon', rid: p.rid, plan: p.file, hours: 8 })));
  }
  if (p.readyToMerge) out.push(btn('Mark merged', () => post('/api/plans/merged', { rid: p.rid, slug: p.slug }, refresh), 'btn ac'));
  return out;
}

export function planRow(p, { showRepo = true, showProject = false, refresh } = {}) {
  const board = `#/repos/${encodeURIComponent(p.rid)}/plans/${encodeURIComponent(p.slug)}`;
  const total = p.totals?.tasks ?? 0;
  const [state] = planState(p);
  const where = [showProject ? p.projectName : null, showRepo ? p.repoName : null].filter(Boolean).join(' / ');
  const wave = p.waveCount ? `wave ${p.currentWave ?? 0}/${p.waveCount}` : '';
  const blocked = (p.blockedLanes ?? []).map((b) => `lane ${b.lane}: ${String(b.note ?? '').replace(/^lane [a-z]+:\s*/i, '')}`);
  return h('div', { class: `prow ${state.replace(/\s+/g, '-')}` },
    h('div', { class: 'pmain' },
      h('div', { class: 'ptitle' }, planTag(p), h('a', { href: board }, h('b', {}, p.slug)), where ? h('span', { class: 'muted' }, where) : null),
      p.error ? h('p', { class: 'error' }, p.error) : p.title ? h('p', { class: 'goal', title: p.title }, p.title) : null,
      blocked.length ? h('p', { class: 'why' }, blocked.join(' · ')) : null),
    h('div', { class: 'pstat' },
      p.error ? null : progress(p.green, total, p.status === 'running'),
      h('span', { class: 'mono muted' }, p.error ? '' : `${p.green ?? 0}/${total} green${wave ? ` · ${wave}` : ''}`),
      p.lastAt ? h('span', { class: 'muted' }, ago(p.lastAt)) : null),
    h('div', { class: 'pact' }, planActions(p, { refresh, launch: p.launch })));
}

// Plans in the order an engineer looks at them: needs you, running, up next, done.
export function planGroups(plans) {
  const needs = plans.filter((p) => p.status === 'blocked' || p.readyToMerge || p.error);
  const rest = plans.filter((p) => !needs.includes(p));
  return [
    ['needs', 'Needs you', needs],
    ['running', 'Running', rest.filter((p) => p.status === 'running')],
    ['next', 'Up next', rest.filter((p) => p.status === 'planned')],
    ['done', 'Done', rest.filter((p) => p.status === 'complete')],
  ];
}

export function planList(plans, opts = {}) {
  if (!plans.length) return empty(opts.emptyText ?? 'No plans.');
  const { doneLimit = 5 } = opts;
  return h('div', { class: 'stack' }, planGroups(plans).filter(([, , list]) => list.length).map(([id, label, list]) => {
    const box = h('div', { class: 'plist' });
    const draw = (all) => fill(box, (all ? list : list.slice(0, id === 'done' ? doneLimit : list.length)).map((p) => planRow(p, opts)),
      !all && id === 'done' && list.length > doneLimit ? btn(`Show ${list.length - doneLimit} more`, () => draw(true), 'btn more') : null);
    draw(false);
    return h('section', { class: `pgroup ${id}` }, h('h2', {}, label, h('span', { class: 'n' }, String(list.length))), box);
  }));
}

// ---- needs you -------------------------------------------------------------

export function waitingLabel(a) {
  const text = String(a.text ?? '');
  const first = text.split('\n')[0].replace(/\s+/g, ' ').trim();
  const cut = (s, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  switch (a.kind) {
    case 'ready-to-merge': return `Ready to merge · ${a.plan ?? a.repoName ?? ''}`;
    case 'lane-blocked': return `Lane ${a.lane ?? '?'} blocked · ${a.plan ?? a.repoName ?? ''}`;
    case 'suite-failed': return `Suite failed · wave ${/wave (\d+)/.exec(text)?.[1] ?? '?'}`;
    case 'marathon-blocked': return `Marathon blocked · ${a.plan ?? a.repoName ?? ''}`;
    case 'ci-red': return `CI red · ${/PR #\d+/.exec(text)?.[0] ?? /^CI is red on (\S+)/.exec(text)?.[1] ?? a.repoName ?? ''}`;
    case 'review-requested': return `Review requested · ${/PR #\d+/.exec(text)?.[0] ?? a.repoName ?? ''}`;
    case 'routine': return `${a.label ?? 'Routine'} · ${cut(first)}`;
    default: return cut(first, 60);
  }
}

// What a blocked or failed item says, without the "lane b: BLOCKED" prefix the label already carries.
const detailOf = (a) => {
  const t = String(a.text ?? '').split('\n')[0].replace(/^lane [a-z]+ blocked:\s*/i, '').replace(/^lane [a-z]+:\s*/i, '').replace(/^BLOCKED:?\s*/i, '');
  return a.kind === 'lane-blocked' || a.kind === 'marathon-blocked' || a.kind === 'suite-failed' ? t : '';
};

const VERB = { 'lane-blocked': 'Open task', 'suite-failed': 'Open board', 'marathon-blocked': 'Open board', 'ci-red': 'Open PR', 'review-requested': 'Review', routine: 'Open', 'ready-to-merge': 'Board' };

export function needsRow(a, { refresh, compact = false } = {}) {
  const red = RED.has(a.kind);
  const detail = compact ? '' : detailOf(a);
  const external = String(a.href ?? '').startsWith('https://');
  const open = a.href ? h('a', { class: 'btn', href: a.href, target: external ? '_blank' : undefined, rel: external ? 'noopener noreferrer' : undefined }, VERB[a.kind] ?? 'Open') : null;
  const merge = a.kind === 'ready-to-merge' && a.rid && a.plan ? btn('Mark merged', () => post('/api/plans/merged', { rid: a.rid, slug: a.plan }, refresh), 'btn ac') : null;
  return h('div', { class: red ? 'need bad' : 'need', title: a.text ?? '' },
    h('span', { class: 'ni', 'aria-hidden': 'true' }, red ? '!' : a.kind === 'ready-to-merge' ? '⇥' : '•'),
    h('div', { class: 'nmain' },
      h('b', {}, waitingLabel(a)),
      detail ? h('span', { class: 'why' }, detail) : null,
      h('small', {}, [a.repoName, ago(a.at)].filter(Boolean).join(' · '))),
    h('div', { class: 'nact' }, compact ? null : open, merge, compact && !merge ? open : null));
}

export const needsTag = (n) => (n > 0 ? tag(`${n} need you`, 'red') : null);
