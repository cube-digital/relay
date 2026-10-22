// The launch dialog: pick harness, model and options, see the exact command, forecast
// and guards from the server, then Start. The command text is never sent back.

import { api, empty, fill, h } from './dom.js';

const ACTION_TITLE = { plan: 'New plan', run: 'Run plan', marathon: 'Marathon', skill: 'Run skill', 'setup-codex': 'Set up Codex', connectors: 'Refresh connectors' };
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : `${Math.round(min)}m`);

export async function openLaunchDialog(intent, { repos = [], defaultRid } = {}) {
  const dlg = document.getElementById('launch');
  const action = intent.action;
  const st = { harness: action === 'setup-codex' ? 'codex' : intent.harness === 'codex' ? 'codex' : 'claude', model: intent.model ?? undefined, effort: intent.effort ?? undefined, permissionMode: undefined };
  let timer;
  let seq = 0;
  let last;

  const radio = (value, label) =>
    h('label', {}, h('input', { type: 'radio', name: 'harness', value, checked: st.harness === value, disabled: (action === 'marathon' && value === 'codex') || (action === 'setup-codex' && value === 'claude'), onchange: () => { st.harness = value; st.model = st.effort = st.permissionMode = undefined; schedule(); } }), ` ${label}`);
  const model = h('select', { 'aria-label': 'Model', onchange: () => { st.model = model.value; schedule(); } });
  const effort = h('select', { 'aria-label': 'Effort', onchange: () => { st.effort = effort.value; schedule(); } });
  const mode = h('select', { 'aria-label': 'Permission mode', onchange: () => { st.permissionMode = mode.value; schedule(); } });
  const goal = h('textarea', { 'aria-label': 'Goal', placeholder: 'What should the plan achieve?', oninput: () => schedule() });
  const skill = h('input', { type: 'text', 'aria-label': 'Skill', placeholder: 'skill name', value: intent.skill ?? '', oninput: () => schedule() });
  const prompt = h('textarea', { 'aria-label': 'Arguments', placeholder: 'Arguments (optional)', oninput: () => schedule() });
  const needRepo = !intent.rid && ['plan', 'run', 'marathon', 'skill', 'setup-codex'].includes(action);
  const needPlan = (action === 'run' || action === 'marathon') && !intent.plan;
  const repoSel = h('select', { 'aria-label': 'Repository', onchange: () => { loadPlans(); schedule(); } }, repos.map((r) => h('option', { value: r.rid }, r.name)));
  if (defaultRid && repos.some((r) => r.rid === defaultRid)) repoSel.value = defaultRid;
  const planSel = h('select', { 'aria-label': 'Plan', onchange: () => schedule() });
  const noRepos = needRepo && !repos.length;
  const curRid = () => (needRepo ? repoSel.value : intent.rid);
  async function loadPlans() {
    if (!needPlan) return;
    const rid = curRid();
    fill(planSel);
    if (!rid) return;
    try {
      const data = await api(`/api/repos/${encodeURIComponent(rid)}`);
      if (rid !== curRid()) return;
      fill(planSel, (data.plans ?? []).filter((p) => p.status !== 'complete').map((p) => h('option', { value: p.file }, p.title ?? p.slug)));
    } catch { /* the preview shows the error */ }
    schedule();
  }
  const hours = h('input', { type: 'number', min: '1', max: '48', value: String(intent.hours ?? 8), 'aria-label': 'Hours', oninput: () => schedule() });
  const danger = h('input', { type: 'checkbox', onchange: () => schedule() });
  const dangerRow = h('label', {}, danger, ' I understand this skips every permission check');
  const effortRow = h('div', {}, h('label', {}, 'Effort'), effort);
  const out = h('div', { class: 'stack' });
  const start = h('button', { class: 'btn primary', type: 'button', onclick: () => go() }, 'Start');
  const copy = h('button', { class: 'btn', type: 'button', onclick: () => last && navigator.clipboard?.writeText(last.command.display) }, 'Copy command');
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel');
  const resume = h('span', { class: 'muted' });
  const startErrors = h('div', { class: 'stack' });
  dangerRow.hidden = true;

  const body = () => ({
    ...intent,
    rid: curRid(),
    plan: needPlan ? planSel.value || undefined : intent.plan,
    harness: st.harness,
    model: st.model,
    effort: effortRow.hidden ? undefined : st.effort,
    permissionMode: st.permissionMode,
    goal: action === 'plan' ? goal.value : undefined,
    skill: action === 'skill' ? skill.value : undefined,
    prompt: action === 'skill' ? prompt.value : undefined,
    hours: action === 'marathon' ? Number(hours.value) : undefined,
    confirmDangerous: danger.checked && !dangerRow.hidden,
  });

  function fillSelect(select, values, current) {
    fill(select, ...values.map((v) => h('option', { value: v, selected: v === current }, v)));
    if (current !== undefined) select.value = current;
  }

  function show(res) {
    last = res;
    const o = res.options ?? {};
    const d = o.defaults ?? {};
    const it = res.intent ?? {};
    st.model = st.model ?? it.model ?? d.model;
    st.effort = st.effort ?? it.effort ?? d.effort;
    st.permissionMode = st.permissionMode ?? it.permissionMode ?? d.permissionMode;
    fillSelect(model, o.models ?? [], st.model);
    fillSelect(effort, o.efforts ?? [], st.effort);
    fillSelect(mode, o.modes ?? [], st.permissionMode);
    effortRow.hidden = action === 'marathon' || action === 'setup-codex';
    dangerRow.hidden = !(o.dangerous && st.permissionMode === o.dangerous);
    if (dangerRow.hidden) danger.checked = false;
    const kids = [];
    const f = res.forecast;
    if ((action === 'run' || action === 'marathon') && f) {
      const u = f.usage ?? {};
      kids.push(h('p', {}, `${f.tasks} tasks · ${f.lanes} lanes · ${f.waves} waves · ${f.agents?.total ?? f.agents ?? '?'} agents · usage ${u.totalPct}% over ${u.windows} window(s) · ${hm(f.time?.totalMinutes ?? 0)}`, f.calibrated ? '' : ' · placeholder rates'));
      const b = res.budget;
      kids.push(h('p', { class: 'muted' }, b ? `budget ${b.level} · 5h ${b.fiveHour ?? "?"}% · 7d ${b.sevenDay ?? "?"}%` : "budget unknown"));
    }
    if (res.hint) kids.push(h('p', { class: 'muted' }, res.hint));
    const g = res.guards ?? { errors: [], warnings: [] };
    for (const w of g.warnings ?? []) kids.push(h('p', { class: 'muted' }, `warning: ${w}`));
    if (g.errors?.length) kids.push(h('ul', { class: 'error' }, g.errors.map((e) => h('li', {}, e))));
    fill(out, ...kids);
    const blocked = Boolean(g.errors?.length);
    start.disabled = blocked || noRepos;
    if (blocked) start.title = g.errors.join('; ');
    else start.removeAttribute('title');
    resume.textContent = res.resume && !(g.warnings ?? []).some((w) => /resumes from the ledger/.test(w)) ? 'resumes from the ledger' : '';
  }

  async function preview() {
    const mine = ++seq;
    try {
      const res = await api('/api/launches/preview', { method: 'POST', body: body() });
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

  async function go() {
    start.disabled = true;
    fill(startErrors);
    try {
      const res = await api('/api/launches', { method: 'POST', body: { ...body(), confirm: true } });
      dlg.close();
      location.hash = `#/launches/${res.launch.id}`;
    } catch (err) {
      const list = err.status === 409 && err.data?.guards?.errors?.length ? err.data.guards.errors : [err.message];
      fill(startErrors, h('ul', { class: 'error' }, list.map((e) => h('li', {}, e))));
      start.disabled = false;
    }
  }

  fill(dlg, 
    h('h2', {}, ACTION_TITLE[action] ?? 'Launch'),
    h('div', { class: 'stack' },
      needRepo ? (noRepos ? h('p', { class: 'muted' }, 'No repositories.') : h('div', {}, h('label', {}, 'Repository'), repoSel)) : null,
      needPlan && !noRepos ? h('div', {}, h('label', {}, 'Plan'), planSel) : null,
      h('div', { class: 'row' }, h('span', {}, 'Harness'), radio('claude', 'Claude Code'), radio('codex', 'Codex')),
      h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Model'), model), effortRow, h('div', {}, h('label', {}, 'Permission mode'), mode)),
      dangerRow,
      action === 'plan' ? h('div', {}, h('label', {}, 'Goal'), goal) : null,
      action === 'skill' ? h('div', {}, h('label', {}, 'Skill'), skill, h('label', {}, 'Arguments'), prompt) : null,
      action === 'marathon' ? h('div', {}, h('label', {}, 'Hours (1-48)'), hours) : null,
      out,
      startErrors,
      h('div', { class: 'row' }, start, resume, copy, cancel),
    ),
  );
  start.disabled = true;
  fill(out, empty('Loading preview…'));
  if (noRepos) { fill(out); dlg.showModal(); return; }
  dlg.addEventListener('close', () => { clearTimeout(timer); seq++; }, { once: true });
  dlg.showModal();
  await loadPlans();
  await preview();
}
