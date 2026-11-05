# Relay Routines Plan

**Goal:** Scheduled engineering checks (`pr-hygiene`, `weekly-report`, and the user's prompt routines) that the user enables on the harness they choose, run as relay CLI work at zero tokens with one bounded judgment step, capped, and visible in HQ.
**Spec:** docs/relay/specs/2026-10-21-relay-routines-design.md
**Architecture:** `lib/routines/` holds pure schedules, templates, the instance store, scopes, the Codex automation writer, enable/disable, the run (lock, cap, diff, report, `For you:` block) and one module per check; `scripts/relay-routine.mjs` dispatches `relay routine <sub>` to them. HQ reads the same store through `lib/hq/routines.mjs`, runs Run now as a non-model launch action (`routine`), and draws a Routines page; Claude scheduled tasks are created by the new `/relay:routine` command.

## Global Constraints

- Plain Node >= 20, ESM, named exports, no dependencies, imports from `node:*` and relay's own modules only. Every new file starts with a 1-3 line comment saying what it is.
- Never hand-edit `agents/`, `codex/` or the `<relay:generated>` block in `hooks/register.ts`. This plan does not change roles, routing or the mod; `node bin/relay build --check` must stay green after every task.
- Routines only propose: no code path deletes, closes, comments or pushes. Commands for the user are printed, never run.
- Writes into another tool's folder: only `~/.codex/automations/relay-*` (regex `FOLDER_RE`, T3). Never read, write or remove any other entry there. Every path is built by `relayFolder()` (T3).
- Facts on disk: findings come from `git`, `gh` and relay's files only.
- CLI tests use real git repositories (`tempRepo`, `runCli` from `test/helpers.mjs`) and pass `env: { RELAY_HOME: <temp>, HOME: <temp when Codex is involved> }`; no test reads or writes the real `~/.relay` or `~/.codex`. Tests that need "gh not on PATH" build a temp bin dir holding symlinks `node` → `process.execPath` and `git` → `execFileSync('which', ['git'], { encoding: 'utf8' }).trim()` and pass `PATH: <that dir>` (runCli resolves `node` through it).
- HQ UI: terse English labels, no explanatory text; every value rendered as text through `h()` from `lib/hq/ui/dom.js`; no `innerHTML`, `insertAdjacentHTML`, `outerHTML` or `document.write`; links only through `link()`/`safeHref`.
- HQ POST routes inherit the server gate (token, Host, Origin, JSON Content-Type). Bodies are intents: the server reads only the named fields.
- Each task's commit subject starts with its id: `T4: relay routine run and note`.

#### Fixed names and values (binding for every task)

- **Paths:** templates `routines/<id>.json` (shipped); user prompt routines `<relayHome>/routines/custom/<id>.json`; instances `<relayHome>/routines/enabled.json`; per instance `<relayHome>/routines/<instance>/` with `state.json`, `state.json.bad`, `runs/<stamp>.json` (stamp = `startedAt` with `:` and `.` replaced by `-`), `reports/<YYYY-MM-DD>.md` (local date), `lock`. Check modules `lib/routines/<check>.mjs`. Codex `~/.codex/automations/relay-<slug>/automation.toml` + `memory.md`, `<slug>` = instance id with `@` replaced by `-`.
- **Ids:** template/check id `ID_RE = /^[a-z0-9][a-z0-9-]*$/`; instance id `INSTANCE_RE = /^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9._-]*$/`, built as `<routine>@<scope key>`, scope key = project id | `slugPart(basename(repo path))` | `all`. Claude task id and Codex folder: `relay-<slug>`.
- **Days:** `DAYS = ['mon','tue','wed','thu','fri','sat','sun']`; time `HH:MM` 00:00–23:59, local. Default schedule for `relay routine new`: mon–fri 09:00. ISO week `YYYY-Www` of the local date. Default cap `DEFAULT_CAP = 7`.
- **enabled.json:** `{ "version": 1, "instances": [Instance] }`, Instance = `{ id, routine, harness: "claude"|"codex", scope: { project } | { repo: <registry key> } | { all: true }, schedule: { days, at }, options: {}, relayCli: <abs path of bin/relay>, registration: { state: "pending"|"active"|"disabled", codexPath?: "~/.codex/automations/relay-<slug>", taskId?: string|null, disabledAt? }, enabledAt }`.
- **state.json:** `{ version: 1, seen: { <findingId>: <firstSeenAt ISO> }, dismissed: { <findingId>: <ISO> }, current: [Finding], lastRunAt: ISO|null, weekRuns: { week: "YYYY-Www"|null, count } }`.
- **Finding:** `{ id: "<rid>:<kind>:<key>", kind, repo: <path>|null, repoName, text, href: <https url>|null, command: <string>|null }`. `gh-not-connected` uses rid `gh` and key `gh`: id `gh:gh-not-connected:gh`.
- **Run record:** `{ startedAt, endedAt, via: "schedule"|"hq", outcome: "new"|"nothing-new"|"report"|"skipped"|"failed", skipped: <reason>|null, error?: <text>, findings: <count of current>, new: [Finding] (≤ 200), resolved: [findingId], notes: [text], report: <path>|null, judgment: "pending"|"skipped"|"answered"|null }`.
- **Check module interface:** `export async function check({ repos, options, now, instance, template })` → `{ findings: Finding[], notes?: string[], report?: string, judgmentData?: string }`; `repos` = `[{ path, rid, name, project: { id, name } | null }]` from `reposInScope`.
- **Run output:** first line always one of `RELAY_ROUTINE: <id> · <n> new` (passive), `RELAY_ROUTINE: <id> · nothing new` (passive), `RELAY_ROUTINE: <id> · <n> new · <report path>` (active and prompt routines), `RELAY_ROUTINE: <id> · skipped · <reason>`, `RELAY_ROUTINE: <id> · failed · <reason>`. Skip reasons: `cap <n>/week reached`, `already running`, `disabled`, `prompt routines run on their harness`. Then ≤ 20 lines `- <text>[ · <href>][ · <command>]`, then `… <k> more: relay routine show <id>` if needed, then ≤ 5 `note: <text>` lines, then for a pending judgment a blank line and the block `For you:` / `<ask>` / blank / `<data cut to maxInputChars>` / blank / `Pipe your answer to: node <cli> routine note <id>`.
- **Judgment block:** routines read no usage data. The block is left out only for HQ Run now (`via: "hq"`); the report then says `suggestions come with the scheduled run` under `## <judgment.heading>`. The caps are `cap.runsPerWeek` and `judgment.maxInputChars`.
- **Exit codes:** 64 usage (no `--harness`, bad scope flags, bad days/time, bad id); 1 other errors (unknown routine/instance, Codex missing, `note` with nothing pending, failed run); 0 for skipped runs. Errors carry `{ code, status }` via `routineError(message, { code = 1, status = 400 })` (T2, `lib/routines/store.mjs`).
- **The scheduled prompt** (both harnesses, `<cli>` shell-quoted only when it has characters outside `[\w@%+=:,./-]`): ``Run `node <cli> routine run <id>` in a shell and reply with its output, unchanged. If the output ends with a "For you:" block, do what it asks and pipe your answer to `node <cli> routine note <id>`. Do nothing else.``
- **Claude proposal line:** `RELAY_PROPOSAL: {"taskId","title","description","cronExpression","prompt"}` (one-line JSON). **Claude refresh line:** `RELAY_UPDATE: {"instance","taskId","prompt"}`.
- **Suggestion line format** (asked for in `weekly-report`'s `judgment.ask`, parsed by HQ): `- <id> · <passive|active> · <days> <HH:MM> · <what it checks> · replaces <action>`; regex `SUGGESTION_RE = /^[-*]\s*([a-z0-9][a-z0-9-]*)\s*·\s*(passive|active)\s*·\s*([a-z,]+)\s+(\d{2}:\d{2})\s*·\s*(.+?)(?:\s*·\s*replaces\s+(.+))?\s*$/i`.
- **Ledger lines** (UTC): `/^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: \[[^\]]*\])? (.*)$/`; plan complete `/^plan: complete\b/`; started `/^start:/`; rulings `/^Ruling:/`; piece `/^piece ([a-z0-9][a-z0-9-]*)(?: lane ([a-z]+))?: (pass|findings|blocked|skipped)\b(?: \(([^)]*)\))?/`; ledger header `/^# relay ledger — plan: (.+)$/m`.

#### HQ API shapes (T9 produces, T10/T11 read)

- `InstanceView` (T7 `instanceView`): `{ id, routine, title, kind, type, harness, state, scope, scopeLabel, schedule, scheduleText, nextRun: ISO|null (null unless state active), stalePath, cap, weekRuns, lastRun: { startedAt, outcome, new: <n>, skipped } | null, open: <current findings not dismissed>, codexPath: string|null, taskId: string|null, appOpen: harness === 'claude' }`.
- `GET /api/routines` → `{ now, week: { start: ISO, days: [ISO ×7, Monday first] }, instances: [InstanceView & { project: { id, name } | null, slots: [ISO], runs: [{ at, outcome }], pendingCommand: string|null }], templates: [{ id, title, kind, type, check: string|null, schedule, scheduleText, judgment: boolean, custom: boolean }], scopes: { projects: [{ id, name }], repos: [{ rid, name }] }, codex: { installed: boolean } }`.
- `GET /api/routines/<id>` → `{ instance: <as above>, findings: [Finding & { firstSeenAt, isNew, dismissed }], runs: [RunRecord], reports: [{ date, path, text }], suggestions: [{ id, kind, days, at, what, replaces, command }] }`.
- `POST /api/routines/preview` body `{ routine, harness, scope: "project"|"repo"|"all", project?, rid?, days?: [day], at? }` → `{ instance: id|null, codex: { path, model, effort, rrule, cwds } | null, claude: { command } | null, errors: [text] }`.
- `POST /api/routines` same body plus `confirm: true` → `{ ok: true, instance: id }` (Codex only).
- `POST /api/routines/<id>/run` → `{ launch }`; `POST /api/routines/<id>/dismiss` body `{ finding }` → `{ ok: true }`; `POST /api/routines/<id>/disable` → `{ ok: true, removed: path|null }` (Codex only).
- Home attention item for a routine finding: `{ id: "routine:<instance>:<findingId>", kind: "routine", label: <template title>, rid: <rid of finding.repo>|null, repoName: <finding.repoName or scope label>, plan: null, lane: null, text, at: <firstSeenAt>, href: "#/routines/<instance>" }`. Activity event: `{ at, kind: "routine", rid: null, repoName: "routine <instance>", plan: null, text: "<title>: <summary>", href: "#/routines/<instance>" }`.

## Review Focus

- Codex pick-up of a relay-written automation and the Claude scheduled-tasks tool names are unverified on this machine (T1 records it). Check that nothing depends on them beyond the observed field set and the prompt.
- Lock takeover: two runs that both find a stale lock at the same instant can both proceed. Acceptable for scheduled runs; confirm nothing else (dismiss, note) can corrupt `state.json` while a run holds the lock.
- Timezones: schedules, ISO weeks, report dates and cron/RRULE are local; ledger stamps are UTC. Look for mixed comparisons.
- `--all` scope: Codex `cwds` are fixed at enable time; repositories added later are covered by the run (scope resolves at run time) but not listed in `cwds`.
- `relay-branches` proposes `git branch -D` on the integration branch; confirm the ancestor check is against the repository's current branch and runs only for `plan: complete` ledgers.
- HQ `POST /api/routines` writes into `~/.codex`: Codex harness only, intents only, every path through `relayFolder()`.
- Report rendering in HQ: only `https:` links, no HTML sink, tables and code as text.
- `weekly-report` judgment data is cut at `maxInputChars` mid-line; the model sees a truncated last line.
- `pr-hygiene` makes up to two `gh` calls per repository sequentially with 15 s timeouts; a large `--all` scope can take minutes.

## Tasks

### T1: Verify the Codex automation format and the Claude scheduled-tasks tool
Spec section 9. Write `docs/relay/notes/2026-10-21-routines-facts.md` with exactly these headings, in order: `## Codex automations`, `## Claude scheduled tasks`, `## Rules for later tasks`. Read-only: change nothing under `~/.codex` or `~/.claude`.

Under **Codex automations**:
- the field names present in every `~/.codex/automations/*/automation.toml` on this machine and their value types (names and types only; never copy a prompt or a name), the `status` values seen, whether `memory.md` sits beside each file;
- `command -v codex` result and whether a Codex app exists (`ls /Applications | grep -i codex`);
- a line `Unverified here:` listing: which fields Codex requires, other `status` values (for example a paused state), and whether the app watches the folder or needs a restart.

Under **Claude scheduled tasks**: whether this session has a scheduled-tasks tool; if it does, its exact tool names (create, update, list, delete) and the create call's parameter names; whether `~/.claude/scheduled-tasks/` exists. If the session has no such tool, write `Unverified here: tool names and parameters; commands/routine.md uses mcp__scheduled-tasks__create_scheduled_task, mcp__scheduled-tasks__update_scheduled_task and mcp__scheduled-tasks__list_scheduled_tasks.`

Under **Rules for later tasks** write these, adjusted only if the facts contradict them:
1. Relay writes exactly the 14 fields observed (`version`, `id`, `kind`, `name`, `prompt`, `status`, `rrule`, `model`, `reasoning_effort`, `execution_environment`, `target`, `cwds`, `created_at`, `updated_at`), `status = "ACTIVE"` only, plus an empty `memory.md`.
2. Disable removes the folder; relay never writes a paused status.
3. `enable --harness codex` prints `note: Codex reads ~/.codex/automations itself; restart the Codex app if relay-<slug> does not show up.`
4. If the Claude tool names differ from the ones above, T8 uses the observed names.

### T2: Routine core: schedules, templates, store, scopes, the CLI entry and the build check
Create the modules below with exactly this code, add the `bin/relay` entry and the build check, and extend the build test.

`lib/routines/schedule.mjs`:

```js
// Routine schedules: days (mon…sun) and a local time HH:MM. Validation, ISO weeks,
// the next run, this week's slots, and the Codex RRULE and Claude cron forms.

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAYS = DAYS.slice(0, 5);
export const DEFAULT_SCHEDULE = { days: WEEKDAYS, at: '09:00' };
const AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RRULE_DAY = { mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU' };
const CRON_DAY = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };

export function scheduleProblems(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['schedule must be an object with days and at'];
  const problems = [];
  for (const k of Object.keys(s)) if (k !== 'days' && k !== 'at') problems.push(`schedule: unknown key "${k}"`);
  if (!Array.isArray(s.days) || !s.days.length) problems.push('schedule.days must be a non-empty list of mon…sun');
  else {
    for (const d of s.days) if (!DAYS.includes(d)) problems.push(`schedule.days: "${d}" is not one of ${DAYS.join(', ')}`);
    if (new Set(s.days).size !== s.days.length) problems.push('schedule.days has a day twice');
  }
  if (typeof s.at !== 'string' || !AT_RE.test(s.at)) problems.push(`schedule.at "${s.at}" is not a time HH:MM (00:00-23:59)`);
  return problems;
}

// "mon,wed,fri" → ['mon', 'wed', 'fri'] in week order; a usage error (code 64) otherwise.
export function parseDays(text) {
  const days = String(text ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (!days.length || days.some((d) => !DAYS.includes(d))) throw Object.assign(new Error(`--days takes a comma list of ${DAYS.join(',')}`), { code: 64, status: 400 });
  return DAYS.filter((d) => days.includes(d));
}

const hm = (at) => {
  const m = AT_RE.exec(at);
  return [Number(m[1]), Number(m[2])];
};
const dayKey = (date) => DAYS[(date.getDay() + 6) % 7];
const ordered = (days) => DAYS.filter((d) => days.includes(d));

// Monday 00:00 local of the week holding `now`.
export function weekStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// ISO 8601 week of the local date: "2026-W43".
export function isoWeek(now = new Date()) {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Local YYYY-MM-DD.
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Every scheduled time in the week holding `now`, Monday first.
export function weekSlots(schedule, now = new Date()) {
  const [hh, mm] = hm(schedule.at);
  const start = weekStart(now);
  return DAYS.map((d, i) => [d, i])
    .filter(([d]) => schedule.days.includes(d))
    .map(([, i]) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, hh, mm));
}

// The first scheduled time strictly after `now`.
export function nextRun(schedule, now = new Date()) {
  const [hh, mm] = hm(schedule.at);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hh, mm);
    if (d > now && schedule.days.includes(dayKey(d))) return d;
  }
  return null;
}

export function rruleFor(schedule) {
  const [hh, mm] = hm(schedule.at);
  return `RRULE:FREQ=WEEKLY;BYHOUR=${hh};BYMINUTE=${mm};BYDAY=${ordered(schedule.days).map((d) => RRULE_DAY[d]).join(',')}`;
}

// Five fields, local time: "0 9 * * 1,2,3,4,5"; every day is "*".
export function cronFor(schedule) {
  const [hh, mm] = hm(schedule.at);
  const days = ordered(schedule.days);
  return `${mm} ${hh} * * ${days.length === 7 ? '*' : days.map((d) => CRON_DAY[d]).join(',')}`;
}

export function describeSchedule(schedule) {
  const days = ordered(schedule.days);
  const label = days.length === 7 ? 'daily' : days.join(',') === WEEKDAYS.join(',') ? 'mon-fri' : days.join(',');
  return `${label} ${schedule.at}`;
}
```

`lib/routines/store.mjs`:

```js
// Routine instances and their data under <relayHome>/routines/: enabled.json (the
// instances), and per instance state.json, runs/, reports/ and the run lock.
// JSON writes are atomic (temp file + rename).

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { relayHome } from '../budget.mjs';
import { alive } from '../../scripts/relay-marathon.mjs';
import { localDate } from './schedule.mjs';

export const INSTANCE_RE = /^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9._-]*$/;
export const LOCK_STALE_MS = 2 * 60 * 60_000;

// Errors carry the CLI exit code and the HTTP status HQ answers with.
export const routineError = (message, { code = 1, status = 400 } = {}) => Object.assign(new Error(message), { code, status });

export const routinesDir = () => join(relayHome(), 'routines');
export const enabledPath = () => join(routinesDir(), 'enabled.json');

export function instanceDir(id) {
  if (!INSTANCE_RE.test(String(id))) throw routineError(`not a routine instance id: ${id}`, { code: 64 });
  return join(routinesDir(), id);
}

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

// A missing file is no instances; a damaged one is an error, never silently replaced.
export function readEnabled() {
  const path = enabledPath();
  if (!existsSync(path)) return { version: 1, instances: [] };
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw routineError(`${path} is not valid JSON; fix or remove it`, { status: 500 });
  }
  if (doc?.version !== 1 || !Array.isArray(doc.instances)) throw routineError(`${path} is not a relay routines file (version 1)`, { status: 500 });
  return doc;
}

export function updateEnabled(change) {
  const doc = readEnabled();
  const result = change(doc);
  writeJsonAtomic(enabledPath(), doc);
  return result;
}

export const listInstances = () => readEnabled().instances;
export const getInstance = (id) => readEnabled().instances.find((i) => i.id === id);

export function emptyState() {
  return { version: 1, seen: {}, dismissed: {}, current: [], lastRunAt: null, weekRuns: { week: null, count: 0 } };
}

// { state, reset }: a damaged state.json is kept as state.json.bad and the run starts empty.
export function readState(id) {
  const path = join(instanceDir(id), 'state.json');
  if (!existsSync(path)) return { state: emptyState(), reset: false };
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'));
    if (!s || typeof s !== 'object' || !s.seen || typeof s.seen !== 'object' || Array.isArray(s.seen)) throw new Error('bad shape');
    return { state: { ...emptyState(), ...s }, reset: false };
  } catch {
    copyFileSync(path, `${path}.bad`);
    return { state: emptyState(), reset: true };
  }
}

export const writeState = (id, state) => writeJsonAtomic(join(instanceDir(id), 'state.json'), state);

// A release function, or null while another live run holds the lock. A lock whose pid
// is gone, or that is older than LOCK_STALE_MS, is taken over.
export function acquireLock(id, now = Date.now()) {
  const dir = instanceDir(id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() }));
      } finally {
        closeSync(fd);
      }
      return () => rmSync(path, { force: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const held = readJson(path);
      if (!held) {
        let young = false;
        try {
          young = now - statSync(path).mtimeMs < 10_000; // being written right now
        } catch { /* gone: retry */ }
        if (young) return null;
      } else if (alive(held.pid) && now - Date.parse(held.at ?? '') < LOCK_STALE_MS) return null;
      rmSync(path, { force: true });
    }
  }
  return null;
}

export const lockHeld = (id) => existsSync(join(instanceDir(id), 'lock'));

const stampOf = (iso) => iso.replace(/[:.]/g, '-');

export function writeRun(id, record) {
  const path = join(instanceDir(id), 'runs', `${stampOf(record.startedAt)}.json`);
  writeJsonAtomic(path, record);
  return path;
}

// Newest first; each record carries the `file` it was read from.
export function listRuns(id, { limit = 50 } = {}) {
  const dir = join(instanceDir(id), 'runs');
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
  } catch {
    return [];
  }
  return files.slice(0, limit).map((f) => {
    const r = readJson(join(dir, f));
    return r ? { ...r, file: join(dir, f) } : undefined;
  }).filter(Boolean);
}

export const latestRun = (id) => listRuns(id, { limit: 1 })[0];

export function updateRun(file, change) {
  const r = readJson(file);
  if (!r) return undefined;
  const next = change(r);
  writeJsonAtomic(file, next);
  return next;
}

export const reportPath = (id, now = new Date()) => join(instanceDir(id), 'reports', `${localDate(now)}.md`);

// Newest first: [{ date, path }].
export function listReports(id, { limit = 10 } = {}) {
  const dir = join(instanceDir(id), 'reports');
  try {
    return readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse().slice(0, limit).map((f) => ({ date: f.slice(0, 10), path: join(dir, f) }));
  } catch {
    return [];
  }
}
```

`lib/routines/scope.mjs`:

```js
// Routine scopes: a project, one repository, or every repository in HQ. Instance ids
// are <routine>@<scope key>; a run resolves its scope against the registry at run time.

import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { listRepos, readRegistry, repoKey } from '../hq/registry.mjs';
import { ridOf } from '../hq/repo.mjs';
import { routineError } from './store.mjs';

export const slugPart = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').replace(/[-.]+$/, '') || 'repo';

// flags: { project, repo, all } as parsed from the command line (or built by HQ).
export function scopeFrom({ project, repo, all } = {}, reg = readRegistry()) {
  const given = [project !== undefined, repo !== undefined, all === true].filter(Boolean).length;
  if (given !== 1) throw routineError('choose one scope: --project <id>, --repo <path> or --all', { code: 64 });
  if (project !== undefined) {
    if (typeof project !== 'string' || !reg.projects.some((p) => p.id === project)) throw routineError(`unknown project: ${project}`);
    return { project };
  }
  if (repo !== undefined) {
    const key = typeof repo === 'string' ? repoKey(repo) : undefined;
    if (!key || !Object.hasOwn(reg.repos, key)) throw routineError(`not added to HQ: ${repo} (relay hq add <path>)`);
    return { repo: key };
  }
  if (!listRepos(reg).some((r) => !r.hidden)) throw routineError('no repositories in HQ yet (relay hq add <path>)');
  return { all: true };
}

export function scopeKey(scope) {
  if (scope.project) return scope.project;
  if (scope.repo) return slugPart(basename(scope.repo));
  return 'all';
}

export const instanceIdFor = (routine, scope) => `${routine}@${scopeKey(scope)}`;

export function scopeLabel(scope, reg = readRegistry()) {
  if (scope?.project) return reg.projects.find((p) => p.id === scope.project)?.name ?? scope.project;
  if (scope?.repo) return basename(scope.repo);
  return 'All repositories';
}

// { repos: [{ path, rid, name, project }], skipped: [{ path, name, reason }] }
export function reposInScope(scope, reg = readRegistry()) {
  const all = listRepos(reg);
  const projectOf = (r) => {
    const p = reg.projects.find((x) => x.id === r.project);
    return p ? { id: p.id, name: p.name } : null;
  };
  const repos = [];
  const skipped = [];
  let candidates;
  if (scope?.project) {
    const p = reg.projects.find((x) => x.id === scope.project);
    if (!p) return { repos, skipped: [{ path: null, name: scope.project, reason: 'project no longer in HQ' }] };
    candidates = all.filter((r) => p.repos.includes(r.path));
  } else if (scope?.repo) {
    const r = all.find((x) => x.path === scope.repo);
    if (!r) return { repos, skipped: [{ path: scope.repo, name: basename(scope.repo), reason: 'no longer in HQ' }] };
    candidates = [r];
  } else candidates = all.filter((r) => !r.hidden);
  for (const r of candidates) {
    if (r.hidden) skipped.push({ path: r.path, name: basename(r.path), reason: 'hidden in HQ' });
    else if (!existsSync(r.path)) skipped.push({ path: r.path, name: basename(r.path), reason: 'missing on disk' });
    else repos.push({ path: r.path, rid: ridOf(r.path), name: basename(r.path), project: projectOf(r) });
  }
  return { repos, skipped };
}
```

`lib/routines/templates.mjs`:

```js
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
```

`scripts/relay-routine.mjs` (subcommand modules are loaded on use, so later tasks add their module without touching this file):

```js
// relay routine list | show | history | new | enable | confirm | disable | refresh | run | note
// Scheduled engineering checks. Each subcommand lives in lib/routines/ and is loaded on
// use; an error's `code` is the exit code (64 for usage).

import { parseArgs } from '../lib/args.mjs';

const SUBCOMMANDS = {
  list: ['../lib/routines/info.mjs', 'list'],
  show: ['../lib/routines/info.mjs', 'show'],
  history: ['../lib/routines/info.mjs', 'history'],
  new: ['../lib/routines/templates.mjs', 'newRoutine'],
  enable: ['../lib/routines/enable.mjs', 'enable'],
  confirm: ['../lib/routines/enable.mjs', 'confirm'],
  disable: ['../lib/routines/enable.mjs', 'disable'],
  refresh: ['../lib/routines/enable.mjs', 'refresh'],
  run: ['../lib/routines/run.mjs', 'run'],
  note: ['../lib/routines/run.mjs', 'note'],
};

export const USAGE = `usage: relay routine list | show <routine|instance> | history <instance>
  | enable <routine> --harness claude|codex (--project <id> | --repo <path> | --all) [--days mon,…] [--at HH:MM]
  | confirm <instance> --task-id <id> | disable <instance> | refresh
  | run <instance> [--dry-run] | note <instance> (the answer on stdin)
  | new <id> --prompt "<text>" --kind passive|active [--days mon,…] [--at HH:MM]`;

export async function main(argv) {
  const [sub, ...rest] = argv;
  if (!Object.hasOwn(SUBCOMMANDS, sub ?? '')) {
    console.error(USAGE);
    return sub === undefined || sub === '-h' || sub === '--help' ? 0 : 64;
  }
  const args = parseArgs(rest, { booleans: ['all', 'dry-run', 'json'] });
  const [file, name] = SUBCOMMANDS[sub];
  try {
    const mod = await import(new URL(file, import.meta.url));
    return await mod[name](args);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    return Number.isInteger(err.code) ? err.code : 1;
  }
}
```

`bin/relay`: add after the `hq` entry:
```js
  routine: ['../scripts/relay-routine.mjs', 'scheduled checks: list | show | enable <routine> --harness claude|codex … | confirm | disable | run <instance> | note | new | history | refresh'],
```

`scripts/build.mjs`: import `{ checkRoutines } from '../lib/routines/templates.mjs'`; in `main`, `const problems = [...checkSkills(root), ...checkRoles(root), ...checkFlow(root), ...checkRoutines(root)];`; add a header comment line `// Also validates routines/*.json: keys, check modules, schedules and judgment tiers.`

`test/build.test.mjs`: extend the existing test `build --check fails for a piece with an unknown role, …` (no new test): rename it to end with `, and a routine with an unknown check or a bad schedule`; after the existing edits, `mkdirSync(join(dir, 'routines'))`, write `routines/ghost.json` = `{ "id": "ghost", "title": "Ghost", "kind": "passive", "type": "check", "check": "no-such-check", "schedule": { "days": ["mon"], "at": "09:00" }, "cap": { "runsPerWeek": 7 } }` and `routines/late.json` = `{ "id": "late", "title": "Late", "kind": "active", "type": "prompt", "prompt": "hi", "schedule": { "days": ["mon"], "at": "25:00" } }`; import `checkRoutines` from `../lib/routines/templates.mjs` and assert `checkRoutines(dir).join('\n')` matches `/routines\/ghost\.json: check "no-such-check" has no module/` and `/routines\/late\.json: schedule\.at "25:00"/`. The existing `assert.equal(main(['--check'], dir), 1)` stays last.

### T3: Enable on Codex or Claude; confirm, disable, refresh
Create `lib/routines/codex.mjs` with exactly this code:

```js
// Codex automations written by relay: ~/.codex/automations/relay-<slug>/ holds
// automation.toml (the format Codex uses for its own) and an empty memory.md.
// Relay writes and removes only folders named relay-*, never another automation.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseToml } from '../hq/toml.mjs';
import { routineError } from './store.mjs';

export const FOLDER_RE = /^relay-[a-z0-9][a-z0-9._-]*$/;
export const automationsDir = (home = homedir()) => join(home, '.codex', 'automations');
export const folderFor = (instanceId) => `relay-${String(instanceId).replace('@', '-')}`;

const ESC = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\t': '\\t', '\r': '\\r', '\b': '\\b', '\f': '\\f' };
export const tomlString = (s) => `"${String(s).replace(/[\u0000-\u001f\u007f"\\]/g, (c) => ESC[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;

const tomlValue = (v) => {
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(', ')}]`;
  if (typeof v === 'number') return String(Math.trunc(v));
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${k} = ${tomlValue(x)}`).join(', ')} }`;
  return tomlString(v);
};

// a: { id, name, prompt, rrule, model, effort, cwds, createdAt, updatedAt }
export function automationToml(a) {
  return [
    ['version', 1], ['id', a.id], ['kind', 'cron'], ['name', a.name], ['prompt', a.prompt], ['status', 'ACTIVE'],
    ['rrule', a.rrule], ['model', a.model], ['reasoning_effort', a.effort], ['execution_environment', 'local'],
    ['target', { type: 'projectless' }], ['cwds', a.cwds], ['created_at', a.createdAt], ['updated_at', a.updatedAt],
  ].map(([k, v]) => `${k} = ${tomlValue(v)}`).join('\n') + '\n';
}

// The absolute folder of a relay automation; refuses any other name or place.
export function relayFolder(folder, home = homedir()) {
  const root = resolve(automationsDir(home));
  const path = resolve(root, String(folder));
  if (!FOLDER_RE.test(String(folder)) || dirname(path) !== root || basename(path) !== folder) {
    throw routineError(`refusing to touch ${path}: not a relay-* automation folder`);
  }
  return path;
}

export function codexInstalled(home = homedir()) {
  try {
    return statSync(automationsDir(home)).isDirectory();
  } catch {
    return false;
  }
}

export function readAutomation(folder, home = homedir()) {
  try {
    const r = parseToml(readFileSync(join(relayFolder(folder, home), 'automation.toml'), 'utf8'));
    return r.ok ? r.value : undefined;
  } catch {
    return undefined;
  }
}

export function writeAutomation(a, home = homedir()) {
  if (!codexInstalled(home)) throw routineError(`Codex is not installed here (${automationsDir(home)} is missing); nothing was written`, { status: 409 });
  const dir = relayFolder(a.id, home);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'automation.toml');
  writeFileSync(`${file}.tmp`, automationToml(a));
  renameSync(`${file}.tmp`, file);
  if (!existsSync(join(dir, 'memory.md'))) writeFileSync(join(dir, 'memory.md'), '');
  return file;
}

// The removed folder, or null when it was not there.
export function removeAutomation(folder, home = homedir()) {
  const dir = relayFolder(folder, home);
  if (!existsSync(dir)) return null;
  rmSync(dir, { recursive: true, force: true });
  return dir;
}
```

