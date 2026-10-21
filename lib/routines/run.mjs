// relay routine run | note: one run of an instance. The lock, the weekly cap, the check
// (or a prompt routine's text), the diff against state.json, the run record, the report
// and the bounded "For you:" block for the one judgment step.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRegistry } from '../hq/registry.mjs';
import { RELAY_ROOT } from '../routing.mjs';
import { isoWeek, localDate } from './schedule.mjs';
import { reposInScope } from './scope.mjs';
import { acquireLock, getInstance, INSTANCE_RE, listRuns, readState, reportPath, routineError, updateRun, writeRun, writeState } from './store.mjs';
import { DEFAULT_CAP, findTemplate } from './templates.mjs';

export const MAX_FINDING_LINES = 20;
export const MAX_NOTE_LINES = 5;
const NOTHING_NEW = /^nothing new\.?$/i;
const head = (id, rest) => `RELAY_ROUTINE: ${id} · ${rest}`;
const shq = (s) => (/^[\w@%+=:,./-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);

export const findingLine = (f) => `- ${f.text}${f.href ? ` · ${f.href}` : ''}${f.command ? ` · ${f.command}` : ''}`;

// New: ids not in seen. Resolved: ids in seen and missing now; dropped from seen and dismissed.
export function diffFindings(state, findings, nowIso) {
  const current = new Map();
  for (const f of findings) if (f && typeof f.id === 'string' && !current.has(f.id)) current.set(f.id, f);
  const fresh = [...current.values()].filter((f) => !Object.hasOwn(state.seen, f.id));
  const resolved = Object.keys(state.seen).filter((id) => !current.has(id));
  const seen = Object.fromEntries([...current.keys()].map((id) => [id, state.seen[id] ?? nowIso]));
  const dismissed = Object.fromEntries(Object.entries(state.dismissed ?? {}).filter(([id]) => current.has(id)));
  return { fresh, resolved, seen, dismissed, current: [...current.values()] };
}

export function cut(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

export const forYou = ({ ask, data, cli, id }) => ['For you:', ask, ...(data ? ['', data] : []), '', `Pipe your answer to: node ${shq(cli)} routine note ${id}`];

// { code, out: string[] }. A failing check is a "failed" run, never a throw.
export async function runInstance(id, { dryRun = false, via = 'schedule', now = new Date() } = {}) {
  if (!INSTANCE_RE.test(String(id))) throw routineError(`not a routine instance id: ${id}`, { code: 64 });
  const inst = getInstance(id);
  if (!inst) throw routineError(`unknown routine instance: ${id} (relay routine list)`);
  if (inst.registration?.state === 'disabled') return { code: 0, out: [head(id, 'skipped · disabled')] };
  const template = findTemplate(inst.routine);
  if (!template) return { code: 1, out: [head(id, `failed · routine ${inst.routine} not found`)] };
  const release = dryRun ? () => {} : acquireLock(id, now.getTime());
  if (!release) return { code: 0, out: [head(id, 'skipped · already running')] };
  const startedAt = now.toISOString();
  const record = (fields) => (dryRun ? null : writeRun(id, { startedAt, endedAt: new Date().toISOString(), via, ...fields }));
  const none = { new: [], resolved: [], report: null, judgment: null };
  try {
    const { state, reset } = readState(id);
    const week = isoWeek(now);
    const count = state.weekRuns?.week === week ? state.weekRuns.count : 0;
    const cap = template.cap?.runsPerWeek ?? DEFAULT_CAP;
    const notes = reset ? ['state reset (damaged state.json kept as state.json.bad)'] : [];
    if (!dryRun && via !== 'hq' && count >= cap) {
      const reason = `cap ${cap}/week reached`;
      record({ ...none, outcome: 'skipped', skipped: reason, findings: state.current?.length ?? 0, notes });
      return { code: 0, out: [head(id, `skipped · ${reason}`)] };
    }
    const judge = !dryRun && via !== 'hq';
    const counted = { ...state, lastRunAt: startedAt, weekRuns: via === 'hq' ? state.weekRuns : { week, count: count + 1 } };

    if (template.type === 'prompt') {
      if (via === 'hq') return { code: 0, out: [head(id, 'skipped · prompt routines run on their harness')] };
      const report = reportPath(id, now);
      const ask = template.kind === 'passive' ? `${template.prompt}\n\nAnswer exactly "nothing new" when nothing changed since the last run.` : template.prompt;
      if (!dryRun) {
        mkdirSync(dirname(report), { recursive: true });
        writeFileSync(report, `# ${template.title} · ${localDate(now)}\n`);
        writeState(id, counted);
        record({ ...none, outcome: 'report', skipped: null, findings: 0, notes, report, judgment: 'pending' });
      }
      return { code: 0, out: [head(id, `0 new · ${report}`), ...notes.map((n) => `note: ${n}`), '', ...forYou({ ask, data: '', cli: inst.relayCli, id })] };
    }

    const mod = await import(pathToFileURL(join(RELAY_ROOT, 'lib', 'routines', `${template.check}.mjs`)).href);
    const { repos, skipped } = reposInScope(inst.scope, readRegistry());
    notes.push(...skipped.map((s) => `${s.name}: skipped (${s.reason})`));
    const result = await mod.check({ repos, options: { ...(template.options ?? {}), ...(inst.options ?? {}) }, now, instance: inst, template });
    notes.push(...(result.notes ?? []));
    const d = diffFindings(state, result.findings ?? [], startedAt);
    let report = null;
    let judgment = null;
    let data = '';
    if (template.kind === 'active') {
      report = reportPath(id, now);
      let text = result.report ?? `# ${template.title} · ${localDate(now)}\n`;
      if (template.judgment) {
        const heading = template.judgment.heading ?? 'Answer';
        const placeholder = 'suggestions come with the scheduled run';
        // a same-day re-run refreshes the deterministic part but keeps an answered section
        let answered = '';
        if (!dryRun && existsSync(report)) {
          const old = readFileSync(report, 'utf8');
          const at = old.lastIndexOf(`\n## ${heading}\n`);
          const section = at >= 0 ? old.slice(at).trim() : '';
          if (section && !section.includes(placeholder)) answered = section;
        }
        if (judge) {
          judgment = 'pending';
          data = cut(result.judgmentData ?? '', template.judgment.maxInputChars);
        } else {
          judgment = 'skipped';
        }
        if (answered) text = `${text.trimEnd()}\n\n${answered}\n`;
        else if (!judge) text = `${text.trimEnd()}\n\n## ${heading}\n\n${placeholder}\n`;
      }
      if (!dryRun) {
        mkdirSync(dirname(report), { recursive: true });
        writeFileSync(report, text);
      }
    }
    if (!dryRun) {
      writeState(id, { ...counted, seen: d.seen, dismissed: d.dismissed, current: d.current });
      record({ outcome: d.fresh.length ? 'new' : template.kind === 'active' ? 'report' : 'nothing-new', skipped: null, findings: d.current.length, new: d.fresh.slice(0, 200), resolved: d.resolved, notes, report, judgment });
    }
    const n = d.fresh.length;
    const first = template.kind === 'active' ? `${n} new · ${report}` : n ? `${n} new` : 'nothing new';
    const out = [head(id, first), ...d.fresh.slice(0, MAX_FINDING_LINES).map(findingLine)];
    if (n > MAX_FINDING_LINES) out.push(`… ${n - MAX_FINDING_LINES} more: relay routine show ${id}`);
    out.push(...notes.slice(0, MAX_NOTE_LINES).map((x) => `note: ${x}`));
    if (judgment === 'pending') out.push('', ...forYou({ ask: template.judgment.ask, data, cli: inst.relayCli, id }));
    return { code: 0, out };
  } catch (err) {
    const message = String(err?.message ?? err).split('\n')[0].slice(0, 300);
    try {
      record({ ...none, outcome: 'failed', error: message, skipped: null, findings: 0, notes: [] });
    } catch { /* the failure is printed below */ }
    return { code: 1, out: [head(id, `failed · ${message}`)] };
  } finally {
    release();
  }
}

export async function run(args) {
  const id = args._[0];
  if (!id) throw routineError('usage: relay routine run <instance> [--dry-run]', { code: 64 });
  const r = await runInstance(id, { dryRun: Boolean(args['dry-run']), via: args.via === 'hq' ? 'hq' : 'schedule' });
  console.log(r.out.join('\n'));
  return r.code;
}

// Appends the session's answer under the judgment heading of the latest report.
export function noteInstance(id, answer, { now = new Date() } = {}) {
  if (!INSTANCE_RE.test(String(id))) throw routineError(`not a routine instance id: ${id}`, { code: 64 });
  const inst = getInstance(id);
  if (!inst) throw routineError(`unknown routine instance: ${id}`);
  const last = listRuns(id).find((r) => r.judgment === 'pending');
  if (!last || !last.report) throw routineError(`no judgment is pending for ${id}`);
  const text = String(answer ?? '').trim();
  if (!text) throw routineError('the answer is empty: pipe it on stdin');
  const template = findTemplate(inst.routine);
  appendFileSync(last.report, `\n## ${template?.judgment?.heading ?? 'Answer'}\n\n${text}\n`);
  const passivePrompt = template?.type === 'prompt' && template.kind === 'passive';
  updateRun(last.file, (r) => ({ ...r, judgment: 'answered', answeredAt: now.toISOString(), ...(passivePrompt ? { outcome: NOTHING_NEW.test(text) ? 'nothing-new' : 'new' } : {}) }));
  return last.report;
}

export async function note(args) {
  const id = args._[0];
  if (!id) throw routineError('usage: relay routine note <instance> (the answer on stdin)', { code: 64 });
  console.log(`✓ noted in ${noteInstance(id, readFileSync(0, 'utf8'))}`);
  return 0;
}
