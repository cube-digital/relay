// HQ's routines backend: the data the page reads and the intents it posts. Routines only
// propose; Codex registrations are the only thing HQ writes, and only after a preview.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { codexInstalled } from '../routines/codex.mjs';
import { claudeCommand, disableInstance, enableInstance, shq } from '../routines/enable.mjs';
import { instanceView } from '../routines/info.mjs';
import { DAYS, describeSchedule, weekSlots, weekStart } from '../routines/schedule.mjs';
import { getInstance, acquireLock, listInstances, listReports, listRuns, readState, routineError, writeState } from '../routines/store.mjs';
import { loadTemplates } from '../routines/templates.mjs';
import { listRepos, readRegistry } from './registry.mjs';
import { ridOf } from './repo.mjs';

const SUGGESTION_RE = /^[-*]\s*([a-z0-9][a-z0-9-]*)\s*·\s*(passive|active)\s*·\s*([a-z,]+)\s+(\d{2}:\d{2})\s*·\s*(.+?)(?:\s*·\s*replaces\s+(.+))?\s*$/i;
const MAX_REPORT = 200_000;
const DAY_MS = 86_400_000;

export function routinesOverview({ now = new Date() } = {}) {
  const reg = readRegistry();
  const templates = loadTemplates().templates;
  const start = weekStart(now);
  const instances = listInstances().map((inst) => {
    const view = instanceView(inst, { now, templates, reg });
    const project = inst.scope?.project ? reg.projects.find((p) => p.id === inst.scope.project) : undefined;
    return {
      ...view,
      project: project ? { id: project.id, name: project.name } : null,
      slots: weekSlots(inst.schedule, now).map((d) => d.toISOString()),
      runs: listRuns(inst.id, { limit: 100 }).filter((r) => Date.parse(r.startedAt) >= start.getTime()).map((r) => ({ at: r.startedAt, outcome: r.outcome })),
      pendingCommand: inst.harness === 'claude' && inst.registration?.state === 'pending' ? claudeCommand(inst.routine, inst.scope, inst.schedule) : null,
    };
  });
  return {
    now: now.toISOString(),
    week: { start: start.toISOString(), days: DAYS.map((_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).toISOString()) },
    instances,
    templates: templates.map((t) => ({ id: t.id, title: t.title, kind: t.kind, type: t.type, check: t.type === 'prompt' ? null : t.check ?? null, schedule: t.schedule, scheduleText: describeSchedule(t.schedule), judgment: Boolean(t.judgment), custom: Boolean(t.custom) })),
    scopes: {
      projects: reg.projects.map((p) => ({ id: p.id, name: p.name })),
      repos: listRepos(reg).filter((r) => !r.hidden).map((r) => ({ rid: ridOf(r.path), name: r.path.split(/[\\/]/).pop() })),
    },
    codex: { installed: codexInstalled() },
  };
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8').slice(0, MAX_REPORT);
  } catch {
    return '';
  }
}

function suggestionsFrom(text) {
  const section = /^## Suggested routines\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? '';
  const out = [];
  for (const line of section.split('\n')) {
    const m = SUGGESTION_RE.exec(line.trim());
    if (!m) continue;
    const [, id, kind, days, at, what, replaces] = m;
    out.push({ id, kind: kind.toLowerCase(), days, at, what, replaces: replaces ?? null, command: `relay routine new ${id} --kind ${kind.toLowerCase()} --days ${days} --at ${at} --prompt ${shq(what)}` });
    if (out.length === 3) break;
  }
  return out;
}

export function routineDetail(id, { now = new Date() } = {}) {
  const inst = getInstance(id);
  if (!inst) throw routineError(`unknown routine instance: ${id}`, { status: 404 });
  const { state } = readState(id);
  const findings = (state.current ?? []).map((f) => {
    const firstSeenAt = state.seen?.[f.id] ?? null;
    return { ...f, firstSeenAt, isNew: firstSeenAt !== null && firstSeenAt === state.lastRunAt, dismissed: Object.hasOwn(state.dismissed ?? {}, f.id) };
  }).sort((a, b) => (b.isNew - a.isNew) || String(b.firstSeenAt ?? '').localeCompare(String(a.firstSeenAt ?? '')));
  const reports = listReports(id, { limit: 10 }).map((r) => ({ ...r, text: readText(r.path) }));
  return {
    instance: instanceView(inst, { now }),
    findings,
    runs: listRuns(id, { limit: 50 }).map(({ file, ...r }) => r),
    reports,
    suggestions: inst.routine === 'weekly-report' && reports[0] ? suggestionsFrom(reports[0].text) : [],
  };
}

