// relay HQ Brain views: connectors, API keys, skills, agents and how relay is wired.
// Every value from the API is rendered as text through h().

import { ago, api, colorOf, empty, errorBox, h, light, link } from './dom.js';
import { openLaunchDialog } from './launch-dialog.js';

const TABS = [['connectors', 'Connectors'], ['keys', 'API keys'], ['skills', 'Skills'], ['agents', 'Agents'], ['wiring', 'How relay is wired']];
const STATUS_LIGHT = { connected: 'green', configured: 'green', set: 'green', 'needs-auth': 'yellow', 'in-file': 'yellow', 'key-missing': 'red', missing: 'red', unreadable: 'red' };

// View state that survives a re-render.
let connFilter = 'all';
let keyFilter = 'all';
let verifyRaw = {};
let openStep = null;

const pill = (status) => light(STATUS_LIGHT[status] ?? 'grey', status ?? 'unknown');
const section = (title, ...kids) => h('section', {}, h('h2', {}, title), ...kids);
const th = (cols) => h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c))));
const table = (cols, rows) => h('table', { class: 'list' }, th(cols), h('tbody', {}, rows));
const model = (m) => (m ? [m.model, m.effort].filter(Boolean).join(' · ') : '');
const parts = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const list = (v) => parts(v).join(', ');

function filters(options, value, set, redraw) {
  return h('div', { class: 'filters' }, options.map(([id, label]) => h('button', {
    type: 'button',
    'aria-pressed': value === id ? 'true' : 'false',
    onclick: () => { set(id); redraw(); },
  }, label)));
}

// ---- connectors ----------------------------------------------------------

function widget(c) {
  const tile = h('span', { class: 'initials' }, c.initials ?? '');
  tile.style.background = colorOf(c.label ?? c.name);
  return h('div', { class: 'widget stack' },
    h('div', { class: 'row' },
      tile,
      h('strong', {}, c.label ?? c.name),
      c.labelInferred ? h('span', { class: 'tag' }, 'inferred') : null),
    h('span', { class: 'muted' }, c.source ?? ''),
    Number.isFinite(c.tools) ? h('span', { class: 'muted' }, `${c.tools} tools`) : null,
    h('div', { class: 'row' },
      pill(c.status),
      ...parts(c.harness).map((x) => h('span', { class: 'tag' }, x))),
    c.status === 'needs-auth' ? h('code', {}, '/mcp') : null,
    c.status === 'unreadable' && c.file ? h('span', { class: 'muted' }, c.file) : null,
    c.recordedAt ? h('span', { class: 'muted' }, `recorded ${ago(c.recordedAt)}`) : null);
}

function connectorsView(data, redraw, ctx) {
  const needs = (c) => c.status !== 'connected' && c.status !== 'configured';
  const match = (c) => connFilter === 'all' || (connFilter === 'needs' ? needs(c) : parts(c.harness).includes(connFilter));
  const shown = (data.connectors ?? []).filter(match);
  const harnessRow = h('div', { class: 'row' }, ['claude', 'codex'].map((hn) => h('span', { class: 'row' },
    h('span', { class: 'muted' }, `${hn}: ${data.snapshots?.[hn] ? ago(data.snapshots[hn]) : 'never'}`),
    h('button', { class: 'btn', type: 'button', onclick: () => openLaunchDialog({ action: 'connectors', harness: hn }) }, `Refresh ${hn}`))));
  const verify = h('button', { class: 'btn', type: 'button', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const res = await api('/api/brain/verify', { method: 'POST', body: {} });
      verifyRaw = {};
      for (const hn of ['claude', 'codex']) if (res?.[hn]?.raw) verifyRaw[hn] = res[hn].raw;
    } catch (err) {
      verifyRaw = { error: err.message };
    }
    ctx.refresh();
  } }, 'Verify');
  const raws = Object.entries(verifyRaw).map(([hn, raw]) => h('pre', { class: 'code', 'aria-label': `${hn} output` }, raw));
  const conns = data.connections ?? [];
  return [
    h('div', { class: 'row' }, filters([['all', 'All'], ['claude', 'Claude'], ['codex', 'Codex'], ['needs', 'Needs action']], connFilter, (v) => { connFilter = v; }, redraw), verify),
    harnessRow,
    raws,
    shown.length ? h('div', { class: 'grid' }, shown.map(widget)) : empty('No connectors.'),
    section('API connections', conns.length
      ? h('div', { class: 'grid' }, conns.map((c) => h('div', { class: 'widget stack' },
        h('strong', {}, c.service ?? ''),
        h('code', {}, c.key ?? ''),
        pill(c.status),
        h('span', { class: 'muted' }, c.usedBy?.length ? `used by ${list(c.usedBy)}` : ''))))
      : empty('No API connections.')),
    section('CLIs', h('div', { class: 'row' }, (data.clis ?? []).map((c) => h('span', { class: 'chip' },
      `${c.name} · ${c.present ? 'present' : 'absent'}`,
      c.name === 'gh' && c.present && c.auth != null ? ` · ${typeof c.auth === 'string' ? c.auth : c.auth ? 'signed in' : 'signed out'}` : '')))),
  ];
}

