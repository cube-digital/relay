// The "Add repository" form: a path and a project (existing, none, or new). Shown in the
// shared dialog, so the 5-second refresh leaves it alone while it is open. All text, no HTML.

import { api, fill, h } from './dom.js';

const NONE = '';
const NEW = '__new';

// projects: [{ id, name }]; selected: project id to preselect; onDone runs after a successful add.
export function openAddDialog({ projects, selected, onDone }) {
  const dlg = document.getElementById('launch');
  const path = h('input', { type: 'text', 'aria-label': 'Repository path', placeholder: '~/code/my-repo' });
  const pick = h('select', { 'aria-label': 'Project' },
    h('option', { value: NONE }, 'No project'),
    projects.map((p) => h('option', { value: p.id }, p.name)),
    h('option', { value: NEW }, 'New project…'));
  pick.value = projects.some((p) => p.id === selected) ? selected : NONE;
  const name = h('input', { type: 'text', 'aria-label': 'New project name', placeholder: 'Project name' });
  const nameRow = h('div', {}, h('label', {}, 'New project name'), name);
  const err = h('div', { class: 'stack' });
  const add = h('button', { class: 'btn primary', type: 'button', onclick: () => submit() }, 'Add');
  const sync = () => { nameRow.hidden = pick.value !== NEW; };
  pick.addEventListener('change', sync);
  sync();

  async function submit() {
    fill(err);
    const project = pick.value === NEW ? name.value.trim() : projects.find((p) => p.id === pick.value)?.name;
    if (pick.value === NEW && !project) return fill(err, h('p', { class: 'error', role: 'alert' }, 'Give the new project a name.'));
    add.disabled = true;
    try {
      await api('/api/registry', { method: 'POST', body: { op: 'add', path: path.value, project: project || undefined } });
      dlg.close();
      onDone();
    } catch (e) {
      fill(err, h('p', { class: 'error', role: 'alert' }, e.message));
      add.disabled = false;
    }
  }

  fill(dlg, 
    h('h2', {}, 'Add repository'),
    h('div', { class: 'stack' },
      h('div', {}, h('label', {}, 'Path'), path),
      h('div', {}, h('label', {}, 'Project'), pick),
      nameRow,
      err,
      h('div', { class: 'row' }, add, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'))));
  dlg.showModal();
  path.focus();
}
