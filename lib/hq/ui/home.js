// The Home view: Projects and Today on the left; the wordmark, the orb with its section ring
// and Running now in the centre; Waiting on you, Routines and the Skills Deck on the right.

import { ago, api, avatar, copyButton, empty, fill, h, mascot, panelHead, tag } from './dom.js';
import { openAddDialog } from './add-dialog.js';
import { openSearch } from './search.js';
import { orb } from './orb.js';

const UNASSIGNED = '_unassigned';
const RED = new Set(['lane-blocked', 'suite-failed', 'marathon-blocked', 'ci-red']);
const MIX = { 'lane-blocked': 'blocked', 'suite-failed': 'suite', 'marathon-blocked': 'marathon', 'ci-red': 'CI', 'ready-to-merge': 'ready', 'review-requested': 'review', routine: 'routine' };
const TONE = { accent: 'ac', red: 'red' };
const RING = 14;

let tab = null; // the selected Running now plan, `${rid}/${slug}`, kept across the 5 s poll
const gh = new Map(); // rid -> GitHub attention items, kept so a re-render does not blank them

const pad = (n) => String(n).padStart(2, '0');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const btnLink = (href, text) => h('a', { class: 'btn', href }, text);
const button = (text, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, text);

function clock(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '–';
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

function hhmm(iso) {
  const d = new Date(iso ?? '');
  return Number.isFinite(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : null;
}

const isToday = (iso) => {
  const d = new Date(iso ?? '');
  return Number.isFinite(d.getTime()) && d.toDateString() === new Date().toDateString();
};

// Server attention plus GitHub's, without duplicates, newest first.
function attention(data) {
  const seen = new Set();
  return [...(data.attention ?? []), ...[...gh.values()].flat()]
    .filter((a) => !seen.has(a.id) && seen.add(a.id))
    .sort((x, y) => String(y.at ?? '').localeCompare(String(x.at ?? '')));
}

// ---- centre ----------------------------------------------------------------

function budgetMenu(b) {
  const pct = (n) => (typeof n === 'number' ? `${Math.round(n)}%` : '?');
  const resets = hhmm(b?.resetsAt);
  return h('details', { class: 'menu budget-pop' },
    h('summary', { title: 'Budget', 'aria-label': 'Budget' }, '◔'),
    h('div', { class: 'menu-list mono' },
      h('span', {}, `5h ${pct(b?.fiveHour)}`),
      h('span', {}, `7d ${pct(b?.sevenDay)}`),
      resets ? h('span', {}, `resets ${resets}`) : null));
}

function ring(items, budget) {
  return h('div', { class: 'ring' }, items.slice(0, RING).map((it, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / RING;
    const cls = it.hot ? 'rb hot' : 'rb';
    const kids = [h('span', { 'aria-hidden': 'true' }, it.glyph), h('span', { class: 'rl' }, h('b', {}, it.label), h('small', {}, it.detail ?? it.count))];
    const el = it.id === 'budget'
      ? h('button', { class: cls, type: 'button', onclick: () => { budget.open = true; budget.querySelector('summary')?.focus(); } }, kids)
      : h('a', { class: cls, href: it.href }, kids);
    // cqw: the stage is a size container, so the ring scales with the centre column
    el.style.left = `${(50 + 42 * Math.cos(a)).toFixed(2)}cqw`;
    el.style.top = `${(50 + 42 * Math.sin(a)).toFixed(2)}cqw`;
    return el;
  }));
}

function taskRange(ids = []) {
  if (!ids.length) return '';
  return ids.length === 1 ? ids[0] : `${ids[0]}–${ids[ids.length - 1]}`;
}

function segment(s) {
  const planned = s.status === 'planned';
  const head = planned || !s.task ? [`Lane ${s.lane}`, taskRange(s.tasks)].filter(Boolean).join(' · ') : `${s.task.id} ${s.task.title}`;
  const meta = [s.title, `lane ${s.lane}`, s.model, s.effort, s.fix ? `fix round ${s.fix}` : `${s.done ?? 0}/${s.total ?? 0} tasks`].filter(Boolean).join(' · ');
  const bar = h('span', { class: s.status === 'blocked' ? 'red' : s.status === 'working' ? 'run' : '' });
  bar.style.width = `${s.total ? Math.round((100 * (s.done ?? 0)) / s.total) : 0}%`;
  const status = s.status === 'working' ? tag(clock(s.since), 'ac') : s.status === 'blocked' ? tag('blocked', 'red') : planned ? tag('◷') : tag('✓');
  return h('div', { class: planned ? 'ag planned' : 'ag' },
    h('span', { class: 'who' }, mascot(s.kind, s.status === 'working', s.title, s.hex)),
    h('div', {}, h('b', {}, head), h('div', { class: 'meta' }, meta), planned ? null : h('div', { class: 'pbar' }, bar)),
    status);
}

function planPanel(p) {
  const k = p.kpis ?? {};
  const l = k.lanes ?? {};
  const kpi = (label, value) => h('div', { class: 'kpi' }, h('small', {}, label), h('b', {}, value));
  const groups = [['running', 'Running'], ['finished', 'Finished'], ['planned', 'Planned']].map(([g, label]) => {
    const segs = p.groups?.[g] ?? [];
    return segs.length ? [h('div', { class: 'grp' }, `${label} · ${segs.length}`), segs.map(segment)] : null;
  });
  return h('div', { class: 'agents' },
    h('div', { class: 'ph' }, `Running now · ${p.title ?? p.slug}`, h('span', { class: 'act' }, btnLink(p.href ?? `#/repos/${p.rid}/plans/${p.slug}`, 'Board'), btnLink('#/brain/team', 'Team'))),
    h('div', { class: 'kpis' },
      kpi('Green', `${k.green ?? p.green ?? 0}/${k.total ?? p.totals?.tasks ?? 0}`),
      kpi('Wave', `${k.wave ?? p.currentWave ?? '?'} / ${k.waves ?? p.waveCount ?? '?'}`),
      kpi('Lanes', `${l.running ?? 0} · ${l.finished ?? 0} · ${l.planned ?? 0}`),
      kpi('Time', clock(k.startedAt))),
    groups);
}

function runningNow(plans, ctx) {
  if (!plans.length) {
    return h('div', { class: 'agents idle' }, empty('Nothing is running.'), button('Run a skill', () => ctx.openLaunch({ action: 'skill' }), 'btn ac'));
  }
  const key = (p) => `${p.rid}/${p.slug}`;
  const box = h('div', { class: 'running' });
  const draw = () => {
    const cur = plans.find((p) => key(p) === tab) ?? plans[0];
    const tabs = plans.length > 1
      ? h('div', { class: 'ptabs', role: 'tablist' }, plans.map((p) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(p === cur), onclick: () => { tab = key(p); draw(); } }, p.title ?? p.slug)))
      : null;
    fill(box, tabs, planPanel(cur));
  };
  draw();
  return box;
}

