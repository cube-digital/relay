// Tiny DOM and API helpers shared by the relay HQ views. Every string from the
// API goes into the page as text, never as HTML.

const TOKEN_KEY = 'relay-hq-token';
export const LIGHT = { planned: 'grey', queued: 'grey', working: 'yellow', done: 'green', merged: 'green', blocked: 'red' };
export const GLYPH = { planned: '○', queued: '·', working: '◐', done: '✓', merged: '✓', blocked: '✕' };
export const PLAN_LIGHT = { planned: 'grey', running: 'yellow', blocked: 'red', complete: 'green' };

export function captureToken() {
  const m = /^#t=([0-9a-f]{64})$/.exec(location.hash);
  if (m) {
    sessionStorage.setItem(TOKEN_KEY, m[1]);
    history.replaceState(null, '', '/#/');
  }
}

export const token = () => sessionStorage.getItem(TOKEN_KEY) ?? '';

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${token()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `${res.status} ${res.statusText}`), { status: res.status, data });
  return data;
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'href') el.setAttribute('href', safeHref(v));
    else if (k === 'style' || k.startsWith('on')) continue;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Replace el's children with kids: flattens arrays, drops null/undefined/false,
// wraps non-Nodes in text (the native replaceChildren would print "a,b"/"null").
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((c) => c !== undefined && c !== null && c !== false).map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
  return el;
}

export const harnessLabel = (harness) => (harness === 'relay' ? 'relay CLI' : (harness ?? ''));

export function safeHref(v) {
  const s = String(v);
  return s.startsWith('#/') || s.startsWith('https://') ? s : '#/';
}

export function link(href, ...children) {
  const external = String(href).startsWith('https://');
  return h('a', { href, target: external ? '_blank' : undefined, rel: external ? 'noopener noreferrer' : undefined }, ...children);
}

export const light = (color, label) => h('span', { class: `light ${color ?? 'grey'}` }, label ?? '');
export const stateLight = (state, label = state) => h('span', { class: `light ${LIGHT[state] ?? 'grey'}`, title: label }, `${GLYPH[state] ?? '○'} ${label}`);
export const planLight = (status) => light(PLAN_LIGHT[status] ?? 'grey', status ?? 'unknown');

export function progress(green, total, running = false) {
  const bar = h('span', { class: running ? 'bar running' : 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total || 0), 'aria-valuenow': String(green || 0) });
  const fill = h('span', { class: 'green' });
  fill.style.width = `${total ? Math.round((100 * (green || 0)) / total) : 0}%`;
  bar.append(fill);
  return bar;
}

export function ago(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export const tilde = (path) => String(path ?? '').replace(/^\/(Users|home)\/[^/]+/, '~');

export async function openPath(path) {
  return api('/api/open', { method: 'POST', body: { path } });
}

const initialsOf = (name) => {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const raw = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return raw.toUpperCase();
};

// A neutral tile with the name's initials; `hot` fills it with the accent.
export function avatar(name, id, size, hot = false) {
  return h('span', { class: ['tile', hot ? 'hot' : '', size ? `av ${size}` : 'av'].filter(Boolean).join(' '), 'aria-hidden': 'true' }, initialsOf(name));
}

// A role's tile: its avatar letters; `size` ('sm') shrinks it.
export function roleTile(member, size) {
  return h('span', { class: size ? `tile initials ${size}` : 'tile initials', title: member?.title ?? '' }, member?.avatar ?? '');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MASCOT_BODY = ['..XXXXX..', '.XXXXXXX.', 'XX.XXX.XX', 'XXXXXXXXX', '.XXXXXXX.', '.X.X.X.X.'];
const MASCOT_HAT = {
  planner: ['..HHHHH..', '.HHHHHHH.'], // helmet
  builder: ['...HHHH..', '..HHHHHH.'], // cap
  reviewer: ['.........', 'HHHHHHHHH'], // visor
  coordinator: ['....HHH..', '....H....'], // flag
  finder: ['..H...H..', '...H.H...'], // antennae
};

// A role's 9×8 pixel critter; the hat's shape follows the role's kind and its colour the role's, the accent marks a working agent.
export function mascot(kind, working = false, title = '', hex = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: '36', height: '32', viewBox: '0 0 9 8', 'shape-rendering': 'crispEdges', class: working ? 'mascot on' : 'mascot', role: 'img', 'aria-label': title || kind || 'agent' })) svg.setAttribute(k, v);
  if (/^#[0-9a-f]{6}$/i.test(hex)) svg.style.setProperty('--hat', hex);
  [...(MASCOT_HAT[kind] ?? MASCOT_HAT.finder), ...MASCOT_BODY].forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const r = document.createElementNS(SVG_NS, 'rect');
      for (const [k, v] of Object.entries({ x: String(x), y: String(y), width: '1', height: '1', class: ch === 'H' ? 'hat' : 'body' })) r.setAttribute(k, v);
      svg.appendChild(r);
    });
  });
  return svg;
}

export const tag = (text, variant) => h('span', { class: variant ? `tag ${variant}` : 'tag' }, text);

// A panel heading: outlined icon, uppercase title, actions on the right.
export const panelHead = (title, ...actions) => h('div', { class: 'ph' }, h('span', { class: 'ic', 'aria-hidden': 'true' }), title, actions.length ? h('span', { class: 'act' }, actions) : null);

export function copyButton(label, text) {
  const btn = h('button', { class: 'btn', type: 'button', title: text }, label);
  btn.addEventListener('click', () => {
    navigator.clipboard?.writeText(text);
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = label; }, 1500);
  });
  return btn;
}

export const empty = (text) => h('p', { class: 'empty' }, text);
export const errorBox = (err) => h('p', { class: 'error', role: 'alert' }, err?.message ?? String(err));
