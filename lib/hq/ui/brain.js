// relay HQ Brain views: connectors, API keys, skills, the team (roles as cards
// with profiles) and flows (the six points around the lane chassis, with pieces).
// Every value from the API is rendered as text through h().

import { ago, api, colorOf, copyButton, empty, errorBox, fill, h, light, link, roleTile } from './dom.js';
import { openLaunchDialog } from './launch-dialog.js';

const TABS = [['connectors', 'Connectors'], ['keys', 'API keys'], ['skills', 'Skills'], ['team', 'Team'], ['flows', 'Flows']]
const ALIASES = { agents: 'team', wiring: 'flows' };
const STATUS_LIGHT = { connected: 'green', configured: 'green', set: 'green', 'needs-auth': 'yellow', 'in-file': 'yellow', 'key-missing': 'red', missing: 'red', unreadable: 'red' };

// View state that survives a re-render.
let connFilter = 'all';
let keyFilter = 'all';
let verifyRaw = {};
let flowPick = null;
let openPiece = null;

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

// ---- team ----------------------------------------------------------------

const PROFILE = ['Understands', 'Receives', 'Delivers', 'Never'];

function roleCard(m) {
  const profile = m.profile ?? {};
  return h('div', { class: 'card stack' },
    h('div', { class: 'row' }, roleTile(m), h('strong', {}, m.title || m.name), h('span', { class: 'muted' }, m.name)),
    h('div', { class: 'row' }, m.kind ? h('span', { class: 'tag' }, m.kind) : null, m.tier ? h('span', { class: `tag tier-${m.tier}` }, m.tier) : null),
    h('span', { class: 'muted' }, `Claude ${model(m.claude)}`),
    h('span', { class: 'muted' }, `Codex ${model(m.codex)}`),
    h('p', {}, m.description ?? ''),
    h('details', {}, h('summary', {}, 'Profile'), PROFILE.map((k) => h('div', {}, h('h3', {}, k), h('p', { class: 'pre' }, profile[k] ?? '')))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'In flows'), (m.appearsIn ?? []).length
      ? m.appearsIn.map((a) => h('span', { class: 'chip' }, `${a.flow} · ${a.point} · ${a.piece}`))
      : h('span', { class: 'muted' }, 'none')),
    (m.problems ?? []).map((p) => h('p', { class: 'error' }, p)));
}

function teamView(data) {
  const team = data.team ?? [];
  const other = data.other ?? [];
  return [
    h('div', { class: 'row' }, copyButton('Copy relay role new', data.roleNew ?? '')),
    team.length ? h('div', { class: 'grid' }, team.map(roleCard)) : empty('No relay roles.'),
    section('Other agents', other.length ? table(['Name', 'Source', 'Harness', 'Model', 'Description'], other.map((a) => h('tr', {},
      h('td', {}, a.name),
      h('td', {}, a.source ?? ''),
      h('td', {}, list(a.harness)),
      h('td', {}, a.unreadable || a.model === 'unreadable' ? h('span', { class: 'error' }, 'unreadable') : a.model ?? ''),
      h('td', {}, a.description ?? '')))) : empty('No other agents.')),
  ];
}

// ---- flows ---------------------------------------------------------------

// The lane chassis in run order: fixed steps, with the flow's points between them.
const CHASSIS = [
  'spec', ['plan.before'], 'architect plans', 'relay lanes', ['plan.after'],
  ['lane.before'], 'implementer', ['lane.after'], 'reviewer and fix loop', 'merge and suite', ['wave.after'], 'final review', ['final'],
];

function pieceChip(p, flowId, point, redraw) {
  const key = `${flowId}/${point}/${p.piece}`;
  const chip = h('button', {
    class: 'chip piece',
    type: 'button',
    'aria-pressed': openPiece?.key === key ? 'true' : 'false',
    onclick: () => { openPiece = openPiece?.key === key ? null : { key, flowId, point, piece: p }; redraw(); },
  },
    roleTile({ avatar: p.avatar, title: p.roleTitle, hex: p.hex }, 'sm'),
    h('strong', {}, p.title),
    h('span', { class: `tag gate-${p.gate}` }, p.gate),
    h('span', { class: 'muted' }, p.when));
  chip.style.borderLeftColor = p.hex;
  return chip;
}

