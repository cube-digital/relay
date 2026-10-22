// The Plans page: every plan of every repository in one place, grouped Needs you · Running ·
// Up next · Done, filtered by project and text. Each row carries its actions.

import { api, fill, h } from './dom.js';
import { planList } from './plan-row.js';

let project = 'all'; // survives the 5 s refresh
let query = '';

export async function renderPlans(main, _params, ctx) {
  ctx.crumbs([['Home', '#/'], ['Plans']]);
  const { plans = [], projects = [] } = await api('/api/plans');
  const used = projects.filter((p) => plans.some((x) => x.project === p.id));
  if (project !== 'all' && !used.some((p) => p.id === project)) project = 'all';
  const body = h('div', {});
  const search = h('input', { type: 'search', 'aria-label': 'Filter plans', placeholder: 'Filter plans', value: query });
  const chips = h('div', { class: 'filters' });
  const draw = () => {
    fill(chips, [['all', 'All projects'], ...used.map((p) => [p.id, p.name])].map(([id, label]) => h('button', { type: 'button', 'aria-pressed': project === id ? 'true' : 'false', onclick: () => { project = id; draw(); } }, label)));
    const q = query.trim().toLowerCase();
    const shown = plans.filter((p) => (project === 'all' || p.project === project) && (!q || `${p.slug} ${p.title ?? ''} ${p.repoName}`.toLowerCase().includes(q)));
    fill(body, planList(shown, { showProject: project === 'all', refresh: ctx.refresh, emptyText: plans.length ? 'No plans match.' : 'No plans yet.' }));
  };
  search.addEventListener('input', () => { query = search.value; draw(); });
  const newPlan = h('button', { class: 'btn ac', type: 'button', onclick: () => ctx.openLaunch({ action: 'plan' }) }, '+ New plan');
  draw();
  fill(main, h('div', { class: 'phead' }, h('h1', {}, 'Plans'), h('div', { class: 'row' }, newPlan)), h('div', { class: 'row toolbar' }, chips, search), body);
  return { poll: true };
}
