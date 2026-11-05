// Setup > Repositories: every registered repository as a card, grouped by project,
// hidden ones last. Everything from the API goes in as text.

import { api, empty, errorBox, fill, githubOf, h, light, link, plural, tag, tilde } from './dom.js';
import { openAddDialog } from './add-dialog.js';
import { openLaunchDialog } from './launch-dialog.js';
import { openNameDialog } from './name-dialog.js';

const UNASSIGNED = '_unassigned';

const btn = (label, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, label);

async function post(path, body) {
  try {
    return await api(path, { method: 'POST', body });
  } catch (err) {
    alert(err.message);
    throw err;
  }
}

function githubBlock(rid) {
  const box = h('div', { class: 'stack' }, h('span', { class: 'muted' }, 'GitHub…'));
  githubOf(rid).then((g) => {
    if (!g.connected) return fill(box, h('span', { class: 'muted' }, `GitHub not connected: ${g.reason ?? 'unknown'}`));
    const ci = { pass: 'green', fail: 'red', pending: 'yellow', none: 'grey' };
    fill(box, ...(g.prs?.length ? g.prs.map((p) => h('div', { class: 'row' }, light(ci[p.ci] ?? 'grey', p.ci ?? 'none'), link(p.url, `#${p.number} ${p.title}`), h('span', { class: 'muted' }, `${p.draft ? 'draft · ' : ''}${p.review ?? ''}`))) : [h('span', { class: 'muted' }, 'No open PRs')]));
  });
  return box;
}

function moveSelect(repo, projects, projectId, ctx) {
  const sel = h('select', { 'aria-label': `Project of ${repo.name}` },
    h('option', { value: '' }, 'No project'),
    projects.map((p) => h('option', { value: p.id }, p.name)),
    h('option', { value: '__new' }, 'New project…'));
  sel.value = projectId === UNASSIGNED ? '' : projectId;
  sel.addEventListener('change', async () => {
    if (sel.value === '__new') {
      return openNameDialog({
        title: `Move ${repo.name} to a new project`,
        label: 'Project name',
        action: 'Create and move',
        onSubmit: async (name) => {
          const { id } = await api('/api/registry', { method: 'POST', body: { op: 'create-project', name } });
          await api('/api/registry', { method: 'POST', body: { op: 'assign', rid: repo.rid, project: id } });
        },
        onClose: () => ctx.refresh(),
      });
    }
    try {
      await post('/api/registry', { op: 'assign', rid: repo.rid, project: sel.value || null });
    } catch { /* alerted */ }
    ctx.refresh();
  });
  return sel;
}

function repoCard(repo, data, ctx) {
  const g = repo.git ?? {};
  const registry = (body) => post('/api/registry', body).then(() => ctx.refresh()).catch(() => {});
  const head = repo.missing
    ? h('div', { class: 'row' }, h('span', { class: 'error' }, 'missing on disk'), btn('Remove from HQ', () => confirm(`Remove ${repo.name} from HQ?`) && registry({ op: 'remove', rid: repo.rid }), 'btn danger'))
    : h('div', { class: 'row' },
      h('span', { class: 'chip' }, g.branch ?? '?'),
      h('span', { class: 'muted' }, `${g.dirty ?? 0} uncommitted`),
      h('span', { class: 'muted' }, `↑${g.ahead ?? 0} ↓${g.behind ?? 0}`),
      h('span', { class: 'muted' }, plural(repo.worktrees?.length ?? 0, 'lane worktree', 'lane worktrees')),
      h('span', { class: 'muted' }, plural(repo.plans?.length ?? 0, 'plan', 'plans')));
  return h('div', { class: 'card stack repo' },
    h('div', { class: 'row between' }, h('div', {}, h('h3', {}, repo.name ?? tilde(repo.path)), h('span', { class: 'muted' }, tilde(repo.path))), repo.hidden ? tag('hidden') : null),
    head,
    repo.error ? errorBox(new Error(repo.error)) : null,
    repo.missing ? null : h('div', { class: 'row' },
      btn('+ New plan', () => openLaunchDialog({ action: 'plan', rid: repo.rid }), 'btn ac'),
      repo.codexSetup ? null : btn('Set up Codex', () => openLaunchDialog({ action: 'setup-codex', rid: repo.rid }))),
    h('div', { class: 'row' },
      h('label', { class: 'inline' }, 'Project ', moveSelect(repo, data.projects ?? [], data.project.id, ctx)),
      btn(repo.hidden ? 'Unhide' : 'Hide', () => registry({ op: repo.hidden ? 'unhide' : 'hide', rid: repo.rid })),
      repo.missing ? null : btn('Remove from HQ', () => confirm(`Remove ${repo.name} from HQ? Nothing on disk changes.`) && registry({ op: 'remove', rid: repo.rid }), 'btn danger')),
    repo.missing ? null : githubBlock(repo.rid));
}

export async function renderRepos(body, ctx) {
  try {
    const { projects = [] } = await api('/api/sidebar');
    const ids = projects.map((p) => p.id);
    if (!ids.includes(UNASSIGNED)) ids.push(UNASSIGNED);
    const results = await Promise.all(ids.map((id) => api(`/api/projects/${encodeURIComponent(id)}`).catch((err) => {
      if (err.status === 401) throw err;
      return null;
    })));
    const datas = results.filter(Boolean);
    const real = (datas[0]?.projects ?? []).filter((p) => p.id !== UNASSIGNED);
    const add = btn('Add repository', () => openAddDialog({ projects: real, onDone: () => ctx.refresh() }), 'btn ac');
    const create = btn('New project', () => openNameDialog({
      title: 'New project',
      label: 'Project name',
      action: 'Create',
      onSubmit: async (name) => {
        await api('/api/registry', { method: 'POST', body: { op: 'create-project', name } });
        ctx.refresh();
      },
    }));
    // Every real project shows, an empty one with its own Add repository; Unassigned only when it has some.
    const groups = datas.map((d) => ({ name: d.project.name, data: d, repos: d.repos.filter((r) => !r.hidden) })).filter((g) => g.repos.length || g.data.project.id !== UNASSIGNED);
    const addTo = (id) => btn('Add repository', () => openAddDialog({ projects: real, selected: id, onDone: () => ctx.refresh() }));
    const hidden = datas.flatMap((d) => d.repos.filter((r) => r.hidden).map((r) => ({ r, d })));
    fill(body,
      h('div', { class: 'row' }, add, create),
      groups.length ? groups.map((g) => h('section', { class: 'stack' }, h('h2', {}, g.name, h('span', { class: 'n' }, String(g.repos.length))),
        g.repos.length
          ? h('div', { class: 'grid rgrid' }, g.repos.map((r) => repoCard(r, g.data, ctx)))
          : h('div', { class: 'row' }, empty('No repositories.'), addTo(g.data.project.id)))) : (hidden.length ? null : empty('No repositories.')),
      hidden.length ? h('section', { class: 'stack' }, h('h2', {}, 'Hidden', h('span', { class: 'n' }, String(hidden.length))),
        h('div', { class: 'grid rgrid' }, hidden.map(({ r, d }) => repoCard(r, d, ctx)))) : null);
  } catch (err) {
    if (err.status === 401) throw err;
    fill(body, errorBox(err));
  }
  return { poll: false };
}