Create `lib/routines/enable.mjs`. Core functions, exactly:

```js
// relay routine enable | confirm | disable | refresh: an instance on the harness the
// user chose. Codex: relay writes ~/.codex/automations/relay-<slug>/. Claude: a pending
// instance and a proposal that /relay:routine creates in the desktop app.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { readRegistry } from '../hq/registry.mjs';
import { loadRouting, modelFor, RELAY_ROOT } from '../routing.mjs';
import { automationsDir, codexInstalled, folderFor, readAutomation, removeAutomation, writeAutomation } from './codex.mjs';
import { cronFor, describeSchedule, parseDays, rruleFor, scheduleProblems } from './schedule.mjs';
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
```

Add, in prose (same file):
- `confirmInstance(id, taskId)`: 64 unless `INSTANCE_RE` and `TASK_ID_RE` match; 1 unless the instance exists, is `claude` and not `disabled`; sets `registration = { state: 'active', taskId }` and `relayCli = relayCli()` (so a refreshed Claude task records its new path). Returns the instance.
- `disableInstance(id, { home = homedir(), now = new Date() })`: 64/1 as above; already disabled → `{ already: true, removed: null }`; Codex → `removed = removeAutomation(basename(inst.registration?.codexPath ?? folderFor(id)), home)` (the folder name only, so a tampered path cannot leave the automations folder); then `registration.state = 'disabled'`, `registration.disabledAt`. The instance stays in `enabled.json` (its history stays). Returns `{ instance, already, removed }`.
- `refreshInstances({ home = homedir(), now = new Date() })`: for every non-disabled instance whose `relayCli` does not exist: Codex → rewrite with `writeAutomation(codexAutomation({ ...inst, relayCli: relayCli() }, template, reg, { now: now.getTime(), createdAt: prior?.created_at }), home)` and store the new `relayCli`; Claude → collect `{ instance, taskId, prompt: scheduledPrompt(relayCli(), id) }` without changing the instance. Returns `{ codex: [id], claude: [{ instance, taskId, prompt }] }`.
- CLI wrappers `enable(args)`, `confirm(args)`, `disable(args)`, `refresh(args)` (signature `(args) => exit code`, args from `parseArgs`). `enable` passes `{ routine: args._[0], harness: typeof args.harness === 'string' ? args.harness : undefined, flags: { project: args.project, repo: args.repo, all: args.all === true ? true : undefined }, days: args.days ? parseDays(args.days) : undefined, at: typeof args.at === 'string' ? args.at : undefined }`. With `--json` every wrapper prints its result as one JSON object instead of the lines below.
  - Codex enable prints: `✓ enabled <id> on Codex: <file>`, `  <rrule> · <model> · effort <effort>`, `  cwds: <comma list>`, then each warning as `note: <text>`.
  - Claude enable prints: `pending: <id> on Claude`, `RELAY_PROPOSAL: <JSON.stringify(proposal)>`, each warning as `note: <text>`, `next: create the scheduled task from the proposal, then: relay routine confirm <id> --task-id <proposal.taskId>`.
  - confirm: `✓ <id> is active on Claude (task <taskId>)`. disable: `✓ disabled <id>` plus `  removed <path>` (Codex) or `next: disable the scheduled task <taskId> in the Claude app (/relay:routine disable <id>)` (Claude); already disabled: `<id> is already disabled`.
  - refresh: `✓ rewrote <id>` per Codex instance; `RELAY_UPDATE: {"instance","taskId","prompt"}` per Claude instance, then `next: in a Claude desktop session run /relay:routine refresh`; nothing stale: `✓ no stale registrations`.