// ---- left ------------------------------------------------------------------

function projectRow(p, repos) {
  const rids = repos.filter((r) => (r.project ?? UNASSIGNED) === p.id).map((r) => r.rid);
  const ghItems = rids.flatMap((rid) => gh.get(rid) ?? []);
  const red = (text) => h('span', { class: 'red' }, text);
  const parts = [
    plural(p.repos ?? 0, 'repo', 'repos'),
    p.wave ? `wave ${p.wave}` : null,
    p.blocked > 0 ? red(`${p.blocked} blocked`) : null,
    ghItems.some((a) => a.kind === 'ci-red') ? red('CI red') : null,
    p.ready > 0 ? `${p.ready} ready to merge` : null,
  ].filter(Boolean);
  const status = parts.flatMap((x, i) => (i ? [' · ', x] : [x]));
  return h('a', { class: 'it', href: `#/projects/${encodeURIComponent(p.id)}` },
    avatar(p.name, p.id, null, (p.waiting ?? 0) + ghItems.length > 0),
    h('div', {}, h('b', {}, p.name), h('small', {}, status)));
}

function projectList(data) {
  const projects = data.projects ?? [];
  if (!projects.length) return empty('No repositories yet.');
  const ordered = [...projects.filter((p) => p.id !== UNASSIGNED), ...projects.filter((p) => p.id === UNASSIGNED)];
  return ordered.map((p) => projectRow(p, data.repos ?? []));
}

