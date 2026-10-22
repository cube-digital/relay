// The search palette: one input over projects, repositories, plans, skills and open recos.
// Opens in the shared #launch dialog; picking a row sets the hash and closes it.

import { api, fill, h } from './dom.js';

const MAX = 30;

async function load() {
  const [home, skills, recos] = await Promise.all([
    api('/api/home').catch(() => null),
    api('/api/brain/skills').catch(() => null),
    api('/api/recos').catch(() => null),
  ]);
  const items = [
    ['Home', '#/'], ['Projects', '#/projects'], ['Plans', '#/plans'], ['Routines', '#/routines'], ['Recos', '#/recos'],
    ['Activity', '#/activity'], ['Launches', '#/launches'], ['Brain · Team', '#/brain/team'], ['Brain · Flows & pieces', '#/brain/flows'],
    ['Brain · Skills', '#/brain/skills'], ['Brain · Connectors', '#/brain/connectors'], ['Brain · API keys', '#/brain/keys'],
  ].map(([name, href]) => ({ kind: 'GO TO', name, detail: '', href }));
  const enc = encodeURIComponent;
  const projects = home?.projects ?? [];
  for (const p of projects) items.push({ kind: 'PROJECT', name: p.name ?? p.id, detail: '', href: `#/projects/${enc(p.id)}` });
  for (const r of home?.repos ?? []) {
    const owner = r.project ?? '_unassigned'; // home.repos carry their project id; null means Unassigned
    items.push({ kind: 'REPO', name: r.name ?? r.rid, detail: '', href: `#/projects/${enc(owner)}/repos` });
  }
  for (const p of home?.plans ?? []) items.push({ kind: 'PLAN', name: p.title ?? p.slug, detail: p.repoName ?? '', href: `#/repos/${enc(p.rid)}/plans/${enc(p.slug)}` });
  for (const s of skills?.skills ?? []) items.push({ kind: 'SKILL', name: s.name, detail: s.source ?? '', href: '#/brain/skills' });
  for (const r of recos?.recos ?? []) if (r.state === 'open') items.push({ kind: 'RECO', name: r.title, detail: [r.source, r.area].filter(Boolean).join(' · '), href: '#/recos' });
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