`test/routine-enable.test.mjs`, two tests (env `{ RELAY_HOME, HOME }`, both temp dirs; one registered `tempRepo` via `runCli(['hq', 'add', dir])`; a prompt routine from `runCli(['routine', 'new', 'tidy', '--prompt', 'Tidy up', '--kind', 'passive', '--days', 'mon,wed', '--at', '07:30'])`):
1. `enable --harness codex writes only its relay folder, and needs a harness and Codex`: with `HOME` lacking `.codex/automations`, `enable tidy --harness codex --repo <dir>` exits 1 and `enabled.json` does not exist; create `<HOME>/.codex/automations/user-thing/automation.toml`; `enable tidy --repo <dir>` (no `--harness`) exits 64; `enable tidy --harness codex --repo <dir>` exits 0; parse `relay-tidy-<key>/automation.toml` with `parseToml` (`lib/hq/toml.mjs`): `rrule === 'RRULE:FREQ=WEEKLY;BYHOUR=7;BYMINUTE=30;BYDAY=MO,WE'`, `model`/`reasoning_effort` equal `loadRouting().tiers.cheap.codex`, `cwds` contains the repo's real path, `prompt` contains `join(ROOT, 'bin', 'relay')` and `routine run tidy@`; `memory.md` exists; `disable <id>` exits 0, the relay folder is gone and `user-thing/automation.toml` is byte-identical.
2. `enable --harness claude prints the proposal and records pending until confirm`: parse the `RELAY_PROPOSAL:` line: `cronExpression === '30 7 * * 1,3'`, `taskId === 'relay-' + id.replace('@', '-')`, `prompt` contains `routine run <id>`; `enabled.json` has the instance with `registration.state === 'pending'`; `confirm <id> --task-id <taskId>` exits 0 and the state is `active` with that `taskId`.