function todayList(rows) {
  if (!rows.length) return empty('Nothing today.');
  return rows.map((r) => h('div', { class: 'row' },
    h('span', { class: r.closest ? 't now' : 't' }, r.time),
    r.href ? h('a', { href: r.href }, r.text) : h('span', {}, r.text),
    tag(r.tag, TONE[r.tone])));
}

// ---- right -----------------------------------------------------------------

// A short "Kind · subject" label for a Waiting on you row; the full text goes in the title.
export function waitingLabel(a) {
  const text = String(a.text ?? '');
  const first = text.split('\n')[0].replace(/\s+/g, ' ').trim();
  const cut = (s, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  switch (a.kind) {
    case 'ready-to-merge': return `Ready to merge · ${a.plan ?? a.repoName ?? ''}`;
    case 'lane-blocked': return `Lane ${a.lane ?? '?'} blocked · ${a.repoName ?? a.plan ?? ''}`;
    case 'suite-failed': return `Suite failed · wave ${/wave (\d+)/.exec(text)?.[1] ?? '?'}`;
    case 'marathon-blocked': return `Marathon blocked · ${a.plan ?? a.repoName ?? ''}`;
    case 'ci-red': return `CI red · ${/PR #\d+/.exec(text)?.[0] ?? /^CI is red on (\S+)/.exec(text)?.[1] ?? a.repoName ?? ''}`;
    case 'review-requested': return `Review requested · ${/PR #\d+/.exec(text)?.[0] ?? a.repoName ?? ''}`;
    case 'routine': return `${a.label ?? 'Routine'} · ${cut(first)}`;
    default: return cut(first, 60);
  }
}

function waitingList(items, ctx) {
  if (!items.length) return [];
  const rows = items.slice(0, 5).map((a) => {
    const kids = [h('span', { class: RED.has(a.kind) ? 'x red' : 'x' }), h('b', {}, waitingLabel(a)), a.repoName ? h('small', {}, a.repoName) : null, h('span', { class: 'w' }, ago(a.at))];
    if (a.kind === 'ready-to-merge' && a.rid && a.plan) {
      const mark = h('button', { class: 'btn', type: 'button', onclick: () => api('/api/plans/merged', { method: 'POST', body: { rid: a.rid, slug: a.plan } }).then(ctx.refresh).catch((e) => alert(e.message)) }, 'Mark merged');
      return h('div', { class: 'flag', title: a.text }, h('a', { href: a.href, class: 'flag-link' }, kids), mark);
    }
    return a.href ? h('a', { class: 'flag', href: a.href, title: a.text }, kids) : h('div', { class: 'flag', title: a.text }, kids);
  });
  const counts = new Map();
  for (const a of items.filter((x) => isToday(x.at))) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const kinds = [...counts.keys()].sort((x, y) => Number(RED.has(y)) - Number(RED.has(x)));
  const mix = kinds.length
    ? [h('div', { class: 'mix', 'aria-label': "Today's mix" }, kinds.map((k) => {
        const seg = h('span', { class: RED.has(k) ? 'red' : '' });
        seg.style.flex = String(counts.get(k));
        return seg;
      })),
      h('div', { class: 'mixl' }, kinds.map((k) => h('span', {}, `${counts.get(k)} ${MIX[k] ?? k}`)))]
    : null;
  return [rows, mix];
}

function routinesTable(rows) {
  if (!rows.length) return empty('No routines.');
  return h('table', { class: 'rt' },
    h('thead', {}, h('tr', {}, ['TIME', 'ROUTINE', 'ON', 'STATUS'].map((c) => h('th', {}, c)))),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('td', {}, h('span', { class: r.status === 'NEXT' ? 't now' : 't' }, r.time)),
      h('td', {}, h('a', { href: r.href ?? '#/routines' }, [r.title, r.scopeLabel].filter(Boolean).join(' · '))),
      h('td', {}, tag(r.harness ?? '')),
      h('td', {}, tag(r.status, TONE[r.tone]))))));
}

