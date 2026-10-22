// The Apply dialog for recos: previews commands, deletes, the bugfix plan and routines,
// runs nothing until Start, then opens the routine dialog for each routine reco.

import { api, empty, fill, h } from './dom.js';
import { openRoutineDialog } from './routine-dialog.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitEnded(id) {
  for (let i = 0; i < 15; i++) {
    try {
      const l = await api(`/api/launches/${encodeURIComponent(id)}`);
      const x = l.launch ?? l;
      if (x.status && x.status !== 'running' && x.status !== 'starting') return;
      if (x.endedAt || x.exitedAt) return;
    } catch { return; }
    await sleep(1000);
  }
}

export async function openApplyDialog(ids, { onDone } = {}) {
  const dlg = document.getElementById('launch');
  const st = { harness: 'claude', model: undefined, effort: undefined, permissionMode: undefined };
  let timer;
  let seq = 0;
  let last;
  let titles = new Map();
  api('/api/recos').then((d) => { titles = new Map((d.recos ?? []).map((r) => [r.id, r.title])); }).catch(() => {});

  const model = h('select', { 'aria-label': 'Model', onchange: () => { st.model = model.value; schedule(); } });
  const effort = h('select', { 'aria-label': 'Effort', onchange: () => { st.effort = effort.value; schedule(); } });
  const mode = h('select', { 'aria-label': 'Permission mode', onchange: () => { st.permissionMode = mode.value; schedule(); } });
  const danger = h('input', { type: 'checkbox', onchange: () => schedule() });
  const dangerRow = h('label', {}, danger, ' I understand this skips every permission check');
  dangerRow.hidden = true;
  const radio = (value, label) =>
    h('label', {}, h('input', { type: 'radio', name: 'apply-harness', value, checked: st.harness === value, onchange: () => { st.harness = value; st.model = st.effort = st.permissionMode = undefined; schedule(); } }), ` ${label}`);
  const planOpts = h('div', { class: 'stack' },
    h('div', { class: 'row' }, h('span', {}, 'Harness'), radio('claude', 'Claude Code'), radio('codex', 'Codex')),
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Model'), model), h('div', {}, h('label', {}, 'Effort'), effort), h('div', {}, h('label', {}, 'Permission mode'), mode)),
    dangerRow);
  planOpts.hidden = true;
  const out = h('div', { class: 'stack' });
  const startErrors = h('div', { class: 'stack' });
  const start = h('button', { class: 'btn primary', type: 'button', onclick: () => go() }, 'Start');
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel');

  const planBody = () => ({ harness: st.harness, model: st.model, effort: st.effort, permissionMode: st.permissionMode, confirmDangerous: danger.checked && !dangerRow.hidden });

  const fillSelect = (select, values, current) => {
    fill(select, ...values.map((v) => h('option', { value: v, selected: v === current }, v)));
    if (current !== undefined) select.value = current;
  };

  function show(res) {
    last = res;
    const kids = [];
    const commands = (res.commands ?? []).filter((c) => !c.deletes);
    const deletes = (res.commands ?? []).filter((c) => c.deletes);
    if (commands.length) kids.push(h('h3', {}, 'Commands'), commands.map((c) => h('pre', { class: 'code' }, c.display)));
    if (deletes.length) kids.push(h('h3', {}, 'Deletes'), deletes.map((c) => { const p = h('pre', { class: 'code' }, c.display); p.style.color = 'var(--red)'; return p; }));
    const plans = res.plans ?? [];
    let blocked = false;
    for (const p of plans) {
      kids.push(h('h3', {}, `Plan · ${p.repoName} · bugfix`), h('pre', { class: 'code' }, p.goal));
      const pv = p.preview ?? {};
      const g = pv.guards ?? { errors: [], warnings: [] };
      for (const w of g.warnings ?? []) kids.push(h('p', { class: 'muted' }, `warning: ${w}`));
      if (g.errors?.length) { blocked = true; kids.push(h('ul', { class: 'error' }, g.errors.map((e) => h('li', {}, e)))); }
    }
    const o = plans[0]?.preview?.options;
    planOpts.hidden = !plans.length;
    if (o) {
      const d = o.defaults ?? {};
      st.model = st.model ?? d.model;
      st.effort = st.effort ?? d.effort;
      st.permissionMode = st.permissionMode ?? d.permissionMode;
      fillSelect(model, o.models ?? [], st.model);
      fillSelect(effort, o.efforts ?? [], st.effort);
      fillSelect(mode, o.modes ?? [], st.permissionMode);
      dangerRow.hidden = !(o.dangerous && st.permissionMode === o.dangerous);
      if (dangerRow.hidden) danger.checked = false;
    }
    const routines = res.routines ?? [];
    if (routines.length) kids.push(h('h3', {}, 'Routines'), routines.map((r) => h('p', {}, r.routine, ' ', h('span', { class: 'muted' }, 'opens the routine dialog after Start'))));
    const refused = res.refused ?? [];
    if (refused.length) kids.push(h('h3', {}, 'Refused'), h('ul', { class: 'error' }, refused.map(refusedItem)));
    fill(out, ...kids);
    const nothing = !(commands.length || deletes.length || plans.length || routines.length);
    start.disabled = nothing || blocked;
  }

  async function preview() {
    const mine = ++seq;
    try {
      const res = await api('/api/recos/apply/preview', { method: 'POST', body: { ids, plan: planBody() } });
      if (mine === seq && dlg.open) show(res);
    } catch (err) {
      if (mine !== seq) return;
      last = undefined;
      start.disabled = true;
      fill(out, h('p', { class: 'error', role: 'alert' }, err.message));
    }
  }

  function schedule() {
    clearTimeout(timer);
    seq++;
    start.disabled = true;
    timer = setTimeout(preview, 250);
  }

  const refusedItem = (r) => h('li', {}, `${titles.get(r.id) ?? r.id} — ${r.reason}`);

  async function go() {
    start.disabled = true;
    fill(startErrors);
    let res;
    try {
      res = await api('/api/recos/apply', { method: 'POST', body: { ids, plan: planBody(), confirm: true } });
    } catch (err) {
      const refusedAll = err.status === 409 ? err.data?.refused : null;
      if (Array.isArray(refusedAll) && refusedAll.length) {
        fill(startErrors, h('ul', { class: 'error' }, refusedAll.map(refusedItem)));
        start.disabled = false;
        return;
      }
      const list = err.status === 409 && err.data?.guards?.errors?.length ? err.data.guards.errors : [err.message];
      fill(startErrors, h('ul', { class: 'error' }, list.map((e) => h('li', {}, e))));
      start.disabled = false;
      return;
    }
    const launches = res.launches ?? [];
    const refused = res.refused ?? [];
    if (refused.length) {
      // keep the dialog open: what started, and what was refused and why
      await new Promise((resolve) => {
        fill(dlg,
          h('h2', {}, 'Apply'),
          h('div', { class: 'stack' },
            launches.length ? [h('h3', {}, 'Started'), h('ul', {}, launches.map((l) => h('li', {}, h('a', { href: `#/launches/${l.id}` }, `${l.action ?? 'launch'} · ${l.id}`))))] : null,
            h('h3', {}, 'Refused'),
            h('ul', { class: 'error' }, refused.map(refusedItem)),
            h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => resolve() }, 'Continue'))));
        dlg.addEventListener('close', resolve, { once: true });
      });
    }
    if (dlg.open) dlg.close();
    for (const r of res.routines ?? []) {
      if (r.launch) await waitEnded(r.launch);
      try {
        const data = await api('/api/routines');
        await new Promise((resolve) => {
          dlg.addEventListener('close', resolve, { once: true });
          openRoutineDialog({ templates: data.templates, scopes: data.scopes, routine: r.routine, onDone: () => {} });
        });
      } catch { /* skip this routine */ }
    }
    onDone?.();
    location.hash = launches.length === 1 ? `#/launches/${launches[0].id}` : '#/launches';
  }

  fill(dlg,
    h('h2', {}, 'Apply'),
    h('div', { class: 'stack' }, planOpts, out, startErrors, h('div', { class: 'row' }, start, cancel)));
  start.disabled = true;
  fill(out, empty('Loading preview…'));
  dlg.addEventListener('close', () => { clearTimeout(timer); seq++; }, { once: true });
  dlg.showModal();
  await preview();
}
