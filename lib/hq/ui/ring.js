// relay HQ Overview: the orb with Running, Ready to merge and the Setup sections around it,
// and what waits on you in the centre. Every value from the API is rendered as text through h().

import { api, errorBox, fill, h, useStyle } from './dom.js';
import { orb } from './orb.js';

useStyle('/ring.css');

// Nodes evenly around the orb, positioned in % of the square stage, the first at the top.
function ring(nodes) {
  const n = nodes.length || 1;
  return h('nav', { class: 'ring', 'aria-label': 'Sections' }, nodes.map((it, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const el = h('a', { class: it.hot ? 'rb hot' : 'rb', href: it.href, title: `${it.label}: ${it.detail}` },
      h('span', { 'aria-hidden': 'true' }, it.glyph),
      h('span', { class: 'rl' }, h('b', {}, it.label), h('small', {}, it.detail)));
    el.style.left = `${(50 + 41 * Math.cos(a)).toFixed(2)}%`;
    el.style.top = `${(50 + 41 * Math.sin(a)).toFixed(2)}%`;
    return el;
  }));
}

export async function renderRing(main, ctx) {
  ctx.crumbs([['Overview']]);
  let data;
  try {
    data = await api('/api/ring');
  } catch (err) {
    if (err.status === 401) throw err;
    fill(main, errorBox(err));
    return { poll: false };
  }
  const canvas = h('canvas', { class: 'orb', width: '420', height: '420', 'aria-hidden': 'true' });
  const core = h('a', { class: data.needs ? 'core hot' : 'core', href: '#/', title: 'All' },
    h('b', {}, String(data.needs ?? 0)),
    h('small', {}, 'waiting on you'));
  fill(main, h('div', { class: 'hq-ring' }, h('div', { class: 'stage' }, canvas, ring(data.nodes ?? []), core)));
  if (!orb(canvas, { lanes: data.lanes ?? 0 })) canvas.hidden = true;
  return { poll: true };
}
