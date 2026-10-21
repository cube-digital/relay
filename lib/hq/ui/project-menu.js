// The ⋯ menu of a project: Rename, Add repository, Delete project… (confirmed in the shared dialog).
// All text, no HTML.

import { api, h } from './dom.js';
import { openAddDialog } from './add-dialog.js';

function confirmDelete(project, repoCount, onDeleted) {
  const dlg = document.getElementById('launch');
  const err = h('div', { class: 'stack' });
  const del = h('button', { class: 'btn danger', type: 'button', onclick: async () => {
    del.disabled = true;
    try {
      await api('/api/registry', { method: 'POST', body: { op: 'delete-project', id: project.id } });
      dlg.close();
      onDeleted();
    } catch (e) {
      err.replaceChildren(h('p', { class: 'error', role: 'alert' }, e.message));
      del.disabled = false;
    }
  } }, 'Delete project');
  dlg.replaceChildren(
    h('h2', {}, `Delete “${project.name}”?`),
    h('p', {}, `Its ${repoCount} ${repoCount === 1 ? 'repository moves' : 'repositories move'} to Unassigned. Nothing on disk changes.`),
    err,
    h('div', { class: 'row' }, del, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
  dlg.showModal();
  del.focus();
}

// project: { id, name }; projects: all real projects (for the add dialog);
// onChange refreshes the view; onDeleted runs after a delete.
export function projectMenu({ project, repoCount, projects, onChange, onDeleted }) {
  const menu = h('details', { class: 'menu' });
  const item = (label, fn) => h('button', { type: 'button', class: 'menu-item', onclick: () => { menu.open = false; fn(); } }, label);
  menu.append(
    h('summary', { 'aria-label': `Actions for ${project.name}` }, '⋯'),
    h('div', { class: 'menu-list' },
      item('Rename', async () => {
        const name = prompt('Rename project', project.name);
        if (!name) return;
        try {
          await api('/api/registry', { method: 'POST', body: { op: 'rename-project', id: project.id, name } });
          onChange();
        } catch (e) { alert(e.message); }
      }),
      item('Add repository', () => openAddDialog({ projects, selected: project.id, onDone: onChange })),
      item('Delete project…', () => confirmDelete(project, repoCount, onDeleted))));
  return menu;
}
