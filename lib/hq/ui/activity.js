// Activity as compact groups: one per repository + plan, newest first. Only the newest group
// starts open; an open group shows its 3 latest events and "Show N more" reveals the rest
// (at most 50). Open and show-more state lives in memory (and sessionStorage when it works),
// so it survives the 5-second refresh and route changes. Collapsed groups render no rows.

import { ago, colorOf, h, link } from './dom.js';

const KEY = 'relay-hq-activity';
const SHOWN = 3;
const MAX = 50;

const state = { open: new Set(), closed: new Set(), more: new Set() };
try {
  const saved = JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
  for (const k of Object.keys(state)) for (const id of Array.isArray(saved[k]) ? saved[k] : []) state[k].add(String(id));
} catch { /* in-memory only */ }

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(state).map(([k, v]) => [k, [...v]]))));
  } catch { /* in-memory only */ }
}

const planOf = (e) => (e.plan ? String(e.plan).split('/').pop().replace(/\.md$/, '') : '');

export function groupEvents(events) {
  const groups = new Map();
  for (const e of events ?? []) {
    const id = `${e.rid ?? e.repoName ?? ''}|${planOf(e)}`;
    if (!groups.has(id)) groups.set(id, { id, repoName: e.repoName ?? '', plan: planOf(e), rid: e.rid ?? null, events: [] });
    groups.get(id).events.push(e);
  }
  for (const g of groups.values()) g.events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return [...groups.values()].sort((a, b) => (a.events[0].at < b.events[0].at ? 1 : a.events[0].at > b.events[0].at ? -1 : 0));
}

// events: activity events; projectOf(event) -> project id (for the dot colour); redraw repaints the list.
export function activityGroups(events, projectOf, empty) {
  const groups = groupEvents(events);
  if (!groups.length) return empty('No activity yet.');
  const root = h('div', { class: 'acts' });
  const paint = () => root.replaceChildren(...groups.map((g, i) => {
    const open = state.open.has(g.id) || (i === 0 && !state.closed.has(g.id));
    const toggle = () => {
      if (open) { state.open.delete(g.id); state.closed.add(g.id); } else { state.closed.delete(g.id); state.open.add(g.id); }
      save();
      paint();
    };
    const head = h('button', { class: 'act-head', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: toggle },
      h('span', { class: 'dot' }),
      h('span', { class: 'act-name' }, g.plan ? `${g.repoName} · ${g.plan}` : g.repoName),
      h('span', { class: 'act-n' }, `${g.events.length}`),
      h('span', { class: 'act-t' }, ago(g.events[0].at)));
    head.firstChild.style.background = colorOf(projectOf(g.events[0]));
    if (!open) return h('div', { class: 'act' }, head);
    const all = g.events.slice(0, MAX);
    const more = state.more.has(g.id);
    const shown = more ? all : all.slice(0, SHOWN);
    return h('div', { class: 'act' }, head,
      shown.map((e) => h('div', { class: 'ev' }, h('span', { class: 'muted' }, ago(e.at)), e.href ? link(e.href, e.text) : h('span', {}, e.text))),
      !more && all.length > SHOWN ? h('button', { class: 'btn more', type: 'button', onclick: () => { state.more.add(g.id); save(); paint(); } }, `Show ${all.length - SHOWN} more`) : null);
  }));
  paint();
  return root;
}
