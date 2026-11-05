// The search palette: one input over projects, plans and skills.
// Opens in the shared #launch dialog; picking a row sets the hash and closes it.

import { api, fill, h } from './dom.js';
import { SETUP_TABS } from './routes.js';

const MAX = 30;

async function load() {
  const [side, plans, skills] = await Promise.all([
    api('/api/sidebar').catch(() => null),
    api('/api/plans').catch(() => null),
    api('/api/brain/skills').catch(() => null),
  ]);
  const items = [['All', '#/'], ...SETUP_TABS.map(([id, label]) => [`Setup · ${label}`, `#/setup/${id}`])]
    .map(([name, href]) => ({ kind: 'GO TO', name, detail: '', href }));
  const enc = encodeURIComponent;
  for (const p of side?.projects ?? []) items.push({ kind: 'PROJECT', name: p.name ?? p.id, detail: '', href: `#/projects/${enc(p.id)}` });
  for (const p of plans?.plans ?? []) items.push({ kind: 'PLAN', name: p.title ?? p.slug, detail: p.repoName ?? '', href: `#/repos/${enc(p.rid)}/plans/${enc(p.slug)}` });
  for (const s of skills?.skills ?? []) items.push({ kind: 'SKILL', name: s.name, detail: s.source ?? '', href: '#/setup/skills' });
  return items;
}

export async function openSearch(ctx) {
  const dlg = document.getElementById('launch');
  let items = [];
  let rows = [];
  let at = 0;
  const list = h('div', { class: 'stack', role: 'listbox' });
  const input = h('input', { type: 'text', 'aria-label': 'Search', placeholder: 'Search', autocomplete: 'off' });

  const open = (it) => {
    if (!it) return;
    location.hash = it.href;
    dlg.close();
  };
  const mark = () => rows.forEach((row, i) => row.el.setAttribute('aria-selected', i === at ? 'true' : 'false'));
  function render() {
    const q = input.value.trim().toLowerCase();
    const hit = items.filter((it) => !q || `${it.name} ${it.detail}`.toLowerCase().includes(q)).slice(0, MAX);
    at = 0;
    rows = hit.map((it) => ({
      it,
      el: h('div', { class: 'row', role: 'option', tabindex: '-1', onclick: () => open(it) },
        h('span', { class: 'tag' }, it.kind), h('span', {}, it.name), it.detail ? h('span', { class: 'muted' }, it.detail) : null),
    }));
    fill(list, rows.length ? rows.map((r) => r.el) : h('p', { class: 'muted' }, 'No matches.'));
    mark();
  }
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) at = (at + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
      mark();
      rows[at]?.el.scrollIntoView?.({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(rows[at]?.it);
    }
  });

  fill(dlg, input, list);
  render();
  dlg.showModal();
  input.focus();
  items = await load();
  if (dlg.open) render();
}
