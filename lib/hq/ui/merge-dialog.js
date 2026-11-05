// Confirmation dialogs for Open PR and Merge locally: the server's preview first, then the
// action with confirm: true. Shown in the shared #launch dialog. Text only.

import { api, errorBox, fill, h } from './dom.js';

const btn = (label, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, label);

async function confirmFlow({ path, rid, slug, title, details, confirmLabel, done, onDone }) {
  const dlg = document.getElementById('launch');
  const close = btn('Close', () => dlg.close());
  fill(dlg, h('h2', {}, title), h('p', { class: 'muted' }, '…'));
  if (!dlg.open) dlg.showModal();
  let preview;
  try {
    preview = (await api(path, { method: 'POST', body: { rid, slug } })).preview;
  } catch (err) {
    fill(dlg, h('h2', {}, title), errorBox(err), h('div', { class: 'row' }, close));
    return;
  }
  const go = btn(confirmLabel, async () => {
    go.disabled = true;
    try {
      const res = await api(path, { method: 'POST', body: { rid, slug, confirm: true } });
      fill(dlg, h('h2', {}, title), done(res), h('div', { class: 'row' }, close));
      onDone?.();
    } catch (err) {
      const conflicts = err.data?.conflicts ?? [];
      fill(dlg, h('h2', {}, title), errorBox(err), conflicts.length ? h('ul', {}, conflicts.map((c) => h('li', {}, c))) : null, h('div', { class: 'row' }, close));
    }
  }, 'btn primary');
  fill(dlg, h('h2', {}, title), details(preview), h('div', { class: 'row' }, go, btn('Cancel', () => dlg.close())));
}

export function openPrDialog({ rid, slug }, { onDone } = {}) {
  return confirmFlow({
    path: '/api/plans/pr', rid, slug, title: `Open PR · ${slug}`, confirmLabel: 'Push and open PR', onDone,
    details: (p) => h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('b', {}, p.branch), h('span', { class: 'muted' }, '→'), h('b', {}, p.base)),
      h('p', {}, p.title),
      h('pre', { class: 'code' }, p.body)),
    done: (res) => h('p', {}, h('a', { href: res.url, target: '_blank', rel: 'noopener noreferrer' }, res.url)),
  });
}

export function openMergeDialog({ rid, slug }, { onDone } = {}) {
  return confirmFlow({
    path: '/api/plans/merge', rid, slug, title: `Merge locally · ${slug}`, confirmLabel: 'Merge', onDone,
    details: (p) => h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('b', {}, p.branch), h('span', { class: 'muted' }, '→'), h('b', {}, p.into)),
      p.dirty ? errorBox(new Error('the working tree has uncommitted changes')) : null,
      h('pre', { class: 'code' }, p.commits.join('\n'))),
    done: (res) => h('p', {}, `Merged into ${res.into} @ ${res.sha}`),
  });
}