export function dismissFinding(id, findingId, { now = new Date() } = {}) {
  if (typeof findingId !== 'string') throw routineError('finding must be a string', { status: 400 });
  if (!getInstance(id)) throw routineError(`unknown routine instance: ${id}`, { status: 404 });
  const release = acquireLock(id);
  if (!release) throw routineError('a run is going; try again', { status: 409 });
  try {
    const { state } = readState(id);
    if (!(state.current ?? []).some((f) => f.id === findingId)) throw routineError('unknown finding', { status: 404 });
    state.dismissed = { ...state.dismissed, [findingId]: now.toISOString() };
    writeState(id, state);
  } finally {
    release();
  }
  return { ok: true };
}

// Reads only the named fields of an HQ body.
function enableArgs(body) {
  const { routine, harness, scope, project, rid, days, at } = body ?? {};
  if (harness !== 'claude' && harness !== 'codex') throw routineError('choose a harness', { status: 400 });
  const flags = {};
  if (scope === 'project') flags.project = project;
  else if (scope === 'repo') {
    const found = listRepos(readRegistry()).find((r) => typeof rid === 'string' && ridOf(r.path) === rid);
    if (!found) throw routineError('unknown repository', { status: 400 });
    flags.repo = found.path;
  } else if (scope === 'all') flags.all = true;
  if (days !== undefined && !(Array.isArray(days) && days.every((d) => DAYS.includes(d)))) throw routineError('days must be a list of mon…sun', { status: 400 });
  return { routine, harness, flags, days, at: typeof at === 'string' ? at : undefined };
}

const withStatus = (err) => (Number.isInteger(err.status) ? err : Object.assign(err, { status: 400 }));
const tilde = (p) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

export function previewEnable(body) {
  try {
    const a = enableArgs(body);
    const r = enableInstance({ ...a, write: false });
    const command = claudeCommand(a.routine, r.instance.scope, r.instance.schedule);
    return {
      instance: r.instance.id,
      codex: r.automation ? { path: tilde(r.file), model: r.automation.model, effort: r.automation.effort, rrule: r.automation.rrule, cwds: r.automation.cwds } : null,
      claude: r.proposal ? { command } : null,
      errors: [],
    };
  } catch (err) {
    return { instance: null, codex: null, claude: null, errors: [err.message] };
  }
}

export function enableFromHq(body) {
  try {
    if (body?.confirm !== true) throw routineError('confirm the preview first', { status: 400 });
    const a = enableArgs(body);
    if (a.harness !== 'codex') {
      const r = enableInstance({ ...a, write: false });
      throw routineError(`Claude routines are created from a Claude desktop session: ${claudeCommand(a.routine, r.instance.scope, r.instance.schedule)}`, { status: 400 });
    }
    return { ok: true, instance: enableInstance({ ...a, write: true }).instance.id };
  } catch (err) {
    throw withStatus(err);
  }
}

export function disableFromHq(id) {
  const inst = getInstance(id);
  if (!inst) throw routineError(`unknown routine instance: ${id}`, { status: 404 });
  if (inst.harness !== 'codex') throw routineError(`run /relay:routine disable ${id} in the Claude desktop app`, { status: 400 });
  return { ok: true, removed: disableInstance(id).removed };
}

export function routineAttention() {
  const templates = loadTemplates().templates;
  const reg = readRegistry();
  const items = [];
  for (const inst of listInstances()) {
    const template = templates.find((t) => t.id === inst.routine);
    if (inst.registration?.state === 'disabled' || template?.kind !== 'passive') continue;
    const { state } = readState(inst.id);
    for (const f of state.current ?? []) {
      if (Object.hasOwn(state.dismissed ?? {}, f.id)) continue;
      items.push({
        id: `routine:${inst.id}:${f.id}`,
        kind: 'routine',
        label: template.title,
        rid: f.repo ? ridOf(f.repo) : null,
        repoName: f.repoName ?? instanceView(inst, { reg }).scopeLabel,
        plan: null,
        lane: null,
        text: f.text,
        at: state.seen?.[f.id] ?? null,
        href: `#/routines/${inst.id}`,
      });
    }
  }
  return items;
}

export function routineEvents({ now = new Date() } = {}) {
  const templates = loadTemplates().templates;
  const since = now.getTime() - 14 * DAY_MS;
  const events = [];
  for (const inst of listInstances()) {
    const title = templates.find((t) => t.id === inst.routine)?.title ?? inst.routine;
    for (const r of listRuns(inst.id, { limit: 100 })) {
      if (!(Date.parse(r.startedAt) >= since)) continue;
      const summary = r.outcome === 'new' ? `${r.new?.length ?? 0} new` : r.outcome === 'nothing-new' ? 'nothing new' : r.outcome === 'skipped' ? `skipped (${r.skipped})` : r.outcome === 'failed' ? `failed: ${r.error ?? 'unknown'}` : 'report';
      events.push({ at: r.startedAt, kind: 'routine', rid: null, repoName: `routine ${inst.id}`, plan: null, text: `${title}: ${summary}`, href: `#/routines/${inst.id}` });
    }
  }
  return events;
}