### T4: relay routine run and note
Create `lib/routines/run.mjs` with exactly this code:

```js
// relay routine run | note: one run of an instance. The lock, the weekly cap, the check
// (or a prompt routine's text), the diff against state.json, the run record, the report
// and the bounded "For you:" block for the one judgment step.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRegistry } from '../hq/registry.mjs';
import { RELAY_ROOT } from '../routing.mjs';
import { isoWeek, localDate } from './schedule.mjs';
import { reposInScope } from './scope.mjs';
import { acquireLock, getInstance, INSTANCE_RE, latestRun, readState, reportPath, routineError, updateRun, writeRun, writeState } from './store.mjs';
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
    if (!dryRun && count >= cap) {
      const reason = `cap ${cap}/week reached`;
      record({ ...none, outcome: 'skipped', skipped: reason, findings: state.current?.length ?? 0, notes });
      return { code: 0, out: [head(id, `skipped · ${reason}`)] };
    }
    const judge = !dryRun && via !== 'hq';
    const counted = { ...state, lastRunAt: startedAt, weekRuns: { week, count: count + 1 } };

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
        if (judge) {
          judgment = 'pending';
          data = cut(result.judgmentData ?? '', template.judgment.maxInputChars);
        } else {
          judgment = 'skipped';
          text = `${text.trimEnd()}\n\n## ${template.judgment.heading ?? 'Answer'}\n\nsuggestions come with the scheduled run\n`;
        }
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
  const last = latestRun(id);
  if (!last || last.judgment !== 'pending' || !last.report) throw routineError(`no judgment is pending for ${id}`);
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
```

`--via hq` is internal (HQ Run now passes it, T9); it is not in the usage text.

`test/routine-run.test.mjs`, one test, `run stops at the weekly cap and while another run holds the lock`: set `process.env.RELAY_HOME` to a temp dir and pass the same in `env`; `runCli(['routine', 'new', 'nudge', '--prompt', 'Say hi', '--kind', 'passive'])`; fixture the instance with `updateEnabled` from `lib/routines/store.mjs`: `{ id: 'nudge@all', routine: 'nudge', harness: 'claude', scope: { all: true }, schedule: { days: DAYS, at: '09:00' }, options: {}, relayCli: join(ROOT, 'bin', 'relay'), registration: { state: 'active', taskId: 'relay-nudge-all' }, enabledAt: <ISO> }`.
- `writeState('nudge@all', { ...emptyState(), weekRuns: { week: isoWeek(new Date()), count: 6 } })`; `run nudge@all` exits 0, first line matches `/^RELAY_ROUTINE: nudge@all · 0 new · /` and the output contains `For you:` and `routine note nudge@all`.
- the next `run` prints `RELAY_ROUTINE: nudge@all · skipped · cap 7/week reached` and exits 0.
- reset the count to 0, write `<RELAY_HOME>/routines/nudge@all/lock` = `{ pid: process.pid, at: <now ISO> }`; `run` prints `RELAY_ROUTINE: nudge@all · skipped · already running`, exits 0, and the lock file is still there.

### T5: The pr-hygiene check
Create `routines/pr-hygiene.json` exactly as spec 4.1 (`id`, `title` "PR and branch hygiene", `kind` passive, `type` check, `check` pr-hygiene, `schedule` mon–fri 09:00, `options` `{ "staleDays": 3, "branchAgeDays": 14 }`, `cap` `{ "runsPerWeek": 7 }`).

Create `lib/routines/pr-hygiene.mjs` exporting `check({ repos, options, now })` (interface in Fixed names). Read-only: it runs `git` through `git(args, cwd, { allowFail: true })` from `lib/git.mjs` (returns `undefined` on failure) and `gh` through `promisify(execFile)('gh', args, { cwd, timeout: 15000, maxBuffer: 8 * 1024 * 1024 })`. Define `const shq` as in T4 for commands. `day = 86_400_000`. Per repository `r` (in order), with `rid = r.rid`, `repoName = r.name`:

1. **PR rows** (skip when `ghDown` is set):
   - `gh pr list --state open --limit 100 --json number,title,url,isDraft,reviewDecision,createdAt,updatedAt,latestReviews`.
   - `pr-stale` (key = number): not draft, `reviewDecision !== 'APPROVED'`, `now - createdAt > staleDays·day`. Text `PR #<n> waits <d>d for review: <title>`, `href` = url.
   - `pr-approved-unmerged` (key = number): `reviewDecision === 'APPROVED'`; approvedAt = latest `submittedAt` of `latestReviews` with `state === 'APPROVED'`, else `updatedAt`; `now - approvedAt > staleDays·day`. Text `PR #<n> approved <d>d ago, not merged: <title>`, href url.
   - `gh pr list --state open --limit 50 --search review-requested:@me --json number,title,url` → `review-requested` (key = number), text `PR #<n> asks for your review: <title>`, href url.
   - `<d>` = whole days, `Math.floor`.
   - Errors: `err.code === 'ENOENT'` → `ghDown = 'gh is not installed'`; stderr matching `/auth login|not logged in|authenticat/i` → `ghDown = 'gh is not signed in'`; `err.killed` or `err.signal === 'SIGTERM'` → note `<repoName>: gh timed out`; stderr matching `/no git remotes|none of the git remotes|could not determine/i` → note `<repoName>: no GitHub remote`; otherwise note `<repoName>: gh failed: <first stderr line, ≤ 120 chars>`. After any error, skip the rest of this repository's gh calls. Once `ghDown` is set, no more gh calls for any repository.
