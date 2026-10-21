// relay routine list | show | history: read-only views of templates, instances and runs,
// plus instanceView, the one InstanceView shape the CLI and HQ share.

import { existsSync } from 'node:fs';
import { readRegistry } from '../hq/registry.mjs';
import { isoWeek, describeSchedule, nextRun } from './schedule.mjs';
import { scopeLabel } from './scope.mjs';
import { getInstance, latestRun, listInstances, listReports, listRuns, readState, routineError } from './store.mjs';
import { DEFAULT_CAP, loadTemplates } from './templates.mjs';

export function instanceView(inst, { now = new Date(), templates = loadTemplates().templates, reg = readRegistry() } = {}) {
  const template = templates.find((t) => t.id === inst.routine);
  const { state } = readState(inst.id);
  const run = latestRun(inst.id);
  const registration = inst.registration ?? {};
  const active = registration.state === 'active';
  const next = active ? nextRun(inst.schedule, now) : null;
  return {
    id: inst.id,
    routine: inst.routine,
    title: template?.title ?? inst.routine,
    kind: template?.kind ?? null,
    type: template?.type ?? null,
    harness: inst.harness,
    state: registration.state,
    scope: inst.scope,
    scopeLabel: scopeLabel(inst.scope, reg),
    schedule: inst.schedule,
    scheduleText: describeSchedule(inst.schedule),
    nextRun: next ? next.toISOString() : null,
    stalePath: !existsSync(inst.relayCli),
    cap: template?.cap?.runsPerWeek ?? DEFAULT_CAP,
    weekRuns: state.weekRuns?.week === isoWeek(now) ? state.weekRuns.count : 0,
    lastRun: run ? { startedAt: run.startedAt, outcome: run.outcome, new: run.new?.length ?? 0, skipped: run.skipped ?? null } : null,
    open: (state.current ?? []).filter((f) => !(f.id in (state.dismissed ?? {}))),
    codexPath: registration.codexPath ?? null,
    taskId: registration.taskId ?? null,
    appOpen: inst.harness === 'claude',
  };
}

const pad = (n) => String(n).padStart(2, '0');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const when = (iso) => { const d = new Date(iso); return `${DOW[d.getDay()]} ${pad(d.getDate())} ${MON[d.getMonth()]} ${hhmm(d)}`; };
const ymdHm = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm(d)}`; };
const findingLine = (f) => `- ${f.text}${f.href ? ` · ${f.href}` : ''}${f.command ? ` · ${f.command}` : ''}`;

export function list(args) {
  const { templates } = loadTemplates();
  const views = listInstances().map((i) => instanceView(i, { templates }));
  if (args.json) {
    console.log(JSON.stringify({ templates, instances: views }, null, 2));
    return 0;
  }
  console.log('templates:');
  for (const t of templates) console.log(`  ${t.id}  ${t.kind}  ${t.type}  ${describeSchedule(t.schedule)}  ${t.title}${t.custom ? '  (yours)' : ''}`);
  if (!views.length) {
    console.log('instances: none (relay routine enable <routine> --harness claude|codex …)');
    return 0;
  }
  console.log('instances:');
  for (const v of views) {
    console.log(`  ${v.id}  ${v.harness}  ${v.state}  ${v.scheduleText}  next ${v.nextRun ? when(v.nextRun) : '-'}  last ${v.lastRun?.outcome ?? '-'}  ${v.weekRuns}/${v.cap} this week${v.stalePath ? '  stale path' : ''}`);
  }
  return 0;
}

export function show(args) {
  const id = args._[0];
  if (!id) throw routineError('usage: relay routine show <routine|instance>', { code: 64 });
  const { templates } = loadTemplates();
  if (id.includes('@')) {
    const inst = getInstance(id);
    if (!inst) throw routineError(`unknown instance: ${id}`);
    const view = instanceView(inst, { templates });
    const template = templates.find((t) => t.id === inst.routine) ?? null;
    if (args.json) {
      console.log(JSON.stringify({ instance: view, template }, null, 2));
      return 0;
    }
    for (const [k, v] of Object.entries(view)) {
      if (k === 'open') continue;
      console.log(`${k}: ${v !== null && typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
    console.log('findings:');
    for (const f of readState(id).state.current ?? []) console.log(findingLine(f));
    const report = listReports(id, { limit: 1 })[0];
    if (report) console.log(`report: ${report.path}`);
    return 0;
  }
  const template = templates.find((t) => t.id === id);
  if (!template) throw routineError(`unknown routine: ${id}`);
  const instances = listInstances().filter((i) => i.routine === id).map((i) => i.id);
  if (args.json) {
    console.log(JSON.stringify({ template, instances }, null, 2));
    return 0;
  }
  console.log(JSON.stringify(template, null, 2));
  console.log(`instances: ${instances.length ? instances.join(' ') : 'none'}`);
  return 0;
}

export function history(args) {
  const id = args._[0];
  if (!id) throw routineError('usage: relay routine history <instance>', { code: 64 });
  const runs = listRuns(id, { limit: 20 });
  if (!runs.length) {
    console.log('no runs yet');
    return 0;
  }
  for (const r of runs) {
    console.log(`${ymdHm(r.startedAt)}  ${r.outcome}  ${(r.new ?? []).length} new  ${r.skipped ?? r.error ?? '-'}`);
    if (r.report) console.log(`  report ${r.report}`);
  }
  return 0;
}
