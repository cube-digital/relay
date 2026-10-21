// relay HQ Routines views: the week grid, instance cards, templates and the instance
// page (findings, history, reports, suggestions). Every value is rendered as text.

import { ago, api, avatar, copyButton, empty, fill, h, light, link } from './dom.js';
import { openRoutineDialog } from './routine-dialog.js';
import { renderReport } from './report.js';

const FILTERS = [['all', 'All'], ['passive', 'Passive'], ['active', 'Active'], ['pending', 'Pending']];
const OUTCOME_DOT = { 'nothing-new': 'grey', report: 'grey', new: 'amber', failed: 'red', skipped: 'hollow' };
const OUTCOME_LIGHT = { 'nothing-new': 'grey', report: 'grey', new: 'yellow', failed: 'red', skipped: 'grey' };
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let filter = 'all'; // survives a re-render

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const pad = (n) => String(n).padStart(2, '0');
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const harnessName = (v) => (v === 'codex' ? 'Codex' : 'Claude');
const harnessBadge = (v) => h('span', { class: 'harness' }, harnessName(v));
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const section = (title, ...kids) => h('section', {}, h('h2', {}, title), ...kids);

async function post(path, body = {}) {
  return api(path, { method: 'POST', body });
}

function matches(i) {
  if (filter === 'passive' || filter === 'active') return i.kind === filter;
  if (filter === 'pending') return i.state === 'pending';
  return true;
}

function filterBar(redraw) {
  return h('div', { class: 'filters' }, FILTERS.map(([id, label]) => h('button', {
    type: 'button',
    'aria-pressed': filter === id ? 'true' : 'false',
    onclick: () => { filter = id; redraw(); },
  }, label)));
}

function weekGrid(data, instances) {
  const days = data.week.days.map((d) => new Date(d));
  const head = [h('div', { class: 'wk-label' }), ...days.map((d) => h('div', { class: 'wk-head' }, `${WEEKDAY[d.getDay()]} ${d.getDate()}`))];
  const rows = instances.flatMap((i) => {
    const next = i.nextRun ? Date.parse(i.nextRun) : null;
    return [
      h('div', { class: 'wk-label' }, h('strong', {}, i.title), h('span', { class: 'muted' }, i.scopeLabel)),
      ...days.map((d) => {
        const key = dayKey(d);
        const slots = (i.slots ?? []).map((s) => new Date(s)).filter((s) => dayKey(s) === key);
        const runs = (i.runs ?? []).filter((r) => dayKey(new Date(r.at)) === key);
        return h('div', { class: 'wk-cell' },
          slots.map((s) => h('span', { class: s.getTime() === next ? 'slot next' : 'slot' }, clock(s), harnessBadge(i.harness))),
          runs.map((r) => h('span', { class: `run-dot ${OUTCOME_DOT[r.outcome] ?? 'grey'}`, title: r.outcome })));
      }),
    ];
  });
  return h('div', { class: 'week', role: 'table' }, head, rows);
}

// Shows a failure next to the button, replacing an earlier one.
function showError(btn, err) {
  btn.nextElementSibling?.classList?.contains('error') && btn.nextElementSibling.remove();
  btn.after(h('span', { class: 'error', role: 'alert' }, err.message));
}

function runNow(i, ctx) {
  const off = i.type === 'prompt' || i.state === 'disabled';
  return h('button', {
    class: 'btn', type: 'button', disabled: off,
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await post(`/api/routines/${i.id}/run`);
        ctx.navigate(`#/launches/${res.launch.id}`);
      } catch (err) {
        btn.disabled = false;
        showError(btn, err);
      }
    },
  }, 'Run now');
}

function disableButton(i, ctx) {
  if (i.harness === 'claude') return copyButton('Disable', `/relay:routine disable ${i.id}`);
  return h('button', {
    class: 'btn danger', type: 'button',
    onclick: async (e) => {
      const btn = e.currentTarget;
      if (!confirm(`Disable ${i.title}?`)) return;
      try {
        await post(`/api/routines/${i.id}/disable`);
        ctx.refresh();
      } catch (err) {
        showError(btn, err);
      }
    },
  }, 'Disable');
}

function metaRow(i) {
  const last = i.lastRun;
  return h('div', { class: 'row' },
    i.project ? avatar(i.project.name, i.project.id) : null,
    h('span', { class: 'tag' }, harnessName(i.harness)),
    h('span', { class: i.state === 'pending' ? 'tag y' : 'tag' }, i.state),
    h('span', { class: 'tag' }, i.scheduleText),
    i.nextRun ? h('span', { class: 'muted' }, `next ${when(i.nextRun)}`) : null,
    i.appOpen ? h('span', { class: 'tag' }, 'needs the app open') : null,
    i.stalePath ? h('span', { class: 'tag r' }, 'stale path') : null,
    last ? h('span', { class: 'muted' }, `${last.outcome} ${ago(last.startedAt)}`) : null,
    h('span', { class: 'muted' }, `${i.open?.length ?? 0} open`),
    h('span', { class: 'muted' }, `${i.weekRuns}/${i.cap} this week`));
}