2. **Finished plans:** for each directory `<r.path>/.relay/runs/<slug>/` whose `ledger.md` has a ledger line (regex in Fixed names) with text matching `/^plan: complete\b/`:
   - `relay-branches` (key = slug): when `refs/heads/relay/<slug>/integration` exists and `git merge-base --is-ancestor relay/<slug>/integration HEAD` succeeds, list `git for-each-ref --format=%(refname:short) refs/heads/relay/<slug>/`; when non-empty, text `<n> branches of finished plan <slug>`, command `git -C <shq(path)> branch -D <branches joined by space>`.
   - `relay-worktrees` (key = slug): `git worktree list --porcelain` blocks whose `branch refs/heads/relay/<slug>/lane-…` (any lane); when any: text `<n> lane worktrees of finished plan <slug>`; command `relay worktrees clean <shq(planPath)>` when the ledger header names a plan file that exists and every worktree path (`realPath` from `lib/git.mjs`) starts with `realPath(<r.path>/.claude/worktrees)/relay-<slug>-`; otherwise `git -C <shq(path)> worktree remove <shq(wt)>` joined with ` && `.
3. **`branch-merged-old`** (key = branch name): `git for-each-ref --merged HEAD --format=%(refname:short)%09%(committerdate:unix) refs/heads/`; skip the current branch (`git rev-parse --abbrev-ref HEAD`), `relay/*`, `main`, `master`, `develop`, `trunk` and the target of `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` (without `origin/`); report when `now - unix·1000 > branchAgeDays·day`: text `<branch> is merged and <d>d old`, command `git -C <shq(path)> branch -d <shq(branch)>`.

Ids are `<rid>:<kind>:<key>`; every finding carries `repo: r.path`, `repoName`, and `href`/`command` null when absent. When `ghDown` is set, add one finding `{ id: 'gh:gh-not-connected:gh', kind: 'gh-not-connected', repo: null, repoName: 'gh', text: ghDown, href: null, command: ghDown === 'gh is not installed' ? null : 'gh auth login' }`. A throw inside one repository becomes the note `<repoName>: <message>` and the next repository runs.

`test/routine-pr-hygiene.test.mjs`, one test, `pr-hygiene reports a finished plan's leftovers once, forgets a resolved one, and reports gh once`, with env `{ RELAY_HOME, PATH: <bin dir with node and git only> }` (Global Constraints):
- `tempRepo()`; `copyFixture('plan-basic.md', dir)` (slug `billing-export`); `git branch relay/billing-export/integration`; `git worktree add -q -b relay/billing-export/lane-a <dir>/.claude/worktrees/relay-billing-export-a`; write `<dir>/.relay/runs/billing-export/ledger.md` = `# relay ledger — plan: <abs plan path>\n- 2026-10-20 10:00 start: wave 1\n- 2026-10-20 12:00 plan: complete (relay/billing-export/integration @ abc1234)\n`.
- `hq add <dir>`; `routine enable pr-hygiene --harness claude --repo <dir>`; instance id from the `pending: (\S+)` line.
- run 1: first line `· 3 new`; lines match `/branch -D .*relay\/billing-export\/lane-a/`, `/relay worktrees clean .*billing-export/` and `/gh is not installed/`.
- run 2: `nothing new`.
- `git worktree remove <wt>`; run 3: `nothing new`.
- `git worktree add -q <wt> relay/billing-export/lane-a`; run 4: `· 1 new`, the line matches `relay worktrees clean` and the output does not contain `gh is not installed`.

### T6: The weekly-report check
Create `routines/weekly-report.json`:

```json
{
  "id": "weekly-report",
  "title": "Weekly report",
  "kind": "active",
  "type": "check",
  "check": "weekly-report",
  "schedule": { "days": ["fri"], "at": "16:00" },
  "options": { "days": 7, "suggestWeeks": 4, "suggestMinRepeats": 3 },
  "judgment": {
    "tier": "cheap",
    "maxInputChars": 6000,
    "heading": "Suggested routines",
    "ask": "Propose at most 3 new relay routines (id, kind, schedule, what it checks, which repeated action it replaces) from the repeated launches below. One line each: `- <id> · <passive|active> · <days> <HH:MM> · <what it checks> · replaces <action>`, days as mon,tue,… Answer \"none\" when nothing repeats."
  },
  "cap": { "runsPerWeek": 2 }
}
```

Create `lib/routines/weekly-report.mjs` exporting `check({ repos, options, now, instance })` → `{ findings: [], notes, report, judgmentData }`. Window `since = now - options.days·day`.

