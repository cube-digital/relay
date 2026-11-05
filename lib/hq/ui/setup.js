// relay HQ Setup: Team, Flows, Skills, Connectors, API keys, Routines and Repositories as tabs.

import { fill, h } from './dom.js';
import { SETUP_TABS } from './routes.js';
import { renderBrainTab } from './brain.js';
import { renderRoutines } from './routines.js';
import { renderRepos } from './repos.js';

export async function renderSetup(main, { tab } = {}, ctx) {
  const id = SETUP_TABS.some(([t]) => t === tab) ? tab : 'team';
  const name = SETUP_TABS.find(([t]) => t === id)[1];
  ctx.crumbs([['Setup', '#/setup/team'], [name]]);
  // The sidebar lists the sections; these tabs show only where the sidebar folds into a top bar.
  const tabs = h('nav', { class: 'tabs setup-tabs' }, SETUP_TABS.map(([t, label]) => h('a', { href: `#/setup/${t}`, 'aria-current': t === id ? 'page' : undefined }, label)));
  const body = h('div', { class: 'stack' });
  fill(main, h('h1', {}, name), tabs, body);
  if (id === 'routines') return renderRoutines(body, { embedded: true }, ctx);
  if (id === 'repos') return renderRepos(body, ctx);
  return renderBrainTab(body, id, ctx);
}