function dialogShell(title, ...body) {
  const dlg = document.getElementById('launch');
  fill(dlg, h('h2', {}, title), h('div', { class: 'stack' }, ...body));
  if (!dlg.open) dlg.showModal();
  return dlg;
}

async function postDeck(body, err, ctx) {
  try {
    await api('/api/deck', { method: 'POST', body });
    document.getElementById('launch').close();
    ctx.refresh();
  } catch (e) {
    fill(err, h('p', { class: 'error', role: 'alert' }, e.message));
  }
}

function openSettings(it, deck, ctx) {
  let harness = it.harness ?? 'claude';
  const model = h('select', { 'aria-label': 'Model' });
  const effort = h('select', { 'aria-label': 'Effort' });
  const err = h('div', {});
  const sync = () => {
    const o = deck.options?.[harness] ?? { models: [], efforts: [] };
    fill(model, (o.models ?? []).map((m) => h('option', { value: m }, m)));
    fill(effort, (o.efforts ?? []).map((e) => h('option', { value: e }, e)));
    if (harness === it.harness) {
      model.value = it.model ?? '';
      effort.value = it.effort ?? '';
    }
  };
  const radio = (value) => h('label', {}, h('input', { type: 'radio', name: 'deck-harness', value, checked: harness === value, onchange: () => { harness = value; sync(); } }), ` ${value}`);
  sync();
  dialogShell(it.label,
    h('div', { class: 'row' }, Object.keys(deck.options ?? { claude: 1, codex: 1 }).map(radio)),
    h('div', {}, h('label', {}, 'Model'), model),
    h('div', {}, h('label', {}, 'Effort'), effort),
    err,
    h('div', { class: 'row' },
      button('Save', () => postDeck({ op: 'set', kind: it.kind, id: it.id, harness, model: model.value || undefined, effort: effort.value || undefined }, err, ctx), 'btn primary'),
      button('Cancel', () => document.getElementById('launch').close()),
      button('Remove from deck', () => postDeck({ op: 'remove', kind: it.kind, id: it.id }, err, ctx), 'btn danger')));
}

async function openAddSkill(deck, ctx) {
  const pinned = new Set((deck.items ?? []).map((i) => i.key));
  const err = h('div', {});
  const list = h('div', { class: 'stack pick' });
  const filter = h('input', { type: 'text', 'aria-label': 'Filter', placeholder: 'Filter', autocomplete: 'off' });
  let choices = (deck.commands ?? []).filter((c) => !pinned.has(`command:${c}`)).map((id) => ({ kind: 'command', id, label: `/relay:${id}` }));
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const hit = choices.filter((c) => !q || c.label.toLowerCase().includes(q));
    fill(list, hit.length ? hit.map((c) => button(c.label, () => postDeck({ op: 'add', kind: c.kind, id: c.id }, err, ctx), 'btn pick-item')) : empty('No matches.'));
  };
  filter.addEventListener('input', draw);
  dialogShell('Add skill', filter, list, err, h('div', { class: 'row' }, button('Cancel', () => document.getElementById('launch').close())));
  draw();
  filter.focus();
  try {
    const { skills = [] } = await api('/api/brain/skills');
    const names = [...new Set(skills.map((s) => s.name).filter(Boolean))].filter((n) => !pinned.has(`skill:${n}`)).sort();
    choices = [...choices, ...names.map((id) => ({ kind: 'skill', id, label: `/${id}` }))];
    if (list.isConnected) draw();
  } catch (e) {
    fill(err, h('p', { class: 'error', role: 'alert' }, e.message));
  }
}

function deckCard(it, deck, ctx) {
  const play = h('button', { class: 'btn ac', type: 'button', title: `Run ${it.label}`, 'aria-label': `Run ${it.label}`, disabled: it.missing, onclick: () => ctx.openLaunch(it.intent) }, '▶');
  const gear = h('button', { class: 'btn', type: 'button', title: 'Settings', 'aria-label': `Settings for ${it.label}`, onclick: () => openSettings(it, deck, ctx) }, '⚙');
  return h('div', { class: 'card' },
    h('b', {}, it.label),
    h('div', { class: 'mdl mono' }, `${it.model ?? '?'} · ${it.effort ?? '?'}`.toUpperCase()),
    h('div', { class: 'acts' }, play, gear, copyButton('⧉', it.label), it.missing ? tag('missing', 'red') : null));
}