**Report** (`report`, markdown):
```
# Weekly report · <localDate(now)>

<localDate(since)> – <localDate(now)>

## <project name, or Unassigned>

### <repoName>

- Plans started: <slugs or none>
- Plans completed: <slugs or none>
- Tasks green: <n>
- Lanes blocked: <"<slug> lane <id>: <note>" joined by "; " or none>
- Rulings: none | then one indented line per ruling "  - <slug>: <ledger text>"
- Pieces: none | then "  - <slug>: <ledger text>" per piece line with status findings or blocked

## Launches

| When | Action | Repository | Harness | Model | Outcome |
|---|---|---|---|---|---|

## Routines

| Instance | Opened | Resolved |
|---|---|---|
```
- Per repository: ledgers `<path>/.relay/runs/<slug>/ledger.md`, lines in the window (ledger regex, UTC): `start:` → started, `plan: complete` → completed, `Ruling:` → rulings, piece regex with `findings|blocked` → pieces.
- Tasks green: `git log --branches=relay/* --since=<since ISO> --format=%s`, count distinct subjects matching `/^T\d+[a-z]?:\s/`.
- Lanes blocked: for each `docs/relay/plans/*.md`, `boardFor(abs)` (`scripts/relay-board.mjs`); skip results with `errors`; lanes with `state === 'blocked'`.
- Launches: `listLaunches({ limit: 1000 })` (`lib/hq/launches.mjs`) with `startedAt >= since`, newest first; When = local `YYYY-MM-DD HH:MM`; Repository = `basename(repo)` or `-`; Outcome = `outcome ?? status`. Escape `|` in cells as `\|`. No launches → one row `| none | | | | | |`.
- Routines: every other instance in `listInstances()`; Opened = sum of `run.new.length`, Resolved = sum of `run.resolved.length` over its runs (`listRuns(id, { limit: 200 })`) with `startedAt >= since`.
- Repositories grouped by `project.name` (projects in registry order, `Unassigned` last); a repository section whose lists are all empty still prints with `none`.

**Judgment data** (`judgmentData`):
```
Repeated launches, last <suggestWeeks> weeks (at least <suggestMinRepeats>):
- <action>[ <skill>] · <repo basename or -> · <count>× · <"mon 09h ×3, tue 10h ×2" (local weekday and hour, most frequent first)>
Existing routines:
- template <id> (<kind>, <describeSchedule>): <title>
- instance <id> (<harness>, <describeSchedule>)
```
Launches over the last `suggestWeeks·7` days, grouped by `action|skill|repo`; skill = `/^Use the (\S+) skill\./.exec(launch.argv?.[1] ?? '')?.[1]` for `action === 'skill'`, else none; keep groups with `count >= suggestMinRepeats`, sorted by count descending; `(none)` when no group qualifies. Templates from `loadTemplates().templates`, instances from `listInstances()`. The run (T4) cuts this to `maxInputChars`.

`test/routine-weekly-report.test.mjs`, one test, `weekly-report lists the week and asks for suggestions within its limit, except from HQ Run now`:
- `RELAY_HOME` temp; `tempRepo()` + `copyFixture('plan-basic.md', dir)`; `hq add <dir> --project Polaris`; ledger `<dir>/.relay/runs/billing-export/ledger.md` with three lines stamped with the current UTC minute (`new Date().toISOString().slice(0, 16).replace('T', ' ')`): `start: wave 1`, `Ruling: kept RFC 4180 quoting — the spec says so — low`, `plan: complete (relay/billing-export/integration @ abc1234)`.
- 360 launch records in `<RELAY_HOME>/hq/launches/<id>/` (`launch.json` with `id` matching `ID_RE`, `action: 'skill'`, `repo: <dir real path>`, `harness: 'claude'`, `model: 'haiku'`, `argv: ['-p', 'Use the skill-<k> skill. go']` for k = 0…119, three per k, `startedAt` within the last 3 days, `pid: null`; `result.json` `{ status: 'done', endedAt }`).
- `routine enable weekly-report --harness claude --all`; run 1: first line matches `/· 0 new · (.+\.md)$/`; that report contains `billing-export` on the `Plans completed` line, the ruling text, and a launch row with `skill`; the output contains `For you:`, and `out.slice(out.indexOf('For you:')).length <= 6000 + ask.length + 300`.
- run 2 with `--via hq` (HQ Run now): no `For you:` in the output; the report contains `suggestions come with the scheduled run`.

### T7: relay routine list, show and history
Create `lib/routines/info.mjs`:
- `instanceView(inst, { now = new Date(), templates = loadTemplates().templates, reg = readRegistry() } = {})` → `InstanceView` (HQ API shapes). `title` from the template (else `inst.routine`); `stalePath = !existsSync(inst.relayCli)`; `nextRun` = `nextRun(inst.schedule, now).toISOString()` only when `registration.state === 'active'`; `cap = template?.cap?.runsPerWeek ?? DEFAULT_CAP`; `weekRuns` from `readState(id).state.weekRuns` when its week is `isoWeek(now)`, else 0; `lastRun` from `latestRun(id)` (`new` = `run.new.length`); `open` = `state.current` minus `state.dismissed`; `codexPath`/`taskId` from `registration` or null. Never throws for a damaged state file (readState handles it); a missing template gives `title: inst.routine, kind: null, type: null`.
- `list(args)`: prints `templates:` then one line per template `  <id>  <kind>  <type>  <scheduleText>  <title>` (custom ones end with `  (yours)`), then `instances:` and one line per instance `  <id>  <harness>  <state>  <scheduleText>  next <local "ddd DD MMM HH:MM" or ->  last <outcome or ->  <weekRuns>/<cap> this week` plus `  stale path` when `stalePath`. No instances: `instances: none (relay routine enable <routine> --harness claude|codex …)`. `--json` prints `{ templates, instances: [InstanceView] }`.
- `show(args)`: an id with `@` → the instance: its `InstanceView` fields one per line, then `findings:` with `findingLine` (T4 shape, written locally) for `state.current`, then `report: <latest report path>` when any; otherwise the template's JSON and the ids of its instances. `--json` prints `{ instance: InstanceView, template }` or `{ template, instances: [id] }`. Unknown → routineError, exit 1.
- `history(args)`: `listRuns(id, { limit: 20 })`, one line each: `<local YYYY-MM-DD HH:MM>  <outcome>  <new.length> new  <skipped or error or ->` and `  report <path>` when present. No runs: `no runs yet`.

No new test: `instanceView` is exercised by T9's HQ test (next run) and the outputs are covered by the CLI shapes above.

### T8: The /relay:routine command and the README
Create `commands/routine.md` exactly (if T1 recorded different scheduled-tasks tool names, use those in `allowed-tools` and the text):

```markdown
---
description: Enable, disable or refresh a relay routine as a Claude desktop scheduled task.
argument-hint: "enable <routine> (--project <id> | --repo <path> | --all) [--days mon,…] [--at HH:MM] | disable <instance> | refresh"
allowed-tools: Bash(relay routine*), mcp__scheduled-tasks__create_scheduled_task, mcp__scheduled-tasks__update_scheduled_task, mcp__scheduled-tasks__list_scheduled_tasks
disable-model-invocation: true
---
Arguments: `$ARGUMENTS`. `relay` is on your PATH; run it by name. Show every relay output unchanged, in a code block.

First check that you have the scheduled-tasks tool. If you do not, reply with exactly one line, `Scheduled tasks need the Claude desktop app: run /relay:routine $ARGUMENTS in a desktop session.`, and stop; a pending routine stays pending.

**enable**: run `relay routine enable <the rest of the arguments> --harness claude`. If it exits non-zero, stop. The instance id is on the `pending:` line. Call the scheduled-tasks create call with exactly the `taskId`, `title`, `description`, `prompt` and `cronExpression` of the JSON after `RELAY_PROPOSAL: `. When it succeeds, run `relay routine confirm <instance> --task-id <the id of the created task>`. Reply with one line: the instance, its schedule, and that it runs while the app is open.

**disable**: run `relay routine show <instance> --json` and take `instance.taskId`. When it is set, disable that task with the scheduled-tasks update call (`enabled: false`). Then run `relay routine disable <instance>`. Reply with one line.

**refresh**: run `relay routine refresh`. For each `RELAY_UPDATE: ` line, call the scheduled-tasks update call with its `taskId` and `prompt`, then run `relay routine confirm <instance> --task-id <taskId>`. Reply with one line: how many tasks were refreshed.

Do nothing else.
```

`README.md`: add a `## Routines` section after the HQ section (find it with `grep -n '^## ' README.md`), exactly:

```markdown
## Routines

Scheduled engineering checks, run by the harness you choose. The checks are relay CLI work at zero tokens; the one judgment step uses the cheap tier on bounded data.

| Routine | Kind | Default schedule | What it does |
|---|---|---|---|
| `pr-hygiene` | passive | mon-fri 09:00 | stale PRs, review requests, approved but unmerged PRs, leftover relay branches and lane worktrees, old merged branches; only what is new, with the command to run |
| `weekly-report` | active | fri 16:00 | the week across projects: plans, green tasks, rulings, blocked lanes, pieces, launches; up to three suggested routines |

    relay routine enable pr-hygiene --harness codex --project polaris
    /relay:routine enable weekly-report --all              # in the Claude desktop app
    relay routine list
    relay routine new standup-notes --prompt "Summarise yesterday's merged PRs" --kind active --days mon --at 08:30

On Codex, relay writes `~/.codex/automations/relay-<instance>/` and nothing else there. On Claude, `/relay:routine` creates a desktop scheduled task: it runs while the app is open, on the app's default model. Routines never delete, close, comment or push. Caps: runs per week, and the judgment step's data cut to `maxInputChars`. HQ → Routines shows the week, findings, reports and an Enable dialog.
```