function piecePanel(open, flows) {
  const p = open.piece;
  const flow = flows.find((f) => f.id === open.flowId);
  const placed = new Set(Object.entries(flow?.slots ?? {}).filter(([, ps]) => ps.some((x) => x.piece === p.piece)).map(([pt]) => pt));
  const rows = [
    ['Brief', p.brief],
    ['Output', p.output],
    ['Slots', list(p.slots)],
    ['Gate', p.gate],
    ['Read-only', p.readonly ? 'yes' : 'no'],
    ['Protect', list(p.protect)],
    ['Skills', list(p.skills)],
  ].filter(([, v]) => v);
  return h('div', { class: 'panel stack' },
    h('div', { class: 'row' }, roleTile({ avatar: p.avatar, title: p.roleTitle, hex: p.hex }), h('strong', {}, p.title), h('span', { class: 'muted' }, p.roleTitle)),
    rows.map(([k, v]) => h('div', { class: 'stack' }, h('span', { class: 'muted' }, k), h('span', { class: 'pre' }, v))),
    h('div', { class: 'row' },
      (p.slots ?? []).filter((pt) => !placed.has(pt)).map((pt) => copyButton(`Copy relay flow add (${pt})`, `relay flow add ${open.flowId} ${p.piece} --at ${pt}`)),
      copyButton('Copy relay piece new', `relay piece new <new-id> --role ${p.role} --slot ${open.point}`)));
}

function flowsView(data, redraw) {
  const flows = data.flows ?? [];
  const problems = data.problems ?? [];
  const flow = flows.find((f) => f.id === flowPick) ?? flows.find((f) => f.id === 'feature') ?? flows[0];
  const byFrom = new Map();
  for (const e of data.edges ?? []) byFrom.set(e.from, [...(byFrom.get(e.from) ?? []), e]);
  const gen = data.generated ?? [];
  const column = (point) => h('div', { class: 'point' },
    h('h3', {}, point),
    (flow.slots?.[point] ?? []).length ? flow.slots[point].map((p) => pieceChip(p, flow.id, point, redraw)) : h('span', { class: 'muted' }, 'empty'));
  return [
    problems.length ? h('ul', { class: 'error' }, problems.map((p) => h('li', {}, p))) : null,
    flows.length ? filters(flows.map((f) => [f.id, f.title ?? f.id]), flow.id, (v) => { flowPick = v; openPiece = null; }, redraw) : empty('No flows.'),
    flow ? h('div', { class: 'points' }, CHASSIS.map((c) => (Array.isArray(c) ? column(c[0]) : h('div', { class: 'chassis-step' }, c)))) : null,
    openPiece && flow && openPiece.flowId === flow.id ? piecePanel(openPiece, flows) : null,
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

const VIEWS = { connectors: connectorsView, keys: keysView, skills: skillsView, team: teamView, flows: flowsView };

export async function renderBrain(main, { tab } = {}, ctx) {
  const wanted = ALIASES[tab] ?? tab;
  const id = TABS.some(([t]) => t === wanted) ? wanted : 'connectors';
  ctx.crumbs([['Home', '#/'], ['Brain']]);
  const tabs = h('nav', { class: 'tabs' }, TABS.map(([t, label]) => link(`#/brain/${t}`, label)));
  tabs.querySelectorAll('a').forEach((a, i) => { if (TABS[i][0] === id) a.setAttribute('aria-current', 'page'); });
  const body = h('div', { class: 'stack' });
  fill(main, h('h1', {}, 'Brain'), tabs, body);
  try {
    const data = await api(`/api/brain/${id}`);
    const redraw = () => fill(body, ...[VIEWS[id](data, redraw, ctx)].flat(Infinity).filter(Boolean));
    redraw();
  } catch (err) {
    if (err.status === 401) throw err;
    fill(body, errorBox(err));
  }
  return { poll: false };
}
