// The Enable routine dialog: pick routine, harness, scope and schedule, see the exact
// effect from a preview, then confirm (Codex) or copy the command (Claude). All text.

import { api, copyButton, fill, h } from './dom.js';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const SCOPES = [['project', 'Project'], ['repo', 'Repository'], ['all', 'All repositories']];

// templates: GET /api/routines templates; scopes: { projects, repos }; routine: id to preselect.
export function openRoutineDialog({ templates, scopes, routine, onDone }) {
  const dlg = document.getElementById('launch');
  const err = h('div', { class: 'stack' });
  const effect = h('div', { class: 'stack' });
  let timer = null;
  let seq = 0;

  const pick = h('select', { 'aria-label': 'Routine' }, templates.map((t) => h('option', { value: t.id }, t.title)));
  if (templates.some((t) => t.id === routine)) pick.value = routine;
  const radios = ['claude', 'codex'].map((v) => h('input', { type: 'radio', name: 'routine-harness', value: v, 'aria-label': v === 'claude' ? 'Claude' : 'Codex' }));
  radios.forEach((r) => { r.checked = false; });
  const scope = h('select', { 'aria-label': 'Scope' }, SCOPES.map(([v, l]) => h('option', { value: v }, l)));
  const target = h('select', { 'aria-label': 'Project or repository' });
  const dayBoxes = DAYS.map((d) => h('input', { type: 'checkbox', value: d, 'aria-label': DAY_LABEL[d] }));
  const at = h('input', { type: 'time', 'aria-label': 'Time' });
  const enable = h('button', { class: 'btn primary', type: 'button', onclick: () => submit() }, 'Enable');
  enable.hidden = true;

  const harness = () => radios.find((r) => r.checked)?.value;
  const template = () => templates.find((t) => t.id === pick.value);

  function fillTarget() {
    const list = scope.value === 'project' ? scopes.projects.map((p) => [p.id, p.name])
      : scope.value === 'repo' ? scopes.repos.map((r) => [r.rid, r.name]) : [];
    fill(target, ...list.map(([v, l]) => h('option', { value: v }, l)));
    target.hidden = scope.value === 'all';
  }
  function fillSchedule() {
    const s = template()?.schedule ?? {};
    dayBoxes.forEach((b) => { b.checked = (s.days ?? []).includes(b.value); });
    at.value = s.at ?? '';
  }
  function body() {
    const b = { routine: pick.value, harness: harness(), scope: scope.value };
    if (scope.value === 'project') b.project = target.value;
    if (scope.value === 'repo') b.rid = target.value;
    b.days = dayBoxes.filter((x) => x.checked).map((x) => x.value);
    if (at.value) b.at = at.value;
    return b;
  }
  function show(res, failure) {
    const errors = failure ? [failure] : res?.errors ?? [];
    const rows = [];
    if (res?.codex) {
      rows.push(h('code', {}, res.codex.path),
        h('span', {}, [res.codex.model, res.codex.effort].filter(Boolean).join(' · ')),
        h('code', {}, res.codex.rrule));
    }
    if (res?.claude) rows.push(h('code', {}, res.claude.command), copyButton('Copy', res.claude.command));
    rows.push(...errors.map((e) => h('p', { class: 'error', role: 'alert' }, e)));
    fill(effect, ...rows);
    enable.hidden = !(res?.codex && !errors.length);
  }
  function refresh() {
    clearTimeout(timer);
    enable.hidden = true;
    if (!harness()) { fill(effect); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await api('/api/routines/preview', { method: 'POST', body: body() });
        if (mine === seq) show(res);
      } catch (e) {
        if (mine === seq) show(null, e.message);
      }
    }, 200);
  }
  async function submit() {
    fill(err);
    enable.disabled = true;
    try {
      await api('/api/routines', { method: 'POST', body: { ...body(), confirm: true } });
      dlg.close();
      onDone();
    } catch (e) {
      fill(err, h('p', { class: 'error', role: 'alert' }, e.message));
      enable.disabled = false;
    }
  }

  pick.addEventListener('change', () => { fillSchedule(); refresh(); });
  scope.addEventListener('change', () => { fillTarget(); refresh(); });
  for (const el of [...radios, target, ...dayBoxes, at]) el.addEventListener('change', refresh);
  at.addEventListener('input', refresh);
  dlg.addEventListener('close', () => { clearTimeout(timer); seq += 1; }, { once: true });
  fillTarget();
  fillSchedule();

  fill(dlg, 
    h('h2', {}, 'Enable routine'),
    h('div', { class: 'stack' },
      h('div', {}, h('label', {}, 'Routine'), pick),
      h('div', { class: 'row' }, radios.map((r) => h('label', { class: 'row' }, r, r.value === 'claude' ? 'Claude' : 'Codex'))),
      h('div', {}, h('label', {}, 'Scope'), scope, target),
      h('div', { class: 'row' }, dayBoxes.map((b) => h('label', { class: 'row' }, b, DAY_LABEL[b.value])), at),
      effect,
      err,
      h('div', { class: 'row' }, enable, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'))));
  dlg.showModal();
  pick.focus();
}