### T9: HQ data, routes and Run now
Create `lib/hq/routines.mjs` (shapes in "HQ API shapes"):
- `routinesOverview({ now = new Date() } = {})`: `instanceView` (T7) per instance plus `project` (when `scope.project`, from the registry), `slots = weekSlots(schedule, now)` as ISO, `runs` = this week's runs (`listRuns(id, { limit: 100 })` with `startedAt >= weekStart(now)`) as `{ at: startedAt, outcome }`, `pendingCommand = claudeCommand(routine, scope, schedule)` (T3) for a pending Claude instance, else null. `templates` from `loadTemplates().templates` (`check` null for prompt, `judgment: Boolean(t.judgment)`). `scopes` from the registry (non-hidden repos as `{ rid: ridOf(path), name }`). `codex.installed = codexInstalled()`.
- `routineDetail(id, { now })`: 404 (`routineError(…, { status: 404 })`) for an unknown instance; `findings` = `state.current` with `firstSeenAt = state.seen[f.id]`, `isNew = firstSeenAt === state.lastRunAt`, `dismissed = Object.hasOwn(state.dismissed, f.id)`, sorted new first then by `firstSeenAt` descending; `runs` = `listRuns(id, { limit: 50 })` without `file`; `reports` = `listReports(id, { limit: 10 })` each with `text` (first 200 000 characters); `suggestions` only for routine `weekly-report`: from the newest report's `## Suggested routines` section, every line matching `SUGGESTION_RE` → `{ id, kind, days, at, what, replaces: replaces ?? null, command: "relay routine new <id> --kind <kind> --days <days> --at <at> --prompt <shq(what)>" }` (at most 3).
- `dismissFinding(id, findingId)`: 400 unless `findingId` is a string; `acquireLock(id)`; null → 409 `a run is going; try again`; else set `state.dismissed[findingId] = now ISO` only when the finding is in `state.current` (404 otherwise), write, release in `finally`.
- `previewEnable(body)` / `enableFromHq(body)`: read only `routine`, `harness`, `scope`, `project`, `rid`, `days`, `at`, `confirm`. Flags: `scope === 'project'` → `{ project }`; `'repo'` → `{ repo: <registry path of rid> }` (400 `unknown repository`); `'all'` → `{ all: true }`; `days` must be an array of `DAYS`. A missing or unknown `harness` is the error `choose a harness`. Preview calls `enableInstance({ …, write: false })` and returns `{ instance, codex: { path: <file with ~ for home>, model, effort, rrule, cwds } | null, claude: { command: claudeCommand(…) } | null, errors: [] }`, or on error `{ instance: null, codex: null, claude: null, errors: [message] }`. `enableFromHq` needs `confirm === true` (400), `harness === 'codex'` (400 `Claude routines are created from a Claude desktop session: <command>`), then `enableInstance({ …, write: true })` → `{ ok: true, instance: id }`.
- `disableFromHq(id)`: Codex → `disableInstance(id)` → `{ ok: true, removed }`; Claude → 400 `run /relay:routine disable <id> in the Claude desktop app`.
- `routineAttention()`: for every non-disabled passive instance, each finding in `state.current` not dismissed → the attention item shape. `routineEvents({ now })`: run records of the last 14 days of every instance → activity events; summary `<n> new` | `nothing new` | `report` | `skipped (<reason>)` | `failed: <error>`.

`lib/hq/launch.mjs` (the `routine` action, run like `setup-codex`, without a model):
- `ACTIONS` gains `'routine'`; `normalizeIntent` adds `instance: str(raw?.instance) || undefined`.
- `evaluateGuards`: the repository check is skipped for `routine`; `const cliOnly = i.action === 'setup-codex' || i.action === 'routine'` replaces `i.action !== 'setup-codex'` in the claude/codex binary checks and the model/effort/mode block; for `routine`: `INSTANCE_RE` must match and `getInstance` find it (`unknown routine instance`), not `disabled` (`the routine is disabled`), template type `check` (`a prompt routine runs only on its harness`); a throw from reading `enabled.json` becomes that error's message.
- `buildCommand`: `if (i.action === 'routine') return { bin: process.execPath, argv: [relayBin, 'routine', 'run', i.instance, '--via', 'hq'], cwd: homedir(), env: vars };` before `promptFor`.

`lib/hq/server.mjs`: with `const INSTANCE = '([a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9._-]*)'` add routes `GET /api/routines`, `GET /api/routines/<INSTANCE>`, `POST /api/routines/preview`, `POST /api/routines`, `POST /api/routines/<INSTANCE>/run` (`startFromIntent({ action: 'routine', instance: m[1], confirm: true })`, launch through `cleanLaunch`), `POST /api/routines/<INSTANCE>/dismiss` (`body.finding`), `POST /api/routines/<INSTANCE>/disable`. In `home()`: `attention` also gets `routineAttention()` before the sort; `activity` = `activityFor(…)` plus `routineEvents()`, sorted by `at` descending, first 100. Both routine calls are wrapped so an error contributes `[]`.

`test/hq-server.test.mjs`: one new test, `the routines API lists instances with their next run, Run now runs the check, and a new passive finding reaches Home`: `process.env.RELAY_HOME` temp and `process.env.PATH` = bin dir with node and git only (restore `PATH` in `finally`); `tempRepo()` + `addRepo(dir)`; `runCli(['routine', 'enable', 'pr-hygiene', '--harness', 'claude', '--repo', dir])` and `confirm <id> --task-id relay-x` with the same env; server on port 0; `GET /api/routines` lists the instance with `nextRun` an ISO time after now; `POST /api/routines/<id>/run` (JSON `{}`) → 200 with `launch.id`; poll `GET /api/launches/<launch id>` every 200 ms (≤ 15 s) until `status !== 'running'`, expect `done`; `GET /api/routines/<id>` has one run and a finding of kind `gh-not-connected`; `GET /api/home` attention has an item with `kind === 'routine'` and text `gh is not installed`.

### T10: HQ Routines page, instance page and the Enable dialog
`lib/hq/ui/routines.js` exports `renderRoutines(main, {}, ctx)` and `renderRoutine(main, { id }, ctx)`, each returning `{ poll: true }`; API paths and hash routes use the instance id unencoded (it is URL-safe).

Routines page (`GET /api/routines`): `h1` Routines and an `Enable` button (dialog, no routine preselected). Filters `All`, `Passive`, `Active`, `Pending` (`aria-pressed`, state kept in a module variable). **Week grid**: seven day columns (`Mon 20` …), one row per instance with its title and scope; in its cell per day a marker for each slot (time `HH:MM` plus a harness badge `Claude`/`Codex`), the slot equal to `nextRun` gets class `next`; each run this week a dot: `nothing-new`/`report` grey, `new` amber, `failed` red, `skipped` hollow, `title` = outcome. **Instances** (cards): project avatar when `project`, title · scope label; tags harness, state (pending amber), `scheduleText`, next run (local), `needs the app open` on Claude, `stale path` (red) when `stalePath`; last result and `ago`, `<open> open`, `<weekRuns>/<cap> this week`; buttons `Run now` (POST run → `ctx.navigate('#/launches/<id>')`; disabled for prompt routines and disabled instances), `Disable` (Codex: `confirm()` then POST disable and refresh; Claude: copy button with `/relay:routine disable <id>`), `History` (link `#/routines/<id>`); a pending Claude instance shows `pendingCommand` in `<code>` with a copy button. **Templates**: one card per template (title, kind, `scheduleText`, `prompt` tag when custom) with `Enable` (dialog preselected).

Instance page (`GET /api/routines/<id>`): `h1` title · scope; the same meta row and buttons; **Findings** new first: `new` amber tag when `isNew && !dismissed`, text, `link(href, 'Open')` for https hrefs, the command in `<code>` with a copy button, `Dismiss` (POST dismiss → refresh) unless dismissed (then muted); **History** table: started, outcome light, new count, skipped/error, notes; **Reports** (active): newest open via `renderReport`, older in `<details>`; **Suggestions** (weekly-report): each with `what`, schedule, and `copyButton('Copy command', s.command)`. Empty states: `No findings.`, `No runs yet.`, `No reports yet.`

`lib/hq/ui/report.js` exports `renderReport(text)` → element (class `report`), built only with `h()`: `#`/`##`/`###` → `h2`/`h3`/`h4`; `- `/`* ` lists (two-space indent nests one level); `1. ` ordered lists; pipe tables (header row, `|---|` separator, body; `\|` is a literal bar); fenced ``` blocks → `pre > code`; inline `` `code` ``; `[text](url)` and bare URLs become `link()` only when `url` starts with `https://`, else plain text; other lines are paragraphs. Never `innerHTML`.

`lib/hq/ui/routine-dialog.js` exports `openRoutineDialog({ templates, scopes, routine, onDone })` in the shared `#launch` dialog (like `add-dialog.js`): routine select; harness radios `Claude` and `Codex`, neither checked; scope select `Project` / `Repository` / `All repositories` with a second select for the project or repository; seven day checkboxes and `<input type="time">`, both prefilled from the template; an effect panel refreshed by `POST /api/routines/preview` 200 ms after each change: Codex → path, model · effort, rrule; Claude → the command in `<code>` with `copyButton('Copy', command)`; errors listed. `Enable` (primary) shows only for Codex with no errors: `POST /api/routines` with `confirm: true` → close → `onDone()`. `Cancel` closes.

