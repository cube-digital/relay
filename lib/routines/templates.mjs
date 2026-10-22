// Routine templates: relay's own routines/<id>.json and the user's prompt routines in
// <relayHome>/routines/custom/<id>.json. One validation for relay build --check,
// relay routine new and loading; invalid files are reported, never loaded.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { relayHome } from '../budget.mjs';
import { loadRouting, RELAY_ROOT } from '../routing.mjs';
import { DEFAULT_SCHEDULE, describeSchedule, parseDays, scheduleProblems } from './schedule.mjs';
import { routineError } from './store.mjs';

export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const KINDS = ['passive', 'active'];
export const TYPES = ['check', 'prompt'];
export const MAX_PROMPT = 4000;
export const DEFAULT_CAP = 7;
const KEYS = ['id', 'title', 'kind', 'type', 'check', 'prompt', 'schedule', 'options', 'judgment', 'cap'];
const JUDGMENT_KEYS = ['tier', 'maxInputChars', 'ask', 'heading'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const customDir = () => join(relayHome(), 'routines', 'custom');

// Problems of one template, each prefixed with `file`; check modules live in <root>/lib/routines/.
export function templateProblems(t, file, { root = RELAY_ROOT, tiers = Object.keys(loadRouting(root).tiers) } = {}) {
  if (!isObj(t)) return [`${file}: not a JSON object`];
  const p = [];
  const add = (m) => p.push(`${file}: ${m}`);
  for (const k of Object.keys(t)) if (!KEYS.includes(k)) add(`unknown key "${k}"`);
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) add('id must be kebab-case');
  if (typeof t.title !== 'string' || !t.title.trim()) add('title is required');
  if (!KINDS.includes(t.kind)) add(`kind must be ${KINDS.join(' or ')}`);
  if (!TYPES.includes(t.type)) add(`type must be ${TYPES.join(' or ')}`);
  if (t.type === 'check') {
    if (typeof t.check !== 'string' || !ID_RE.test(t.check)) add('a check routine needs "check"');
    else if (!existsSync(join(root, 'lib', 'routines', `${t.check}.mjs`))) add(`check "${t.check}" has no module lib/routines/${t.check}.mjs`);
    if (t.prompt !== undefined) add('a check routine has no "prompt"');
    if (t.cap === undefined) add('a check routine needs cap.runsPerWeek');
  }
  if (t.type === 'prompt') {
    if (typeof t.prompt !== 'string' || !t.prompt.trim()) add('a prompt routine needs "prompt"');
    else if (t.prompt.length > MAX_PROMPT) add(`prompt is longer than ${MAX_PROMPT} characters`);
    if (t.check !== undefined) add('a prompt routine has no "check"');
  }
  for (const s of scheduleProblems(t.schedule)) add(s);
  if (t.options !== undefined && !isObj(t.options)) add('options must be an object');
  if (t.judgment !== undefined) {
    if (!isObj(t.judgment)) add('judgment must be an object');
    else {
      for (const k of Object.keys(t.judgment)) if (!JUDGMENT_KEYS.includes(k)) add(`judgment: unknown key "${k}"`);
      if (!tiers.includes(t.judgment.tier)) add(`judgment.tier "${t.judgment.tier}" is not a tier in config/routing.json (${tiers.join(', ')})`);
      if (!Number.isInteger(t.judgment.maxInputChars) || t.judgment.maxInputChars < 200 || t.judgment.maxInputChars > 20000) add('judgment.maxInputChars must be an integer from 200 to 20000');
      if (typeof t.judgment.ask !== 'string' || !t.judgment.ask.trim()) add('judgment.ask is required');
      if (t.judgment.heading !== undefined && (typeof t.judgment.heading !== 'string' || !t.judgment.heading.trim())) add('judgment.heading must be text');
    }
  }
  if (t.cap !== undefined) {
    if (!isObj(t.cap) || Object.keys(t.cap).some((k) => k !== 'runsPerWeek')) add('cap takes only runsPerWeek');
    else if (!Number.isInteger(t.cap.runsPerWeek) || t.cap.runsPerWeek < 1 || t.cap.runsPerWeek > 50) add('cap.runsPerWeek must be an integer from 1 to 50');
  }
  return p;
}

function readDir(dir, prefix, opts, custom) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { templates: [], problems: [] };
  }
  const templates = [];
  const problems = [];
  for (const f of files) {
    const file = `${prefix}/${f}`;
    let t;
    try {
      t = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch (err) {
      problems.push(`${file}: not valid JSON (${err.message})`);
      continue;
    }
    const pr = templateProblems(t, file, opts);
    if (isObj(t) && t.id !== f.slice(0, -5)) pr.push(`${file}: id "${t.id}" must equal the file name`);
    if (pr.length) problems.push(...pr);
    else templates.push({ ...t, custom });
  }
  return { templates, problems };
}

// Shipped templates first; a user routine never shadows a shipped id.
export function loadTemplates({ root = RELAY_ROOT, custom = true } = {}) {
  const opts = { root, tiers: Object.keys(loadRouting(root).tiers) };
  const shipped = readDir(join(root, 'routines'), 'routines', opts, false);
  const mine = custom ? readDir(customDir(), customDir(), opts, true) : { templates: [], problems: [] };
  const ids = new Set(shipped.templates.map((t) => t.id));
  return { templates: [...shipped.templates, ...mine.templates.filter((t) => !ids.has(t.id))], problems: [...shipped.problems, ...mine.problems] };
}

export const findTemplate = (id, opts) => loadTemplates(opts).templates.find((t) => t.id === id);

// relay build --check: relay's own templates only.
export const checkRoutines = (root = RELAY_ROOT) => loadTemplates({ root, custom: false }).problems;

// relay routine new <id> --prompt "<text>" --kind passive|active [--days mon,…] [--at HH:MM]
export function newRoutine(args) {
  const id = args._[0];
  if (!id || typeof args.prompt !== 'string' || !KINDS.includes(args.kind)) {
    throw routineError('usage: relay routine new <id> --prompt "<text>" --kind passive|active [--days mon,…] [--at HH:MM]', { code: 64 });
  }
  const t = {
    id,
    title: id,
    kind: args.kind,
    type: 'prompt',
    prompt: args.prompt.trim(),
    schedule: { days: args.days ? parseDays(args.days) : DEFAULT_SCHEDULE.days, at: typeof args.at === 'string' ? args.at : DEFAULT_SCHEDULE.at },
    cap: { runsPerWeek: DEFAULT_CAP },
  };
  const problems = templateProblems(t, id);
  if (loadTemplates({ custom: false }).templates.some((x) => x.id === id)) problems.push(`${id}: relay ships a routine with this id`);
  if (problems.length) throw routineError(problems.join('; '));
  mkdirSync(customDir(), { recursive: true });
  const path = join(customDir(), `${id}.json`);
  const existed = existsSync(path);
  writeFileSync(`${path}.tmp`, JSON.stringify(t, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
  console.log(`✓ ${existed ? 'updated' : 'created'} ${id} (${t.kind} prompt routine, ${describeSchedule(t.schedule)}): ${path}`);
  console.log(`next: relay routine enable ${id} --harness claude|codex (--project <id> | --repo <path> | --all)`);
  return 0;
}
