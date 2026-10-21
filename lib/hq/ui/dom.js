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

export const PALETTE = ['#8b5cf6', '#fb7185', '#34d399', '#5ee7ff', '#f59e0b', '#60a5fa', '#f472b6', '#a3e635'];

// A stable colour per name or id (FNV-1a over the string).
export function colorOf(key) {
  let x = 2166136261;
  for (const ch of String(key ?? '')) x = Math.imul(x ^ ch.codePointAt(0), 16777619) >>> 0;
  return PALETTE[x % PALETTE.length];
}

export function avatar(name, id, size) {
  const el = h('span', { class: size ? `av ${size}` : 'av', 'aria-hidden': 'true' }, String(name ?? '?').trim().charAt(0).toUpperCase() || '?');
  el.style.background = colorOf(id ?? name);
  return el;
}

export const empty = (text) => h('p', { class: 'empty' }, text);
export const errorBox = (err) => h('p', { class: 'error', role: 'alert' }, err?.message ?? String(err));