function buttons(i, ctx, withHistory) {
  return h('div', { class: 'row' },
    runNow(i, ctx), disableButton(i, ctx),
    withHistory ? h('a', { class: 'btn', href: `#/routines/${i.id}` }, 'History') : null);
}

function pendingBlock(i) {
  return i.pendingCommand ? h('div', { class: 'row' }, h('code', {}, i.pendingCommand), copyButton('Copy', i.pendingCommand)) : null;
}

function instanceCard(i, ctx) {
  return h('div', { class: 'card stack' },
    h('div', { class: 'row' }, h('strong', {}, `${i.title} · ${i.scopeLabel}`)),
    metaRow(i), pendingBlock(i), buttons(i, ctx, true));
}

function templateCard(t, open) {
  return h('div', { class: 'card stack' },
    h('div', { class: 'row' }, h('strong', {}, t.title), h('span', { class: 'tag' }, t.kind), t.custom ? h('span', { class: 'tag' }, 'prompt') : null),
    h('span', { class: 'muted' }, t.scheduleText),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => open(t.id) }, 'Enable')));
}

export async function renderRoutines(main, _params, ctx) {
  const data = await api('/api/routines');
  const open = (routine) => openRoutineDialog({ templates: data.templates, scopes: data.scopes, routine, onDone: () => ctx.refresh() });
  const body = h('div', { class: 'stack' });
  const draw = () => {
    const shown = data.instances.filter(matches);
    fill(body, 
      filterBar(draw),
      shown.length ? [section('Week', weekGrid(data, shown)), section('Instances', shown.map((i) => instanceCard(i, ctx)))] : empty('No routines enabled.'),
      section('Templates', data.templates.map((t) => templateCard(t, open))));
  };
  draw();
  fill(main, 
    h('div', { class: 'row between' }, h('h1', {}, 'Routines'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => open(undefined) }, 'Enable')),
    body);
  return { poll: true };
}

function findingRow(f, id, ctx) {
  return h('div', { class: f.dismissed ? 'finding muted' : 'finding' },
    h('div', { class: 'row' },
      f.isNew && !f.dismissed ? h('span', { class: 'tag y' }, 'new') : null,
      h('span', {}, f.text),
      String(f.href ?? '').startsWith('https://') ? link(f.href, 'Open') : null),
    f.command ? h('div', { class: 'row' }, h('code', {}, f.command), copyButton('Copy', f.command)) : null,
    f.dismissed ? null : h('button', {
      class: 'btn', type: 'button',
      onclick: async (e) => {
        const btn = e.currentTarget;
        try {
          await post(`/api/routines/${id}/dismiss`, { finding: f.id });
          ctx.refresh();
        } catch (err) {
          showError(btn, err);
        }
      },
    }, 'Dismiss'));
}

function historyTable(runs) {
  const cols = ['Started', 'Outcome', 'New', 'Skipped / error', 'Notes'];
  return h('table', { class: 'list' },
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c)))),
    h('tbody', {}, runs.map((r) => h('tr', {},
      h('td', {}, new Date(r.startedAt).toLocaleString()),
      h('td', {}, light(OUTCOME_LIGHT[r.outcome] ?? 'grey', r.outcome)),
      h('td', {}, String(r.new?.length ?? 0)),
      h('td', {}, r.skipped ?? r.error ?? ''),
      h('td', {}, (r.notes ?? []).join(' · '))))));
}

function reportsView(reports) {
  if (!reports.length) return empty('No reports yet.');
  const [first, ...older] = reports;
  return [
    h('div', {}, h('h3', {}, first.date), renderReport(first.text)),
    older.map((r) => h('details', {}, h('summary', {}, r.date), renderReport(r.text))),
  ];
}

function suggestionsView(list) {
  return list.map((s) => h('div', { class: 'card row' },
    h('strong', {}, s.id), h('span', {}, s.what),
    h('span', { class: 'muted' }, `${Array.isArray(s.days) ? s.days.join(',') : s.days} ${s.at}`),
    s.replaces ? h('span', { class: 'muted' }, `replaces ${s.replaces}`) : null,
    copyButton('Copy command', s.command)));
}

export async function renderRoutine(main, { id }, ctx) {
  const data = await api(`/api/routines/${id}`);
  const i = data.instance;
  const findings = [...data.findings].sort((a, b) => Number(b.isNew && !b.dismissed) - Number(a.isNew && !a.dismissed));
  fill(main, 
    h('h1', {}, `${i.title} · ${i.scopeLabel}`),
    h('div', { class: 'stack' }, metaRow(i), pendingBlock(i), buttons(i, ctx, false)),
    section('Findings', findings.length ? findings.map((f) => findingRow(f, id, ctx)) : empty('No findings.')),
    section('History', data.runs.length ? historyTable(data.runs) : empty('No runs yet.')),
    i.kind === 'active' ? section('Reports', reportsView(data.reports)) : null,
    i.routine === 'weekly-report' && data.suggestions.length ? section('Suggestions', suggestionsView(data.suggestions)) : null);
  return { poll: true };
}
