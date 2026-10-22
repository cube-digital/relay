// The Recos page: ranked recommendations as cards or a list, left nav, cart panel and
// the Apply entry point. All text goes through h/fill.

import { api, copyButton, empty, errorBox, fill, h, mascot } from './dom.js';
import { openApplyDialog } from './apply-dialog.js';

const GLYPH = { repos: '⎇', runs: '▶', routines: '◷', brain: '⚿' };
const AREA_NAV = [['repos', 'Repos', '⎇'], ['runs', 'Runs', '▤'], ['routines', 'Routines', '◷'], ['brain', 'Brain', '⚭']];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

let filter = '';
let view = 'cards';
let nav = 'priority';
let cartOpen = false;

function ensureCss() {
  if (document.querySelector('link[data-recos-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/recos.css';
  link.setAttribute('data-recos-css', '');
  document.head.appendChild(link);
}

const costText = (c) => (c?.tokens === 0 ? '0 tokens' : `~${c?.windowPct ?? '?'}% of 5h`);
// What happened to the launch Apply started for this reco.
function appliedLine(a) {
  if (!a) return null;
  const bad = ['failed', 'lost', 'stopped'].includes(a.status);
  const what = a.status === 'failed' && a.exitCode != null ? `failed (exit ${a.exitCode})` : a.status;
  return h('p', { class: bad ? 'applied bad' : 'applied' }, h('b', {}, 'Applied'), ' ', h('a', { href: `#/launches/${a.launch}` }, what), a.error ? ` · ${a.error}` : '', a.status === 'running' ? '' : ' · still found, add it to the cart to run again');
}

const hhmm = (iso) => {
  const d = new Date(iso ?? '');
  return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
};

export async function renderRecos(main, _params, ctx) {
  ensureCss();
  const root = h('div', { class: 'recos' });
  fill(main, root);
  let data;
  try {
    data = await api('/api/recos');
  } catch (err) {
    fill(root, errorBox(err));
    return { poll: false };
  }
  const rerender = () => renderRecos(main, _params, ctx);
  const errSlot = h('div', {});
  const act = async (op, ids) => {
    try {
      await api('/api/recos', { method: 'POST', body: { op, ids } });
    } catch (err) {
      fill(errSlot, errorBox(err));
      return;
    }
    await rerender();
  };

  const all = data.recos ?? [];
  const open = all.filter((r) => r.state === 'open' || r.state === 'applied');
  const counts = data.counts ?? {};
  const cartIds = data.cart ?? [];
  const byId = new Map(all.map((r) => [r.id, r]));
  const cartRecos = cartIds.map((id) => byId.get(id)).filter(Boolean);

  const priority = open.filter((r) => r.priority === 'high' || (r.priority === 'mid' && r.cost?.tokens === 0)).slice(0, 6);
  const list = (() => {
    if (nav === 'priority') return priority;
    if (nav === 'done' || nav === 'skipped') return all.filter((r) => r.state === nav);
    return open.filter((r) => r.area === nav);
  })();
  const gone = nav === 'done' || nav === 'skipped' ? (data.gone ?? []).filter((g) => g.state === nav) : [];

  const apply = () => openApplyDialog(cartIds, { onDone: rerender });
  const applyBtn = h('button', { class: 'btn primary', type: 'button', disabled: cartIds.length === 0, onclick: apply }, `Apply ${cartIds.length}`);

  const input = h('input', { type: 'search', 'data-filter': '', placeholder: 'Search', 'aria-label': 'Search', value: filter });
  input.addEventListener('input', () => {
    filter = input.value;
    drawBody();
  });

  const bar = h('div', { class: 'rc-bar' },
    input,
    h('button', { class: view === 'cards' ? 'btn on' : 'btn', type: 'button', onclick: () => { view = 'cards'; drawBody(); syncToggle(); } }, 'Cards'),
    h('button', { class: view === 'list' ? 'btn on' : 'btn', type: 'button', onclick: () => { view = 'list'; drawBody(); syncToggle(); } }, 'List'),
    h('button', { class: 'btn', type: 'button', onclick: () => { cartOpen = !cartOpen; drawCart(); } }, 'Cart', h('span', { class: 'n' }, String(cartIds.length))),
    applyBtn);
  function syncToggle() {
    const [c, l] = [...bar.querySelectorAll('button')];
    c.className = view === 'cards' ? 'btn on' : 'btn';
    l.className = view === 'list' ? 'btn on' : 'btn';
  }

  const navBtn = (key, label, ico, n) =>
    h('button', { class: nav === key ? 'nav on' : 'nav', type: 'button', onclick: () => { nav = key; rerender(); } }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), label, h('span', { class: 'n' }, String(n)));
  const side = h('div', { class: 'rc-side' },
    navBtn('priority', 'Priority', '◇', counts.priority ?? priority.length),
    h('div', { class: 'cap' }, 'AREAS'),
    AREA_NAV.map(([k, l, i]) => navBtn(k, l, i, counts[k] ?? 0)),
    h('div', { class: 'cap' }, 'STATE'),
    navBtn('done', 'Done', '✓', counts.done ?? 0),
    navBtn('skipped', 'Skipped', '⤫', counts.skipped ?? 0));

  const sources = data.sources ?? [];
  const okNames = sources.filter((s) => s.ok).map((s) => s.name).join(', ');
  const failed = sources.filter((s) => !s.ok).map((s) => s.name);
  const stats = h('div', { class: 'stats' },
    `${counts.total ?? open.length} open · repos ${counts.repos ?? 0} · runs ${counts.runs ?? 0} · routines ${counts.routines ?? 0} · brain ${counts.brain ?? 0} · ${counts.zeroTokens ?? 0} at 0 tokens · built ${hhmm(data.builtAt)} from ${okNames}`,
    failed.length ? h('span', { class: 'bad' }, ` · skipped ${failed.join(', ')}`) : null);

  const head = h('div', { class: 'head' },
    h('span', { class: 'logo' }),
    h('span', { class: 'title' }, 'RELAY ', h('span', {}, 'RECOS')),
    h('div', { class: 'mascots' }, (data.team ?? []).map((m) => mascot(m.kind, m.working, m.title, m.hex))));

  const buttons = (r) => {
    const inCart = r.inCart;
    const out = [];
    if (r.state === 'open' || r.state === 'applied') {
      if (r.apply?.kind !== 'manual') out.push(h('button', { class: inCart ? 'btn ac' : 'btn', type: 'button', onclick: () => act(inCart ? 'cart-remove' : 'cart-add', [r.id]) }, inCart ? 'In cart ✓' : 'Add to cart'));
      if (r.apply?.kind === 'manual' && r.apply.copy) out.push(copyButton('Copy', r.apply.copy));
      if (r.apply?.kind === 'manual') out.push(h('button', { class: 'btn', type: 'button', onclick: () => act('done', [r.id]) }, 'Done'));
      out.push(h('button', { class: 'btn', type: 'button', onclick: () => act('skip', [r.id]) }, 'Skip'));
    } else if (r.state === 'skipped') {
      out.push(h('button', { class: 'btn', type: 'button', onclick: () => act('unskip', [r.id]) }, 'Unskip'));
    }
    return out;
  };

  const cls = (base, r) => [base, r.priority === 'high' || r.priority === 'mid' ? 'hi' : '', r.unblocks ? 'unblocks' : ''].filter(Boolean).join(' ');

  const card = (r) =>
    h('div', { class: cls('rcard', r) },
      h('div', { class: 'top' }, h('span', { class: 'cat' }, String(r.area ?? '').toUpperCase()), r.rank ? h('span', { class: 'rank' }, `#${r.rank}`) : null, h('span', { class: 'glyph', 'aria-hidden': 'true' }, GLYPH[r.area] ?? '·')),
      h('div', { class: 'cb' },
        h('h3', {}, r.title),
        h('p', {}, h('b', {}, "What's the benefit"), ' ', r.benefit),
        h('p', {}, h('b', {}, 'What I can do'), ' ', r.action),
        h('div', { class: 'chips' },
          h('span', { class: 'chip' }, 'Effort ', h('b', {}, cap(r.effort))),
          h('span', { class: 'chip' }, 'Priority ', h('b', {}, cap(r.priority))),
          h('span', { class: r.cost?.tokens === 0 ? 'chip ac' : 'chip' }, costText(r.cost))),
        appliedLine(r.applied),
        (r.refs ?? []).length ? h('div', { class: 'chips' }, r.refs.map((x) => h('span', { class: 'chip code' }, x))) : null,
        h('div', { class: 'acts' }, buttons(r))));

  const row = (r) =>
    h('div', { class: cls('rrow', r) },
      r.rank ? h('span', { class: 'mono' }, `#${r.rank}`) : null,
      h('span', { class: 'tag' }, r.area),
      h('span', { class: 't' }, r.title),
      h('span', { class: 'mono' }, cap(r.priority)),
      h('span', { class: 'mono' }, costText(r.cost)),
      r.applied ? h('span', { class: r.applied.status === 'failed' ? 'mono bad' : 'mono' }, `applied: ${r.applied.status}`) : null,
      h('span', { class: 'acts' }, buttons(r)));

  const goneRow = (g) => h('div', { class: 'rrow gone' }, h('span', { class: 'tag' }, g.area), h('span', { class: 't' }, g.title));

  const body = h('div', {});
  const heading = { priority: ['◇', 'Priority'], done: ['✓', 'Done'], skipped: ['⤫', 'Skipped'] }[nav] ?? [AREA_NAV.find((a) => a[0] === nav)?.[2], cap(nav)];
  function drawBody() {
    const q = filter.trim().toLowerCase();
    const shown = q ? list.filter((r) => `${r.title} ${(r.refs ?? []).join(' ')}`.toLowerCase().includes(q)) : list;
    const shownGone = q ? gone.filter((g) => g.title.toLowerCase().includes(q)) : gone;
    const items = view === 'cards' ? h('div', { class: 'cards' }, shown.map(card)) : h('div', { class: 'rows' }, shown.map(row));
    fill(body,
      h('h2', {}, `${heading[0]} ${heading[1]}`, h('span', { class: 'n' }, String(shown.length + shownGone.length))),
      shown.length || shownGone.length ? null : empty('Nothing here.'),
      shown.length ? items : null,
      shownGone.length ? h('div', { class: 'rows' }, shownGone.map(goneRow)) : null);
  }

  const cartPanel = h('div', { class: 'cartp', role: 'dialog', 'aria-label': 'Cart' });
  function drawCart() {
    cartPanel.hidden = !cartOpen;
    fill(cartPanel,
      h('h4', {}, `Cart · ${cartIds.length}`),
      cartRecos.length ? null : empty('Empty.'),
      cartRecos.map((r) => h('div', { class: 'crow' }, h('span', {}, `${GLYPH[r.area] ?? ''} ${r.title}`), h('small', {}, r.apply?.kind ?? ''), h('button', { class: 'btn', type: 'button', 'aria-label': `Remove ${r.title}`, onclick: () => act('cart-remove', [r.id]) }, '✕'))),
      h('div', { class: 'acts' },
        h('button', { class: 'btn primary', type: 'button', disabled: cartIds.length === 0, onclick: apply }, `Apply ${cartIds.length}`),
        h('button', { class: 'btn', type: 'button', disabled: cartIds.length === 0, onclick: () => act('cart-clear', []) }, 'Clear')));
  }

  drawBody();
  drawCart();
  fill(root, bar, errSlot, h('div', { class: 'rc-body' }, side, h('div', { class: 'rc-main' }, head, stats, body)), cartPanel);
  return { poll: false };
}
