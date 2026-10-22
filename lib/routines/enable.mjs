// relay routine enable | confirm | disable | refresh: an instance on the harness the
// user chose. Codex: relay writes ~/.codex/automations/relay-<slug>/. Claude: a pending
// instance and a proposal that /relay:routine creates in the desktop app.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { readRegistry } from '../hq/registry.mjs';
import { loadRouting, modelFor, RELAY_ROOT } from '../routing.mjs';
import { automationsDir, codexInstalled, folderFor, readAutomation, removeAutomation, writeAutomation } from './codex.mjs';
import { cronFor, parseDays, rruleFor, scheduleProblems } from './schedule.mjs';
import { instanceIdFor, reposInScope, scopeFrom, scopeLabel } from './scope.mjs';
import { getInstance, INSTANCE_RE, listInstances, routineError, updateEnabled } from './store.mjs';
import { findTemplate } from './templates.mjs';

export const HARNESSES = ['claude', 'codex'];
export const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const relayCli = () => join(RELAY_ROOT, 'bin', 'relay');
export const shq = (s) => (/^[\w@%+=:,./-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);

export function scheduledPrompt(cli, id) {
  return `Run \`node ${shq(cli)} routine run ${id}\` in a shell and reply with its output, unchanged. If the output ends with a "For you:" block, do what it asks and pipe your answer to \`node ${shq(cli)} routine note ${id}\`. Do nothing else.`;
}

export function claudeProposal(inst, template, reg = readRegistry()) {
  const label = scopeLabel(inst.scope, reg);
  return {
    taskId: folderFor(inst.id),
    title: `relay · ${template.title} · ${label}`,
    description: `${template.title} for ${label} (relay routine ${inst.id})`,
    cronExpression: cronFor(inst.schedule),
    prompt: scheduledPrompt(inst.relayCli, inst.id),
  };
}

export function codexAutomation(inst, template, reg = readRegistry(), { routing = loadRouting(), now = Date.now(), createdAt } = {}) {
  const { model, effort } = modelFor(routing, template.judgment?.tier ?? 'cheap', 'codex');
  const cwds = reposInScope(inst.scope, reg).repos.map((r) => r.path);
  return {
    id: folderFor(inst.id),
    name: `relay · ${template.title} · ${scopeLabel(inst.scope, reg)}`,
    prompt: scheduledPrompt(inst.relayCli, inst.id),
    rrule: rruleFor(inst.schedule),
    model,
    effort,
    cwds: cwds.length ? cwds : ['~'],
    createdAt: createdAt ?? now,
    updatedAt: now,
  };
}

// The /relay:routine command HQ shows for a Claude instance.
export function claudeCommand(routine, scope, schedule) {
  const flag = scope.project ? `--project ${scope.project}` : scope.repo ? `--repo ${shq(scope.repo)}` : '--all';
  return `/relay:routine enable ${routine} ${flag} --days ${schedule.days.join(',')} --at ${schedule.at}`;
}

// { instance, template, proposal?, automation?, file?, warnings, reprinted }; write: false is HQ's preview.
export function enableInstance({ routine, harness, flags = {}, days, at, write = true, now = new Date(), home = homedir() }) {
  if (!HARNESSES.includes(harness)) throw routineError('choose --harness claude or --harness codex', { code: 64 });
  if (typeof routine !== 'string' || !routine) throw routineError('usage: relay routine enable <routine> --harness claude|codex (--project <id> | --repo <path> | --all) [--days mon,…] [--at HH:MM]', { code: 64 });
  const template = findTemplate(routine);
  if (!template) throw routineError(`unknown routine: ${routine} (relay routine list)`);
  const reg = readRegistry();
  const scope = scopeFrom(flags, reg);
  const schedule = { days: days ?? template.schedule.days, at: at ?? template.schedule.at };
  const problems = scheduleProblems(schedule);
  if (problems.length) throw routineError(problems.join('; '), { code: 64 });
  if (harness === 'codex' && !codexInstalled(home)) throw routineError(`Codex is not installed here (${automationsDir(home)} is missing); nothing was written`, { status: 409 });
  const id = instanceIdFor(routine, scope);
  const existing = getInstance(id);
  const live = existing && existing.registration?.state !== 'disabled';
  const reprint = Boolean(live && existing.harness === 'claude' && harness === 'claude' && existing.registration.state === 'pending');
  if (live && !reprint) throw routineError(`already enabled: ${id} on ${existing.harness}; relay routine disable ${id} first`, { status: 409 });
  const inst = {
    id, routine, harness, scope, schedule, options: {}, relayCli: relayCli(),
    registration: harness === 'codex' ? { state: 'active', codexPath: `~/.codex/automations/${folderFor(id)}` } : { state: 'pending', taskId: null },
    enabledAt: reprint ? existing.enabledAt : now.toISOString(),
  };
  const out = { instance: inst, template, warnings: [], reprinted: reprint };
  if (harness === 'codex') {
    const prior = readAutomation(folderFor(id), home);
    out.automation = codexAutomation(inst, template, reg, { now: now.getTime(), createdAt: Number.isInteger(prior?.created_at) ? prior.created_at : undefined });
    out.file = join(automationsDir(home), folderFor(id), 'automation.toml');
    out.warnings.push(`Codex reads ~/.codex/automations itself; restart the Codex app if ${folderFor(id)} does not show up.`);
    if (write) writeAutomation(out.automation, home);
  } else {
    out.proposal = claudeProposal(inst, template, reg);
    out.warnings.push("Claude runs use the app's default model; a scheduled task cannot set one.", 'Claude runs only while the desktop app is open; a missed run starts at the next launch.');
  }
  if (write) updateEnabled((doc) => {
    doc.instances = doc.instances.filter((i) => i.id !== id);
    doc.instances.push(inst);
  });
  return out;
}

function existingInstance(id) {
  if (!INSTANCE_RE.test(String(id))) throw routineError(`bad instance id: ${id}`, { code: 64 });
  const inst = getInstance(id);
  if (!inst) throw routineError(`unknown instance: ${id} (relay routine list)`);
  return inst;
}

export function confirmInstance(id, taskId) {
  if (!INSTANCE_RE.test(String(id)) || !TASK_ID_RE.test(String(taskId))) throw routineError('usage: relay routine confirm <instance> --task-id <id>', { code: 64 });
  const inst = existingInstance(id);
  if (inst.harness !== 'claude' || inst.registration?.state === 'disabled') throw routineError(`${id} is not a live Claude instance`);
  return updateEnabled((doc) => {
    const cur = doc.instances.find((i) => i.id === id);
    cur.registration = { state: 'active', taskId };
    cur.relayCli = relayCli();
    return cur;
  });
}

export function disableInstance(id, { home = homedir(), now = new Date() } = {}) {
  const inst = existingInstance(id);
  if (inst.registration?.state === 'disabled') return { instance: inst, already: true, removed: null };
  const removed = inst.harness === 'codex' ? removeAutomation(basename(inst.registration?.codexPath || folderFor(id)), home) : null;
  const instance = updateEnabled((doc) => {
    const cur = doc.instances.find((i) => i.id === id);
    cur.registration = { ...cur.registration, state: 'disabled', disabledAt: now.toISOString() };
    return cur;
  });
  return { instance, already: false, removed };
}

export function refreshInstances({ home = homedir(), now = new Date() } = {}) {
  const out = { codex: [], claude: [], errors: [] };
  const reg = readRegistry();
  for (const inst of listInstances()) {
    if (inst.registration?.state === 'disabled' || existsSync(inst.relayCli)) continue;
    if (inst.harness === 'codex') {
      const template = findTemplate(inst.routine);
      if (!template) continue;
      try {
        const prior = readAutomation(folderFor(inst.id), home);
        writeAutomation(codexAutomation({ ...inst, relayCli: relayCli() }, template, reg, { now: now.getTime(), createdAt: prior?.created_at }), home);
        updateEnabled((doc) => {
          doc.instances.find((i) => i.id === inst.id).relayCli = relayCli();
        });
        out.codex.push(inst.id);
      } catch (err) {
        out.errors.push({ instance: inst.id, error: err.message });
      }
    } else {
      if (inst.registration?.taskId == null) continue; // still pending: nothing to update yet
      out.claude.push({ instance: inst.id, taskId: inst.registration?.taskId ?? null, prompt: scheduledPrompt(relayCli(), inst.id) });
    }
  }
  return out;
}

const emit = (args, obj, lines) => {
  console.log(args.json ? JSON.stringify(obj) : lines.join('\n'));
  return 0;
};

export function enable(args) {
  const r = enableInstance({
    routine: args._[0],
    harness: typeof args.harness === 'string' ? args.harness : undefined,
    flags: { project: args.project, repo: args.repo, all: args.all === true ? true : undefined },
    days: args.days ? parseDays(args.days) : undefined,
    at: typeof args.at === 'string' ? args.at : undefined,
  });
  const id = r.instance.id;
  const notes = r.warnings.map((w) => `note: ${w}`);
  if (r.automation) {
    const a = r.automation;
    return emit(args, r, [`✓ enabled ${id} on Codex: ${r.file}`, `  ${a.rrule} · ${a.model} · effort ${a.effort}`, `  cwds: ${a.cwds.join(', ')}`, ...notes]);
  }
  return emit(args, r, [`pending: ${id} on Claude`, `RELAY_PROPOSAL: ${JSON.stringify(r.proposal)}`, ...notes, `next: create the scheduled task from the proposal, then: relay routine confirm ${id} --task-id ${r.proposal.taskId}`]);
}

export function confirm(args) {
  const taskId = typeof args['task-id'] === 'string' ? args['task-id'] : undefined;
  const inst = confirmInstance(args._[0], taskId);
  return emit(args, { instance: inst }, [`✓ ${inst.id} is active on Claude (task ${taskId})`]);
}

export function disable(args) {
  const r = disableInstance(args._[0]);
  const id = r.instance.id;
  const lines = r.already ? [`${id} is already disabled`] : [`✓ disabled ${id}`];
  if (!r.already) {
    if (r.instance.harness === 'codex') {
      if (r.removed) lines.push(`  removed ${r.removed}`);
    } else {
      lines.push(`next: disable the scheduled task ${r.instance.registration?.taskId ?? ''} in the Claude app (/relay:routine disable ${id})`);
    }
  }
  return emit(args, r, lines);
}

export function refresh(args) {
  const r = refreshInstances();
  const lines = [
    ...r.codex.map((id) => `✓ rewrote ${id}`),
    ...r.errors.map((e) => `! ${e.instance}: ${e.error}`),
    ...r.claude.map((c) => `RELAY_UPDATE: ${JSON.stringify(c)}`),
  ];
  if (r.claude.length) lines.push('next: in a Claude desktop session run /relay:routine refresh');
  if (!lines.length) lines.push('✓ no stale registrations');
  return emit(args, r, lines);
}