`lib/hq/ui/app.css`: classes `.week` (8-column grid: label + 7 days), `.week .slot`, `.week .slot.next` (accent border), `.run-dot` with `.grey`/`.amber`/`.red`/`.hollow` (do not reuse `.dot`, taken by activity), `.harness`, `.finding`, `.report` (headings, lists, `table`, `pre`, `code`), using the existing tokens only (`--yellow`, `--red`, `--grey`, `--line`, `--card`, `--accent-ink`, …) so dark and light both work.

### T11: HQ navigation, routes and Home items
Edit `lib/hq/ui/app.js` exactly:
1. `KIND` gains `'routine': ['routine', 'y'],`.
2. `parseRoute`, before the final `return { name: 'home' };`: `if (parts[0] === 'routines') return parts[1] ? { name: 'routine', id: parts[1] } : { name: 'routines' };`
3. `refreshChrome`: in `here`, before the final `: ''`, add `: r.name === 'routines' || r.name === 'routine' ? 'routines'`; the nav becomes `tab('home', '#/', 'Home'), tab('projects', '#/projects', 'Projects'), tab('brain', '#/brain', 'Brain'), tab('routines', '#/routines', 'Routines'), tab('launches', '#/launches', 'Launches')`.
4. `attentionRow`: replace its first line with `const [kindLabel, sev] = KIND[a.kind] ?? [a.kind, 'r']; const label = a.kind === 'routine' && a.label ? a.label : kindLabel;`.
5. `route()`, after the `brain` branch:
```js
    } else if (r.name === 'routines') {
      ctx.crumbs([['Home', '#/'], ['Routines']]);
      out = await lazy('./routines.js', (m) => m.renderRoutines(main, {}, ctx));
    } else if (r.name === 'routine') {
      ctx.crumbs([['Home', '#/'], ['Routines', '#/routines'], [r.id]]);
      out = await lazy('./routines.js', (m) => m.renderRoutine(main, { id: r.id }, ctx));
    }
```
6. The header comment's second line becomes `// launches views. Plan, Brain and Routines views are loaded on demand from plan.js, brain.js and routines.js.`

```relay-plan
{
  "slug": "relay-routines",
  "flow": "feature",
  "suite": "npm test",
  "tasks": [
    {
      "id": "T1", "title": "Verify the Codex automation format and the Claude scheduled-tasks tool", "tier": "cheap", "code": "prose", "risk": "low",
      "files": ["docs/relay/notes/2026-10-21-routines-facts.md"], "deps": [],
      "behaviors": ["the observed Codex automation fields and what is unverifiable here are recorded as rules later tasks follow"],
      "tests": 0,
      "done": "test -s docs/relay/notes/2026-10-21-routines-facts.md && grep -q '^## Rules for later tasks' docs/relay/notes/2026-10-21-routines-facts.md"
    },
    {
      "id": "T2", "title": "Routine core: schedules, templates, store, scopes, the CLI entry and the build check", "tier": "mid", "code": "complete", "risk": "medium",
      "files": ["lib/routines/schedule.mjs", "lib/routines/templates.mjs", "lib/routines/store.mjs", "lib/routines/scope.mjs", "scripts/relay-routine.mjs", "bin/relay", "scripts/build.mjs", "test/build.test.mjs"], "deps": [],
      "behaviors": ["relay build --check fails for a routine template with an unknown check module", "relay build --check fails for a template with days or time out of range, an unknown key or an unknown judgment tier", "relay routine new writes a prompt routine with a 7-per-week cap"],
      "tests": 0,
      "done": "node --test test/build.test.mjs && node bin/relay build --check && h=$(mktemp -d) && RELAY_HOME=$h node bin/relay routine new demo --prompt hi --kind passive && test -f $h/routines/custom/demo.json"
    },
    {
      "id": "T3", "title": "Enable on Codex or Claude; confirm, disable, refresh", "tier": "mid", "code": "prose", "risk": "high",
      "files": ["lib/routines/codex.mjs", "lib/routines/enable.mjs", "test/routine-enable.test.mjs"], "deps": ["T1", "T2"],
      "behaviors": ["enable --harness codex writes relay-<slug>/automation.toml with the rrule, the codex model and effort of the tier, the scope's cwds and the absolute relay path in the prompt", "disable removes only that relay-* folder; other automations are untouched", "enable without --harness exits 64; without ~/.codex/automations it writes nothing", "enable --harness claude prints the proposal with a local cron and records pending; confirm --task-id makes it active", "refresh rewrites stale Codex registrations and prints the update for stale Claude tasks"],
      "tests": 2,
      "done": "node --test test/routine-enable.test.mjs"
    },
    {
      "id": "T4", "title": "relay routine run and note", "tier": "mid", "code": "complete", "risk": "high",
      "files": ["lib/routines/run.mjs", "test/routine-run.test.mjs"], "deps": ["T2"],
      "behaviors": ["run prints a fixed first line, at most 20 new findings and the For you block", "run beyond cap.runsPerWeek in the ISO week prints skipped · cap n/week reached, exit 0", "a run while the lock is held prints already running, exit 0", "only findings not in seen are new; resolved ones leave seen", "the judgment block is left out only for HQ Run now, and the report says suggestions come with the scheduled run", "note appends the answer to the latest report and exits 1 when nothing is pending"],
      "tests": 1,
      "done": "node --test test/routine-run.test.mjs"
    },
    {
      "id": "T5", "title": "The pr-hygiene check", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["routines/pr-hygiene.json", "lib/routines/pr-hygiene.mjs", "test/routine-pr-hygiene.test.mjs"], "deps": ["T3", "T4"],
      "behaviors": ["reports relay-branches and relay-worktrees of a finished, merged plan with the exact commands", "a second run prints nothing new; a resolved finding counts as new when it returns", "without gh, one gh-not-connected finding is reported once", "stale, review-requested and approved-unmerged PRs and old merged branches are reported with links or commands; nothing is changed"],
      "tests": 1,
      "done": "node --test test/routine-pr-hygiene.test.mjs && node bin/relay build --check"
    },
    {
      "id": "T6", "title": "The weekly-report check", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["routines/weekly-report.json", "lib/routines/weekly-report.mjs", "test/routine-weekly-report.test.mjs"], "deps": ["T3", "T4"],
      "behaviors": ["the report lists plans started and completed, green tasks, rulings, blocked lanes, pieces, launches and other routines' findings by project and repository", "the For you block holds repeated launches and existing routines cut to maxInputChars, except from HQ Run now"],
      "tests": 1,
      "done": "node --test test/routine-weekly-report.test.mjs && node bin/relay build --check"
    },
    {
      "id": "T7", "title": "relay routine list, show and history", "tier": "mid", "code": "prose", "risk": "low",
      "files": ["lib/routines/info.mjs"], "deps": ["T2"],
      "behaviors": ["list shows templates and instances with harness, schedule, next run, last result and stale path", "show and history print one instance's findings and runs; --json for the command and HQ"],
      "tests": 0,
      "done": "node --check lib/routines/info.mjs && RELAY_HOME=$(mktemp -d) node bin/relay routine list"
    },
    {
      "id": "T8", "title": "The /relay:routine command and the README", "tier": "cheap", "code": "complete", "risk": "low",
      "files": ["commands/routine.md", "README.md"], "deps": ["T1", "T3", "T7"],
      "behaviors": ["/relay:routine enable creates the Claude scheduled task from the proposal and confirms it", "/relay:routine stops with one line when the session has no scheduled-tasks tool"],
      "tests": 0,
      "done": "claude plugin validate . && grep -q 'relay routine enable' README.md"
    },
    {
      "id": "T9", "title": "HQ data, routes and Run now", "tier": "mid", "code": "prose", "risk": "high",
      "files": ["lib/hq/routines.mjs", "lib/hq/server.mjs", "lib/hq/launch.mjs", "test/hq-server.test.mjs"], "deps": ["T3", "T5", "T7"],
      "tags": ["api"],
      "behaviors": ["the routines API lists instances with their next run, this week's slots and runs", "Run now runs relay routine run through the launch machinery, without the judgment block", "a new passive finding appears in /api/home attention until dismissed or resolved; routine runs appear in Activity", "the Enable POST writes Codex registrations only, after a preview"],
      "tests": 1,
      "done": "node --test test/hq-server.test.mjs test/hq-launch.test.mjs"
    },
    {
      "id": "T10", "title": "HQ Routines page, instance page and the Enable dialog", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/ui/routines.js", "lib/hq/ui/routine-dialog.js", "lib/hq/ui/report.js", "lib/hq/ui/app.css"], "deps": ["T9"],
      "tags": ["ui"],
      "behaviors": ["the week grid shows slots with harness badges, this week's runs as coloured dots and the next run", "instances show harness, schedule, next run, last result, cap use, Run now, Disable and History", "the instance page lists findings new first with Dismiss, the history, safe-rendered reports and suggestion copy buttons", "the Enable dialog preselects no harness and shows the exact effect before confirming"],
      "tests": 0,
      "done": "node --check lib/hq/ui/routines.js && node --check lib/hq/ui/routine-dialog.js && node --check lib/hq/ui/report.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "T11", "title": "HQ navigation, routes and Home items", "tier": "cheap", "code": "complete", "risk": "medium",
      "files": ["lib/hq/ui/app.js"], "deps": ["T9"],
      "tags": ["ui"],
      "behaviors": ["the top navigation reads Home · Projects · Brain · Routines · Launches", "Waiting on you shows routine findings in amber with the routine name"],
      "tests": 0,
      "done": "node --check lib/hq/ui/app.js && node --test test/hq-server.test.mjs"
    }
  ]
}
```
