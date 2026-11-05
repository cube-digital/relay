// relay HQ Setup: Team, Flows, Skills, Connectors, API keys, Routines and Repositories as tabs.

import { fill, h } from './dom.js';
import { SETUP_TABS } from './routes.js';
import { renderBrainTab } from './brain.js';
import { renderRoutines } from './routines.js';
import { renderRepos } from './repos.js';

export async function renderSetup(main, { tab } = {}, ctx) {
  const id = SETUP_TABS.some(([t]) => t === tab) ? tab : 'team';
  ctx.crumbs([['Setup', '#/setup/team'], [SETUP_TABS.find(([t]) => t === id)[1]]]);
  const tabs = h('nav', { class: 'tabs' }, SETUP_TABS.map(([t, name]) => h('a', { href: `#/setup/${t}`, 'aria-current': t === id ? 'page' : undefined }, name)));
  const body = h('div', { class: 'stack' });
  fill(main, h('h1', {}, 'Setup'), tabs, body);
  if (id === 'routines') return renderRoutines(body, { embedded: true }, ctx);
  if (id === 'repos') return renderRepos(body, ctx);
  return renderBrainTab(body, id, ctx);
}