function deckPanel(deck, ctx) {
  const add = deck ? button('+ Add skill', () => openAddSkill(deck, ctx), 'btn ac') : null;
  const items = deck?.items ?? [];
  return h('div', {},
    panelHead('Skills deck', add),
    items.length ? h('div', { class: 'deck' }, items.map((it) => deckCard(it, deck, ctx))) : empty('No skills pinned.'));
}

// ---- page ------------------------------------------------------------------

export async function renderHome(main, _params, ctx) {
  ctx.crumbs([['Home']]);
  const data = await api('/api/home');
  const projects = data.projects ?? [];
  const plans = data.running?.plans ?? [];
  const lanes = plans.reduce((n, p) => n + (p.groups?.running?.length ?? 0), 0);
  const add = () => openAddDialog({ projects: projects.filter((p) => p.id !== UNASSIGNED), onDone: () => ctx.refresh() });

  const coreCount = h('b', {});
  const bigCount = h('b', {});
  const waiting = h('div', { class: 'waiting' });
  const projectBox = h('div', { class: 'list' });
  const paint = () => {
    const items = attention(data);
    fill(coreCount, String(items.length));
    fill(bigCount, String(items.length));
    fill(waiting, waitingList(items, ctx));
    fill(projectBox, projectList(data));
  };
  paint();

  const budget = budgetMenu(data.budget);
  const canvas = h('canvas', { class: 'orb', width: '420', height: '420', 'aria-hidden': 'true' });
  const left = h('div', { class: 'col' },
    h('div', {}, panelHead('Projects', btnLink('#/projects', 'Expand'), button('+ Add repo', add, 'btn ac')), projectBox),
    h('div', { class: 'today' }, panelHead('Today', btnLink('#/routines', 'Week')), h('div', {}, todayList(data.today ?? []))));
  const centre = h('div', { class: 'centre' },
    h('div', { class: 'mark' }, h('span', { class: 'hex', 'aria-hidden': 'true' }), 'RELAY ', h('span', {}, 'Command Centre')),
    h('div', { class: 'sub' }, data.user ? `${data.user} · relay HQ` : 'relay HQ'),
    h('div', { class: 'icons' },
      h('button', { type: 'button', title: 'Search', 'aria-label': 'Search', onclick: () => openSearch(ctx) }, '⌕'),
      h('button', { type: 'button', title: 'Add repository', 'aria-label': 'Add repository', onclick: add }, '＋'),
      h('button', { type: 'button', title: 'Run a skill', 'aria-label': 'Run a skill', onclick: () => ctx.openLaunch({ action: 'skill' }) }, '▶'),
      budget),
    h('div', { class: 'stage' }, canvas, ring(data.ring ?? [], budget), h('div', { class: 'core' }, coreCount, h('small', {}, 'waiting on you'))),
    runningNow(plans, ctx));
  const right = h('div', { class: 'col r' },
    h('div', {}, panelHead('Waiting on you'), h('div', { class: 'big' }, bigCount, h('small', {}, 'items')), waiting),
    h('div', {}, panelHead('Routines', btnLink('#/routines', 'All')), routinesTable(data.routines ?? [])),
    deckPanel(data.deck, ctx));

  fill(main, h('div', { class: 'hq-home' }, h('div', { class: 'grid' }, left, centre, right)));
  if (!orb(canvas, { lanes })) canvas.hidden = true;

  // GitHub arrives later, one repository at a time, and joins Waiting on you and the project lines.
  for (const r of data.repos ?? []) {
    api(`/api/repos/${encodeURIComponent(r.rid)}/github`).then((g) => {
      gh.set(r.rid, g.attention ?? []);
      if (waiting.isConnected) paint();
    }).catch(() => {});
  }
  return { poll: true };
}
