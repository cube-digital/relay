// A one-field dialog in the shared <dialog>: prompt() does not work in every browser HQ runs in.
// onSubmit(value) may throw; its message shows in the dialog. onClose runs however it closes.
// All text, no HTML.

import { fill, h } from './dom.js';

export function openNameDialog({ title, label, value = '', action, onSubmit, onClose }) {
  const dlg = document.getElementById('launch');
  const input = h('input', { type: 'text', 'aria-label': label, value });
  const err = h('div', { class: 'stack' });
  const ok = h('button', { class: 'btn primary', type: 'button', onclick: () => submit() }, action);

  async function submit() {
    fill(err);
    const v = input.value.trim();
    if (!v) return fill(err, h('p', { class: 'error', role: 'alert' }, `${label} is required.`));
    ok.disabled = true;
    try {
      await onSubmit(v);
      dlg.close();
    } catch (e) {
      fill(err, h('p', { class: 'error', role: 'alert' }, e.message));
      ok.disabled = false;
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submit();
  });
  fill(dlg,
    h('h2', {}, title),
    h('div', { class: 'stack' },
      h('div', {}, h('label', {}, label), input),
      err,
      h('div', { class: 'row' }, ok, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'))));
  if (onClose) dlg.addEventListener('close', onClose, { once: true });
  dlg.showModal();
  input.focus();
  input.select();
}