// ---- keys ----------------------------------------------------------------

function keysView(data, redraw) {
  const all = data.keys ?? [];
  const shown = all.filter((k) => keyFilter === 'all' || (keyFilter === 'missing' ? k.status === 'missing' : k.status === 'in-file'));
  return [
    filters([['all', 'All'], ['missing', 'Missing'], ['in-file', 'Written in a file']], keyFilter, (v) => { keyFilter = v; }, redraw),
    shown.length ? h('div', { class: 'grid' }, shown.map((k) => h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('code', {}, k.name), pill(k.status)),
      h('span', { class: 'muted' }, k.setIn ? `set in ${k.setIn}` : ''),
      (k.neededBy ?? []).length ? h('div', { class: 'row' }, k.neededBy.map((n) => h('span', { class: 'chip' }, `${n.kind} ${n.name}${n.harness ? ` · ${list(n.harness)}` : ''}`))) : null,
      k.warning ? h('p', { class: 'error' }, k.warning) : null))) : empty('No keys.'),
  ];
}

// ---- skills --------------------------------------------------------------

function skillsView(data) {
  const usage = Boolean(data.usageAvailable);
  const skills = data.skills ?? [];
  if (!skills.length) return empty('No skills.');
  return table(['Name', 'Source', 'Description', 'Referenced by', ...(usage ? ['Uses', 'Last used'] : [])], skills.map((s) => h('tr', {},
    h('td', {}, s.name),
    h('td', {}, [s.source, list(s.harness)].filter(Boolean).join(' · ')),
    h('td', {}, s.description ?? ''),
    h('td', {}, list(s.referencedBy)),
    usage ? h('td', {}, s.usage ? String(s.usage.count ?? 0) : '') : null,
    usage ? h('td', {}, s.usage?.lastUsedAt ? ago(s.usage.lastUsedAt) : '') : null)));
}

// ---- agents --------------------------------------------------------------

function agentsView(data) {
  const relay = data.relay ?? [];
  const other = data.other ?? [];
  return [
    section('relay roles', relay.length ? table(['Name', 'Tier', 'Claude', 'Codex', 'Tools', 'Read-only', 'Max turns', 'Source', 'Generated'], relay.map((r) => h('tr', {},
      h('td', {}, r.name),
      h('td', {}, h('span', { class: `tag tier-${r.tier}` }, r.tier ?? '')),
      h('td', {}, model(r.claude)),
      h('td', {}, model(r.codex)),
      h('td', {}, list(r.tools)),
      h('td', {}, r.readonly ? 'yes' : 'no'),
      h('td', {}, r.maxTurns ?? ''),
      h('td', {}, r.source ?? ''),
      h('td', {}, typeof r.generated === 'boolean' ? (r.generated ? 'yes' : 'no') : list(r.generated))))) : empty('No relay roles.')),
    section('Other agents', other.length ? table(['Name', 'Source', 'Harness', 'Model', 'Description'], other.map((a) => h('tr', {},
      h('td', {}, a.name),
      h('td', {}, a.source ?? ''),
      h('td', {}, list(a.harness)),
      h('td', {}, a.unreadable || a.model === 'unreadable' ? h('span', { class: 'error' }, 'unreadable') : a.model ?? ''),
      h('td', {}, a.description ?? '')))) : empty('No other agents.')),
  ];
}

