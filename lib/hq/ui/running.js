// A running plan as an agents panel: KPIs, then its lanes grouped Running · Finished · Planned,
// each with its role's mascot, current task, model and progress. Shared by Home and a project.

import { empty, h, kpi, mascot, panelHead, tag } from './dom.js';

const pad = (n) => String(n).padStart(2, '0');

export function clock(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return null;
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

function taskRange(ids = []) {
  if (!ids.length) return '';
  return ids.length === 1 ? ids[0] : `${ids[0]}–${ids[ids.length - 1]}`;
}

function segment(s, board) {
  const planned = s.status === 'planned';
  const head = planned || !s.task ? [`Lane ${s.lane}`, taskRange(s.tasks)].filter(Boolean).join(' · ') : `${s.task.id} ${s.task.title}`;
  const meta = [s.title, `lane ${s.lane}`, s.model, s.effort, s.fix ? `fix round ${s.fix}` : `${s.done ?? 0}/${s.total ?? 0} tasks`].filter(Boolean).join(' · ');
  const bar = h('span', { class: s.status === 'blocked' ? 'red' : s.status === 'working' ? 'run' : '' });
  bar.style.width = `${s.total ? Math.round((100 * (s.done ?? 0)) / s.total) : 0}%`;
  const status = s.status === 'working' ? tag(clock(s.since) ?? 'working', 'ac') : s.status === 'blocked' ? tag('blocked', 'red') : planned ? tag('planned') : tag('✓ done');
  const href = s.task ? `${board}/tasks/${encodeURIComponent(s.task.id)}` : board;
  return h('a', { class: planned ? 'ag planned' : `ag ${s.status}`, href },
    h('span', { class: 'who' }, mascot(s.kind, s.status === 'working', s.title, s.hex)),
    h('div', {}, h('b', {}, head), h('div', { class: 'meta' }, meta), planned ? null : h('div', { class: 'pbar' }, bar)),
    status);
}

export function planPanel(p, { team = true } = {}) {
  const k = p.kpis ?? {};
  const l = k.lanes ?? {};
  const board = p.href ?? `#/repos/${p.rid}/plans/${p.slug}`;
  const groups = [['running', 'Running'], ['finished', 'Finished'], ['planned', 'Planned']].map(([g, label]) => {
    const segs = p.groups?.[g] ?? [];
    return segs.length ? [h('div', { class: 'grp' }, `${label} · ${segs.length}`), segs.map((s) => segment(s, board))] : null;
  });
  const live = p.launch?.id ? h('a', { class: 'btn ac', href: `#/launches/${p.launch.id}` }, 'Log') : null;
  return h('div', { class: p.status === 'blocked' ? 'agents blocked' : 'agents' },
    panelHead(`${p.slug}${p.repoName ? ` · ${p.repoName}` : ''}`, p.status === 'blocked' ? tag('blocked', 'red') : tag('running', 'ac'), live, h('a', { class: 'btn', href: board }, 'Board'), team ? h('a', { class: 'btn', href: '#/brain/team' }, 'Team') : null),
    p.title ? h('p', { class: 'goal', title: p.title }, p.title) : null,
    h('div', { class: 'kpis' },
      kpi('Green', `${k.green ?? p.green ?? 0}/${k.total ?? p.totals?.tasks ?? 0}`),
      kpi('Wave', `${k.wave ?? p.currentWave ?? '?'} / ${k.waves ?? p.waveCount ?? '?'}`),
      kpi('Lanes live · done · next', `${l.running ?? 0} · ${l.finished ?? 0} · ${l.planned ?? 0}`),
      kpi('Time', clock(k.startedAt) ?? '–')),
    groups.some(Boolean) ? groups : empty('No lanes yet.'));
}
