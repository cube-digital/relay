// All and a project page: Needs you, Running, Ready to merge, Finished and Activity from
// /api/overview. Text only, no HTML.

import { activityGroups } from './activity.js';
import { ago, api, copyButton, duration, empty, errorBox, fill, h, link, mascot, useStyle } from './dom.js';
import { openMergeDialog, openPrDialog } from './merge-dialog.js';
import { projectMenu } from './project-menu.js';

useStyle('/overview.css');

const UNASSIGNED = '_unassigned';
const enc = encodeURIComponent;
const btn = (label, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, label);
const hhmm = (iso) => (Number.isFinite(Date.parse(iso ?? '')) ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const heading = (label, n) => h('h2', {}, label, ' ', h('span', { class: 'c' }, String(n)));
const launchHash = (res) => `#/launches/${enc(res.id ?? res.launch?.id ?? '')}`;
const left = (min) => (min >= 60 ? `~${Math.floor(min / 60)}h ${Math.round(min % 60)}m left` : `~${Math.round(min)}m left`);

// A button that runs fn and shows a refusal inline beside it.
function action(label, fn, cls = 'btn') {
  const err = h('span', { class: 'ov-err', role: 'alert' });
  const b = btn(label, async () => {
    b.disabled = true;
    fill(err);
    try {
      await fn();
    } catch (e) {
      fill(err, e.message);
      b.disabled = false;
    }
  }, cls);
  return [b, err];
}

function needRow(n, ctx, onAll) {
  const post = (path, body) => api(path, { method: 'POST', body });
  const acts = [];
  let extra = null;
  if (n.kind === 'lane-blocked' || n.kind === 'marathon-blocked') {
    acts.push(link(n.href, 'Open run'));
    const input = h('input', { type: 'text', maxlength: '4000', 'aria-label': `Answer for ${n.plan}`, placeholder: 'Answer' });
    const [go, err] = action('Answer and resume', async () => {
      const text = input.value.trim();
      if (!text) throw new Error('Write an answer first');
      ctx.navigate(launchHash(await post('/api/plans/answer', { rid: n.rid, slug: n.plan, text })));
    }, 'btn p');
    extra = h('div', { class: 'ov-answer' }, input, go, err);
  } else if (n.kind === 'run-paused') {
    acts.push(btn('Resume', () => ctx.openLaunch({ action: 'run', rid: n.rid, plan: n.file }), 'btn p'));
    if (n.resetsAt) acts.push(h('span', { class: 'ov-small' }, `resets ${hhmm(n.resetsAt)}`));
    acts.push(btn('Marathon', () => ctx.openLaunch({ action: 'marathon', rid: n.rid, plan: n.file, hours: 8 })));
  } else if (['suite-failed', 'launch-failed', 'launch-lost'].includes(n.kind)) {
    acts.push(link(n.launch ? `#/launches/${enc(n.launch.id)}` : n.href, 'Log'));
    if (n.launch?.retryable) acts.push(action('Retry', async () => ctx.navigate(launchHash(await post(`/api/launches/${enc(n.launch.id)}/retry`, {}))), 'btn p'));
  } else if (n.kind === 'routine') {
    acts.push(link(n.href, 'Open'));
    acts.push(action('Dismiss', async () => { await post(`/api/routines/${enc(n.instance)}/dismiss`, { finding: n.finding }); await ctx.refresh(); }));
  } else if (n.kind === 'setup') {
    if (n.copy) acts.push(copyButton('Copy command', n.copy));
    acts.push(link(n.href, 'Open Setup'));
  }
  return h('div', { class: 'ov-need' },
    h('span', { class: n.kind === 'setup' ? 'ov-dot y' : 'ov-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'ov-proj' }, onAll ? (n.kind === 'setup' ? 'setup' : n.projectName ?? '') : ''),
    h('span', { class: 'ov-what' }, h('b', {}, n.text ?? ''), n.detail ? h('div', { class: 'ov-small' }, n.detail) : null),
    h('span', { class: 'ov-acts' }, acts),
    extra);
}

function planCard(c, onAll) {
  const lanes = c.lanes ?? [];
  const startedMs = Date.parse(c.startedAt ?? '');
  const elapsed = Number.isFinite(startedMs) ? duration(Date.now() - startedMs) : '';
  const timing = [elapsed, Number.isFinite(c.leftMin) ? left(c.leftMin) : ''].filter(Boolean).join(' · ');
  const fillBar = h('span');
  fillBar.style.width = `${c.total ? Math.round((100 * (c.done ?? 0)) / c.total) : 0}%`;
  return h('div', { class: 'ov-card' },
    h('a', { class: 'ov-h', href: c.href },
      h('b', {}, [onAll ? c.projectName : null, c.repoName, c.slug].filter(Boolean).join(' · ')),
      c.flow ? h('span', { class: 'tag' }, c.flow) : null,
      timing ? h('span', { class: 'ov-r' }, timing) : null),
    h('div', { class: 'ov-bar' }, fillBar),
    h('div', { class: 'ov-small' }, `wave ${c.wave ?? '?'}/${c.waves ?? '?'} · ${c.done ?? 0} of ${c.total ?? 0} tasks`),
    lanes.map((l) => {
      const blocked = l.status === 'blocked';
      const what = l.fix ? `fix round ${l.fix}` : l.task ? `${l.task.id} · ${l.task.title}` : l.title ?? '';
      return h('div', { class: blocked ? 'ov-lane red' : 'ov-lane' },
        h('span', { class: 'ov-id' }, `lane ${l.lane}`),
        mascot(l.kind, l.status === 'working', l.title, l.hex),
        h('span', { class: 'ov-t' }, what),
        h('span', { class: blocked ? 'tag red' : l.status === 'working' ? 'tag ac' : 'tag' }, l.status ?? ''));
    }));
}

function launchCard(c, ctx, onAll) {
  const [stop, err] = action('Stop', async () => { await api(`/api/launches/${enc(c.id)}/stop`, { method: 'POST', body: {} }); await ctx.refresh(); }, 'btn d');
  return h('div', { class: 'ov-card' },
    h('div', { class: 'ov-h' }, h('b', {}, [onAll ? c.projectName : null, c.repoName].filter(Boolean).join(' · ')), h('span', { class: 'tag' }, c.action), h('span', { class: 'ov-r' }, `started ${ago(c.startedAt)}`)),
    h('div', { class: 'ov-cardacts' }, link(`#/launches/${enc(c.id)}`, 'Log'), stop, err));
}

function readyCard(c, ctx) {
  const stat = (v, label) => h('span', {}, h('b', {}, v), label);
  const t = c.tests;
  const done = () => ctx.refresh();
  const [merged, err] = action('Mark merged', async () => { await api('/api/plans/merged', { method: 'POST', body: { rid: c.rid, slug: c.slug } }); await ctx.refresh(); });
  return h('div', { class: 'ov-card' },
    h('div', { class: 'ov-h' }, h('b', {}, [c.repoName, c.slug].join(' · ')), c.at ? h('span', { class: 'ov-r' }, ago(c.at)) : null),
    c.title ? h('div', { class: 'ov-small' }, c.title) : null,
    h('div', { class: 'ov-small' }, `${c.branch} → ${c.into}`),
    h('div', { class: 'ov-stats' },
      stat(t ? `+${t.added ?? 0}` : '?', 'tests'), stat(t ? `−${t.removed ?? 0}` : '?', 'tests'),
      stat(String(c.rulings ?? 0), 'rulings'), stat(String(c.openFindings ?? 0), 'open findings'),
      stat(c.suite === true || c.suite === 'pass' ? '✓' : c.suite == null ? '?' : '✗', 'suite')),
    h('div', { class: 'ov-cardacts' },
      btn('Review', () => ctx.navigate(c.href)),
      btn('Open PR', () => openPrDialog({ rid: c.rid, slug: c.slug }, { onDone: done }), 'btn p'),
      btn('Merge locally', () => openMergeDialog({ rid: c.rid, slug: c.slug }, { onDone: done })),
      merged, err));
}

export async function renderOverview(main, { project = 'all' }, ctx) {
  let data;
  let side = null;
  try {
    [data, side] = await Promise.all([api(`/api/overview?project=${enc(project)}`), ctx.sidebar().catch(() => null)]);
  } catch (err) {
    if (err.status === 401) throw err;
    ctx.crumbs([['All', '#/'], [project]]);
    fill(main, errorBox(err));
    return { poll: false };
  }
  const onAll = data.project.id === 'all';
  const repos = data.project.repos ?? [];
  ctx.crumbs(onAll ? [['All']] : [['All', '#/'], [data.project.name]]);
  const { needs = [], running = [], ready = [], finished = [], activity = [] } = data;
  const dialogOpts = onAll ? {} : { repos };
  const intent = (a) => (!onAll && repos.length === 1 ? { action: a, rid: repos[0].rid } : { action: a });
  const real = !onAll && data.project.id !== UNASSIGNED;
  const meta = onAll
    ? `${(side?.projects ?? []).length} projects · ${running.length} running`
    : repos.map((r) => r.name).join(' · ');
  const projectOf = (e) => ctx.projectOf?.(e.rid)?.id ?? UNASSIGNED;

  fill(main, h('div', { class: 'ov' },
    h('div', { class: 'ov-top' },
      h('h1', {}, data.project.name),
      h('span', { class: 'ov-meta' }, meta),
      h('span', { class: 'ov-topacts' },
        btn('Run skill', () => ctx.openLaunch(intent('skill'), dialogOpts)),
        btn('Run plan', () => ctx.openLaunch(intent('run'), dialogOpts)),
        btn('+ New plan', () => ctx.openLaunch(intent('plan'), dialogOpts), 'btn p'),
        real ? projectMenu({
          project: { id: data.project.id, name: data.project.name },
          repoCount: repos.length,
          projects: (side?.projects ?? []).filter((p) => p.id !== UNASSIGNED).map((p) => ({ id: p.id, name: p.name })),
          onChange: () => ctx.refresh(),
          onDeleted: () => ctx.navigate('#/'),
        }) : null)),

    heading('Needs you', needs.length),
    needs.length ? h('div', { class: 'ov-needs' }, needs.map((n) => needRow(n, ctx, onAll))) : empty('Nothing needs you.'),

    heading('Running', running.length),
    running.length ? h('div', { class: 'ov-cards' }, running.map((c) => (c.type === 'launch' ? launchCard(c, ctx, onAll) : planCard(c, onAll)))) : empty('Nothing is running.'),

    heading('Ready to merge', ready.length),
    ready.length ? h('div', { class: 'ov-cards' }, ready.map((c) => readyCard(c, ctx))) : empty('Nothing to merge.'),

    h('details', { class: 'ov-details' },
      h('summary', {}, `Finished · ${finished.length}`),
      finished.length
        ? h('div', { class: 'ov-finished' }, finished.map((f) => link(f.href, `${f.repoName} · ${f.slug} · ${ago(f.at)}`)))
        : empty('Nothing finished yet.')),
    h('details', { class: 'ov-details' },
      h('summary', {}, 'Activity'),
      activityGroups(activity, projectOf, empty))));
  return { poll: true };
}