// ---- wiring --------------------------------------------------------------

function stepPanel(step) {
  const r = step.role;
  const rows = [
    ['Role', step.agent ?? step.coordinator ?? (step.cli ? `relay ${step.cli}` : '')],
    ['Skills', list(step.skills)],
    ['Tools', list(r?.tools)],
    ['When', step.when ?? ''],
    ['Claude', model(r?.claude)],
    ['Codex', model(r?.codex)],
  ].filter(([, v]) => v);
  return h('div', { class: 'panel stack' }, h('strong', {}, step.id ?? ''), rows.map(([k, v]) => h('div', { class: 'row' }, h('span', { class: 'muted' }, k), h('span', {}, v))));
}

function stepNode(step, flowId, redraw) {
  const key = `${flowId}/${step.id}`;
  const pick = () => { openStep = openStep?.key === key ? null : { key, step }; redraw(); };
  if (Array.isArray(step.steps)) {
    return h('div', { class: 'group' },
      h('button', { class: `step ${step.role?.tier ? `tier-${step.role.tier}` : ''}`, type: 'button', onclick: pick }, step.id),
      step.repeat ? h('span', { class: 'muted' }, step.repeat) : null,
      h('div', { class: 'flow' }, step.steps.map((s) => stepNode(s, flowId, redraw))));
  }
  const cls = step.cli ? 'step cli' : `step ${step.role?.tier ? `tier-${step.role.tier}` : ''}`;
  return h('button', { class: cls, type: 'button', 'aria-pressed': openStep?.key === key ? 'true' : 'false', onclick: pick },
    step.cli ? `relay ${step.cli}` : (step.agent ?? step.id));
}

function wiringView(data, redraw) {
  const flows = data.flows ?? [];
  const problems = data.flowProblems ?? [];
  const byFrom = new Map();
  for (const e of data.edges ?? []) byFrom.set(e.from, [...(byFrom.get(e.from) ?? []), e]);
  const gen = data.generated ?? [];
  return [
    problems.length ? h('ul', { class: 'error' }, problems.map((p) => h('li', {}, p))) : null,
    flows.map((f) => h('div', { class: 'stack' },
      h('h3', {}, f.label ?? f.id),
      h('div', { class: 'flow' }, (f.steps ?? []).map((s) => stepNode(s, f.id, redraw))))),
    openStep ? stepPanel(openStep.step) : null,
    section('What is generated from what', gen.length ? table(['Path', 'From', 'State'], gen.map((g) => h('tr', {},
      h('td', {}, g.path),
      h('td', {}, list(g.from)),
      h('td', {}, g.inSync ? light('green', 'in sync') : light('red', 'stale'))))) : empty('Nothing generated.')),
    section('Who uses whom', byFrom.size ? h('div', { class: 'stack' }, [...byFrom].map(([from, edges]) => h('div', { class: 'row' },
      h('strong', {}, from),
      edges.map((e) => h('span', { class: 'chip' }, `${e.to} · ${e.kind}`))))) : empty('No links.')),
  ];
}

// ---- entry ---------------------------------------------------------------

const VIEWS = { connectors: connectorsView, keys: keysView, skills: skillsView, agents: agentsView, wiring: wiringView };

export async function renderBrain(main, { tab } = {}, ctx) {
  const id = TABS.some(([t]) => t === tab) ? tab : 'connectors';
  ctx.crumbs([['Home', '#/'], ['Brain']]);
  const tabs = h('nav', { class: 'tabs' }, TABS.map(([t, label]) => link(`#/brain/${t}`, label)));
  tabs.querySelectorAll('a').forEach((a, i) => { if (TABS[i][0] === id) a.setAttribute('aria-current', 'page'); });
  const body = h('div', { class: 'stack' });
  main.replaceChildren(h('h1', {}, 'Brain'), tabs, body);
  try {
    const data = await api(`/api/brain/${id}`);
    const redraw = () => body.replaceChildren(...[VIEWS[id](data, redraw, ctx)].flat(Infinity).filter(Boolean));
    redraw();
  } catch (err) {
    if (err.status === 401) throw err;
    body.replaceChildren(errorBox(err));
  }
  return { poll: false };
}
