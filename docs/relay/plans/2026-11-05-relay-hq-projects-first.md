# Relay HQ Projects First Plan

**Goal:** Make relay HQ a projects-first page set where every page is for acting or watching: All and project pages with Needs you actions, Running cards, Ready to merge with Open PR and Merge locally, a full Run page, and a Setup page.
**Spec:** docs/relay/specs/2026-11-05-relay-hq-projects-first.md (approved 2026-11-05; amends docs/relay/specs/2026-10-22-relay-hq-ux.md)
**Design:** docs/relay/mockups/hq-projects-first.html (branch relay-hq-sync @ 09f6297)
**Architecture:** New server modules carry the new actions, each in its own file so lanes run in parallel: `lib/hq/review.mjs` (review summary), `lib/hq/answer.mjs`, `lib/hq/merge.mjs`, `lib/hq/pr.mjs`, `lib/hq/overview.mjs` (overview, sidebar, run extras). Retry lives in `lib/hq/launch.mjs` and `lib/hq/launches.mjs`. One task wires every new route into `lib/hq/server.mjs`. The UI gets a pure route table (`lib/hq/ui/routes.js`, testable in Node), a new chrome in `app.js`, and one module per page (`overview.js`, `plan.js` as the Run page, `setup.js`); each view loads its own stylesheet through a new `useStyle` helper, so view tasks do not share `app.css`.

## Global Constraints

- No dependencies. Node ≥ 20. The CLI is `node scripts/relay.mjs`.
- Protected tests cannot change: `test/hq-server.test.mjs`, `test/hq-home.test.mjs`, `test/hq-recos*.test.mjs`, `test/hq-plans-merged.test.mjs`, `test/hq-deck.test.mjs`, `test/recos-fixture.mjs` and the others in `.relay/protected-tests.txt`. Keep every endpoint they call: `/api/home` (with `ring`, `today`, `running`, `attention`, `projects`), `/api/projects/:id`, `/api/plans`, `/api/plans/merged`, `/api/recos*`, `/api/routines*`, `/api/launches*`, `/api/registry`, `/api/open`. Remove only UI.
- `test/hq-server.test.mjs` checks that every `from './x'` import of a `lib/hq/ui/*.js` file and every `src`/`href` in `index.html` is served, and that no UI file except `dom.js` calls `.append(` or `.replaceChildren(`. A deleted UI file must have no remaining static importer. Render text only: no `innerHTML`.
- Every new endpoint takes ids (`rid`, `slug`, launch id), never commands or paths. The global gate (Host, Origin, token, JSON Content-Type) applies to all `/api/*`; do not bypass it.
- Open PR and Merge locally act only with `confirm: true` in the body. Without it, the same endpoint returns `{ preview }` and changes nothing. The UI shows the preview in a confirmation dialog first.
- Error responses keep the existing shape `{ error }` plus optional `guards`, `refused` and (new) `conflicts`. Status codes: 400 bad input, 404 unknown id, 409 refused by state, 502 an external tool (git push, gh) failed.
- Ledger lines written by HQ, exactly: `Ruling: <text> (from HQ)` and `plan: merged (merged locally in HQ into <branch> @ <short sha>)`. User text is collapsed to one line (`text.replace(/\s+/g, ' ').trim()`) before it is written.
- gh is `env.RELAY_GH_BIN` when set, else `gh` on `PATH` (`onPath` from `lib/hq/sources.mjs`).
- Old routes redirect: `#/plans`, `#/projects`, `#/recos`, `#/launches`, `#/activity` and unknown routes → `#/` (All). `#/brain/<tab>` → `#/setup/<tab>`. `#/routines` → `#/setup/routines`. `#/launches/<id>` (a launch log) and `#/routines/<id>` (a routine's history) stay.
- Setup tab ids and labels, in order: `team` Team, `flows` Flows, `skills` Skills, `connectors` Connectors, `keys` API keys, `routines` Routines, `repos` Repositories.
- HQ UI copy: no explanatory or teaching text on the pages. Labels, counts and actions only.
- Tests use real git repositories (`test/helpers.mjs` `tempRepo`, `copyFixture`, `runCli`) and a temp `RELAY_HOME`. Call functions with the path `addRepo(dir)` returns (the registry key), not the `tempRepo` symlink. Follow `skills/qa-mindset`: test behavior, not implementation.
- Before finishing the branch: `npm test` and `node scripts/relay.mjs build --check`.

## Review Focus

- Answer and resume must not write the ledger when it refuses (not blocked, run live, budget critical, bad text). A newline in the answer must not create a second ledger entry.
- Merge locally on a conflict: no `MERGE_HEAD`, same `HEAD`, clean tracked tree afterwards. It never pushes.
- Open PR pushes only `relay/<slug>/integration` to `origin`, never the current branch. `GIT_TERMINAL_PROMPT=0` so a credential prompt cannot hang the server.
- Retry replays the stored intent, including `confirmDangerous`. Only failed or lost launches are retryable. The stored intent must not leak through `GET /api/launches*` (it is stripped from the public launch object).
- The marathon-blocked resume rule in `runState` must not let a second run start while a terminal run writes the ledger (it only applies when no non-ruling ledger line is newer than the marathon's `endedAt`).
- Sidebar counts are derived from the same `overviewFor(reg, 'all')` items the pages show; check that no code path counts items a page does not list.
- A plan card is in exactly one of Running, Ready to merge, Finished. Needs you lists items, not plans.
- No UI file still imports a deleted module; `#/` with the token hash still lands on All after `captureToken`.

## Tasks

### B1: Review summary and repo exports

1. In `lib/hq/repo.mjs`, add `export` to the existing functions `planFileOf(path, slug)` and `integrationState(path, board)`. Change nothing else in that file.
2. Create `lib/hq/review.mjs` with exactly this code:

```js
// What a finished plan leaves for its review: tests added and removed (from the lane
// reports), rulings, deferred findings, the merged waves with the last suite result, and
// the final review. Read-only.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LEDGER_LINE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?: \[[^\]]*\])? (.*)$/;
const TESTS_LINE = /\btests:\s*\+(\d+)\s*[-−](\d+)/;
const DEFERRED = /\bdeferred(?: minors?)?:\s*(.+)$/i;
const WAVE_MERGED = /^wave \d+: merged\b/;
const MAX_TEXT = 20000;

// [{ at: 'YYYY-MM-DD HH:MM' (UTC), text }] of a run directory's ledger, oldest first.
export function ledgerOf(dir) {
  const path = join(dir, 'ledger.md');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => LEDGER_LINE.exec(l))
    .filter(Boolean)
    .map((m) => ({ at: m[1], text: m[2] }));
}

// { added, removed } summed over lane-<id>.report.md, the last "tests: +N -M" line of each; null when no report has one.
export function testsOf(dir) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => /^lane-[a-z]+\.report\.md$/.test(f));
  } catch {
    return null;
  }
  let found = false;
  let added = 0;
  let removed = 0;
  for (const f of files) {
    const last = readFileSync(join(dir, f), 'utf8').split('\n').map((l) => TESTS_LINE.exec(l)).filter(Boolean).pop();
    if (!last) continue;
    found = true;
    added += Number(last[1]);
    removed += Number(last[2]);
  }
  return found ? { added, removed } : null;
}

export function reviewOf(board, dir) {
  const entries = ledgerOf(dir);
  const deferred = entries.map((e) => DEFERRED.exec(e.text)?.[1]?.trim()).filter(Boolean);
  const waves = entries.filter((e) => WAVE_MERGED.test(e.text)).map((e) => e.text);
  const last = waves[waves.length - 1];
  const final = join(dir, 'final.findings.md');
  return {
    tests: testsOf(dir),
    rulings: board.rulings ?? [],
    deferred,
    openFindings: deferred.length,
    waves,
    suite: last ? (/suite fail/i.test(last) ? 'fail' : 'pass') : null,
    finalFindings: existsSync(final) ? readFileSync(final, 'utf8').slice(0, MAX_TEXT) : null,
    reports: ['final.review.md', 'final.findings.md'].map((f) => join(dir, f)).filter((p) => existsSync(p)),
  };
}
```

3. Create `test/hq-review.test.mjs` with one test. Make a temp run directory with `lane-a.report.md` (`tests: +3 -1` then later `tests: +4 -1`), `lane-b.report.md` (`tests: +2 -0`), `lane-c.report.md` (no tests line) and a `ledger.md` with lines `- 2026-11-05 10:00 wave 1: merged @ abc, suite pass`, `- 2026-11-05 10:05 deferred minor: rename x`, `- 2026-11-05 10:06 deferred: security-review: weak hash`, `- 2026-11-05 10:10 wave 2: merged @ def, suite fail`. Assert `reviewOf({ rulings: ['r1'] }, dir)` gives `tests` `{ added: 6, removed: 1 }`, `deferred` with both texts, `openFindings` 2, `suite` `'fail'`, two `waves`, `rulings` `['r1']`, `finalFindings` null. A plain temp directory is right here: the module reads files only.

### B2: Retry with stored intents

In `lib/hq/launches.mjs`:
- `startLaunch(spec)`: add `intent: spec.intent ?? null` to the record written to `launch.json`.
- Add `const REBUILDABLE = ['run', 'connectors', 'setup-codex'];`.
- `getLaunch(id)`: destructure `const { env, intent, ...pub } = launch;` so the intent is never public, and add `retryable: (status === 'failed' || status === 'lost') && (Boolean(intent) || REBUILDABLE.includes(launch.action))` to the returned object.
- Add and export `storedIntent(id)`: read `launch.json`; return its `intent` when present; else, for an action in `REBUILDABLE`, return `{ action, repo, plan, harness, model, effort, permissionMode }` from the record with null values dropped; else `undefined`.

In `lib/hq/launch.mjs`:
- Add and export:

```js
const RETRY_KEYS = ['action', 'repo', 'plan', 'goal', 'flow', 'businessDocs', 'skill', 'prompt', 'hours', 'harness', 'model', 'effort', 'permissionMode', 'confirmDangerous', 'instance'];
export const storedIntentOf = (i) => Object.fromEntries(RETRY_KEYS.filter((k) => i[k] !== undefined && i[k] !== '').map((k) => [k, i[k]]));

export function retryLaunch(id, ctx = {}) {
  const l = getLaunch(id);
  if (!l) throw fail(404, 'unknown launch');
  if (l.status !== 'failed' && l.status !== 'lost') throw fail(409, `only a failed or lost launch can be retried; this one is ${l.status}`);
  const intent = storedIntent(id);
  if (!intent) throw fail(409, 'this launch has no stored intent');
  return startFromIntent({ ...intent, confirm: true }, ctx);
}
```

- Import `getLaunch` and `storedIntent` from `./launches.mjs`.
- `startFromIntent`: pass `intent: storedIntentOf(i)` to `startLaunch` (after `prepare`, so `i.plan` is already repository-relative).
- `runState`: a marathon that ended blocked is resumable. Replace `if (r.board?.status === 'blocked') return { resume: true };` with:

```js
  const marathonBlocked = Boolean(marathon?.endedAt && String(marathon.stopReason ?? '').startsWith('blocked'))
    && entries.filter((e) => !/^Ruling:/i.test(e.text)).every((e) => !(e.at > Date.parse(marathon.endedAt)));
  if (r.board?.status === 'blocked' || marathonBlocked) return { resume: true };
```

Create `test/hq-retry.test.mjs` (temp `RELAY_HOME`, `RELAY_CLAUDE_BIN` = `test/fixtures/stub-harness.mjs` after `chmodSync(STUB, 0o755)`, registered repo with `plan-basic.md`):
1. Retry: write a launch directory by hand under `<RELAY_HOME>/hq/launches/20260101-000000-abcd/` with `launch.json` (`action: 'skill'`, `repo`, `harness: 'claude'`, `pid: null`, `startedAt`, `intent: { action: 'skill', repo, skill: 'qa-mindset', prompt: 'check lane b', harness: 'claude' }`) and `result.json` `{ status: 'failed', exitCode: 1, endedAt }`. `retryLaunch(id, { env })` returns a new launch whose `launch.json` `intent` deep-equals the stored intent. A second hand-made launch with `result.json` status `done` is refused with status 409. A running launch (`startLaunch` with `env: { STUB_SLEEP_MS: '60000' }`) is refused with 409; stop it in `finally`. `getLaunch` output has no `intent` key.
2. Marathon-blocked resume: ledger `start: …`, then write `<runDir>/marathon.json` `{ endedAt: <now ISO>, stopReason: 'blocked: needs a decision', pid: 0 }`; `evaluateGuards(normalizeIntent({ action: 'run', repo, plan, harness: 'claude' }), { env })` has no errors and `resume: true`. Check: the ledger `start:` line must be at or before `endedAt` (write `endedAt` a minute after the ledger line). Then append a non-ruling ledger line stamped after `endedAt` and assert the guard refuses with "already running".

### B3: Answer and resume

Create `lib/hq/answer.mjs`:

```js
// Answer and resume: the human's answer to a blocked plan becomes a ruling in its ledger,
// then HQ starts the run, which resumes from the ledger. Refusals write nothing.

import { relative, sep } from 'node:path';
import { boardFor } from '../../scripts/relay-board.mjs';
import { appendLedger } from '../../scripts/relay-ledger.mjs';
import { previewLaunch, startFromIntent } from './launch.mjs';
import { listLaunches } from './launches.mjs';
import { clearRepoCache, planFileOf } from './repo.mjs';

const MAX_TEXT = 4000;
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export function isBlocked(board) {
  const m = board.marathon;
  return board.status === 'blocked' || Boolean(m?.endedAt && String(m.stopReason ?? '').startsWith('blocked'));
}

export function answerPlan(path, slug, text, ctx = {}) {
  const ruling = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (ruling.length < 1 || ruling.length > MAX_TEXT) throw fail(400, `the answer must be 1 to ${MAX_TEXT} characters`);
  const abs = planFileOf(path, slug);
  const r = boardFor(abs);
  if (r.errors) throw fail(409, r.errors.join('; '));
  if (!isBlocked(r.board)) throw fail(409, `plan "${slug}" is not blocked`);
  const plan = relative(path, abs).split(sep).join('/');
  const launches = ctx.launches ?? listLaunches();
  const last = launches.find((l) => l.repo === path && l.plan === plan && (l.action === 'run' || l.action === 'marathon'));
  const intent = { action: 'run', repo: path, plan, harness: last?.harness === 'codex' ? 'codex' : 'claude' };
  const preview = previewLaunch(intent, ctx);
  if (preview.guards.errors.length) throw fail(409, preview.guards.errors.join('; '), { guards: preview.guards });
  appendLedger(abs, `Ruling: ${ruling} (from HQ)`);
  clearRepoCache();
  return startFromIntent({ ...intent, confirm: true }, ctx);
}
```

Create `test/hq-answer.test.mjs` (temp `RELAY_HOME`, stub claude via `{ env: { ...process.env, RELAY_CLAUDE_BIN: STUB } }`, plan blocked as in `test/hq-repo.test.mjs`: ledger `start:`, `relay worktrees sync … --wave 1`, `Lane b: T4 BLOCKED, needs a decision`):
1. Success: `answerPlan(repo, 'billing-export', 'Paid only.\n- 2026-01-01 00:00 plan: complete', { env })` returns a launch with `action: 'run'`; the ledger's last entry is `Ruling: Paid only. - 2026-01-01 00:00 plan: complete (from HQ)` on one line; `boardFor` status is still not `complete`.
2. A plan that is not blocked (ledger `start:` only, older than 30 minutes is not needed) is refused with 409 and the ledger bytes are unchanged.
3. With an HQ run launch of that plan live (`startLaunch` with `STUB_SLEEP_MS`), a blocked plan is refused with 409 and the ledger bytes are unchanged. Stop the launch in `finally`.

### B4: Merge locally

Create `lib/hq/merge.mjs`:

```js
// Merge locally: the integration branch goes into the current branch with a merge commit.
// Nothing is pushed. On a conflict the merge is aborted, so the repository is left as it was.

import { git } from '../git.mjs';
import { boardFor } from '../../scripts/relay-board.mjs';
import { appendLedger } from '../../scripts/relay-ledger.mjs';
import { clearRepoCache, integrationState, planFileOf } from './repo.mjs';

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const MAX_COMMITS = 200;

function mergeable(path, slug) {
  const abs = planFileOf(path, slug);
  const r = boardFor(abs);
  if (r.errors) throw fail(409, r.errors.join('; '));
  if (r.board.status !== 'complete') throw fail(409, `plan "${slug}" is not complete`);
  const branch = `relay/${r.board.slug}/integration`;
  const { hasInt, merged } = integrationState(path, r.board);
  if (!hasInt) throw fail(409, `${branch} does not exist`);
  if (merged) throw fail(409, `${branch} is already merged`);
  const into = git(['rev-parse', '--abbrev-ref', 'HEAD'], path, { allowFail: true });
  if (!into || into === 'HEAD') throw fail(409, 'HEAD is detached; check out a branch first');
  return { abs, branch, into };
}

const isDirty = (path) => (git(['status', '--porcelain', '--untracked-files=no'], path) ?? '').trim().length > 0;

export function mergePreview(path, slug) {
  const { branch, into } = mergeable(path, slug);
  const log = git(['log', '--oneline', '-n', String(MAX_COMMITS), `${into}..${branch}`], path) ?? '';
  return { branch, into, commits: log.split('\n').filter(Boolean), dirty: isDirty(path) };
}

export function mergeLocally(path, slug) {
  const { abs, branch, into } = mergeable(path, slug);
  if (isDirty(path)) throw fail(409, 'the working tree has uncommitted changes');
  if (git(['merge', '--no-ff', '--no-edit', branch], path, { allowFail: true }) === undefined) {
    const conflicts = (git(['diff', '--name-only', '--diff-filter=U'], path, { allowFail: true }) ?? '').split('\n').filter(Boolean);
    if (git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], path, { allowFail: true }) !== undefined) git(['merge', '--abort'], path, { allowFail: true });
    clearRepoCache();
    throw fail(409, conflicts.length ? 'the merge has conflicts; nothing changed' : 'git merge failed; nothing changed', { conflicts });
  }
  const sha = git(['rev-parse', '--short', 'HEAD'], path);
  appendLedger(abs, `plan: merged (merged locally in HQ into ${into} @ ${sha})`);
  clearRepoCache();
  return { ok: true, branch, into, sha };
}
```

Create `test/hq-merge.test.mjs`. Fixture helper: `tempRepo`, `copyFixture('plan-basic.md', dir)`, commit; `git checkout -qb relay/billing-export/integration`, write `work.txt`, commit `T1: Export schema`, `git checkout -q main`; ledger `start: 6 tasks, 4 lanes, 2 waves` and `plan: complete (relay/billing-export/integration @ abc)` through `runCli(['ledger', planPath, …])`. Tests:
1. `mergePreview` lists the one commit; `mergeLocally` makes `HEAD` a commit with two parents (`git rev-list --parents -n 1 HEAD` has 3 fields) and the ledger has a line matching `/plan: merged \(merged locally in HQ into main @ [0-9a-f]+\)$/m`.
2. A modified tracked `README.md` makes it refuse with 409; `HEAD` and the ledger are unchanged.
3. Conflict: the integration branch and `main` change the same line of `README.md` differently. Refused with 409 and `conflicts` `['README.md']`; `git rev-parse -q --verify MERGE_HEAD` fails; `HEAD` is the same; `git status --porcelain --untracked-files=no` is empty.

### B5: Open PR

Create `lib/hq/pr.mjs`:

```js
// Open PR: push the integration branch to origin, then gh pr create against the current branch.
// Title from the plan's goal, body from the ledger. gh is RELAY_GH_BIN or gh on PATH.

import { execFileSync } from 'node:child_process';
import { git } from '../git.mjs';
import { boardFor } from '../../scripts/relay-board.mjs';
import { clearRepoCache, integrationState, planFileOf } from './repo.mjs';
import { reviewOf } from './review.mjs';
import { onPath } from './sources.mjs';

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const TITLE_MAX = 200;
const firstLine = (s) => String(s ?? '').split('\n').find((l) => l.trim())?.trim().slice(0, 200) ?? '';

export const ghBin = (env = process.env) => env.RELAY_GH_BIN || onPath('gh', env);

export function prBody({ slug, flow, review }) {
  const lines = [`Relay plan \`${slug}\` (${flow ?? 'feature'}).`, '', '## Waves'];
  lines.push(...(review.waves.length ? review.waves.map((w) => `- ${w}`) : ['- none recorded']), '', '## Tests');
  lines.push(review.tests ? `+${review.tests.added} -${review.tests.removed}` : 'not recorded', '', '## Rulings');
  lines.push(...(review.rulings.length ? review.rulings.map((r) => `- ${r}`) : ['- none']));
  if (review.deferred.length) lines.push('', '## Deferred findings', ...review.deferred.map((d) => `- ${d}`));
  return lines.join('\n');
}

function prepare(path, slug, env) {
  const abs = planFileOf(path, slug);
  const r = boardFor(abs);
  if (r.errors) throw fail(409, r.errors.join('; '));
  if (r.board.status !== 'complete') throw fail(409, `plan "${slug}" is not complete`);
  const branch = `relay/${r.board.slug}/integration`;
  const { hasInt, merged } = integrationState(path, r.board);
  if (!hasInt) throw fail(409, `${branch} does not exist`);
  if (merged) throw fail(409, `${branch} is already merged`);
  if (git(['remote', 'get-url', 'origin'], path, { allowFail: true }) === undefined) throw fail(409, 'the repository has no origin remote');
  const gh = ghBin(env);
  if (!gh) throw fail(409, 'gh is not installed');
  try {
    execFileSync(gh, ['auth', 'status'], { cwd: path, env, stdio: 'ignore', timeout: 15000 });
  } catch {
    throw fail(409, 'gh is not signed in');
  }
  const base = git(['rev-parse', '--abbrev-ref', 'HEAD'], path, { allowFail: true });
  if (!base || base === 'HEAD') throw fail(409, 'HEAD is detached; check out the base branch first');
  const title = (String(r.board.goal ?? '').split('\n')[0].trim() || slug).slice(0, TITLE_MAX);
  return { gh, branch, base, title, body: prBody({ slug, flow: r.board.flow, review: reviewOf(r.board, r.dir) }) };
}

export function prPreview(path, slug, { env = process.env } = {}) {
  const { branch, base, title, body } = prepare(path, slug, env);
  return { branch, base, title, body };
}

export function openPr(path, slug, { env = process.env } = {}) {
  const { gh, branch, base, title, body } = prepare(path, slug, env);
  try {
    execFileSync('git', ['push', '-u', 'origin', branch], { cwd: path, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  } catch (err) {
    throw fail(502, `git push failed: ${firstLine(err.stderr)}`);
  }
  let out;
  try {
    out = execFileSync(gh, ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body], { cwd: path, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  } catch (err) {
    throw fail(502, `gh pr create failed: ${firstLine(err.stderr)}`);
  }
  const url = out.split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l)).pop();
  if (!url) throw fail(502, 'gh printed no pull request URL');
  clearRepoCache();
  return { ok: true, url, branch, base };
}
```

Create `test/fixtures/stub-gh.mjs`:

```js
#!/usr/bin/env node
// A stand-in for gh in the relay HQ Open PR tests. `auth status` exits 0, or 1 when
// STUB_GH_AUTH=fail. `pr create` appends its argv as one JSON line to STUB_GH_LOG and
// prints a pull request URL as gh does.

import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'status') process.exit(process.env.STUB_GH_AUTH === 'fail' ? 1 : 0);
if (args[0] === 'pr' && args[1] === 'create') {
  if (process.env.STUB_GH_LOG) appendFileSync(process.env.STUB_GH_LOG, JSON.stringify(args) + '\n');
  process.stdout.write('Creating pull request\n\nhttps://github.com/acme/demo/pull/7\n');
  process.exit(0);
}
process.stderr.write(`stub-gh: unexpected ${args.join(' ')}\n`);
process.exit(2);
```

Create `test/hq-pr.test.mjs` (same complete-plan fixture as B4; `chmodSync(STUB_GH, 0o755)`):
1. Refusals: without an `origin` remote, `openPr` is refused with 409 `no origin`. With `origin` set to a bare repository (`git init -q --bare`) and `env = { ...process.env, PATH: <empty temp dir> }` without `RELAY_GH_BIN`, it is refused with 409 `gh is not installed`; with the stub and `STUB_GH_AUTH: 'fail'`, 409 `not signed in`. The bare repository has no `relay/billing-export/integration` ref after the refusals.
2. Success with the stub: `openPr` returns `url` `https://github.com/acme/demo/pull/7`; the bare repository's `relay/billing-export/integration` equals the local branch's sha; the logged argv contains `--base main --head relay/billing-export/integration` and `--title CSV export of invoices plus a billing helper.`; `main` is not pushed.

### B6: Overview, sidebar and run extras

Create `lib/hq/overview.mjs`. Exports: `UNASSIGNED = '_unassigned'`, `setupIssuesFrom(recos)`, `overviewFor(reg, projectId, opts)`, `sidebarFor(reg, opts)`, `runExtras(path, slug, opts)`. `opts = { launches = listLaunches(), routineItems = [], setupIssues = [], budget = null, now = Date.now() }`. The server fills `routineItems`, `setupIssues` and `budget`; tests pass them directly.

Repositories: `listRepos(reg)` (from `./registry.mjs`) minus hidden ones, each with `rid = ridOf(path)`, `name = basename(path)`, `project = r.project ?? UNASSIGNED`, `projectName` (from `reg.projects`, `'Unassigned'` for `UNASSIGNED`). Summaries: `repoSummary(path)`. Use the registered path everywhere (launch `repo` values and plan `file` values are relative to it).

**Need item** (every field present, null when not applicable):
`{ id, kind, project, projectName, rid, repoName, plan, file, lane, text, detail, at, href, launch, instance, finding, copy, resetsAt }` where `launch` is `{ id, status, retryable } | null`. Kinds and sources:
- `lane-blocked`, `marathon-blocked`, `suite-failed`: the summary's `attention` items of those kinds (drop `ready-to-merge`). Keep `id`, `text`, `at`, `href`, `lane`, `plan` (slug). Add `file` (the plan's `file`), `launch` = the newest launch of that plan (same `repo` and `plan` file).
- `run-paused`: a plan that is not complete whose newest `run`/`marathon` launch has status `done` and `outcome` matching `/^PAUSED\b/`, with no running launch for that plan. `id` `${rid}:run-paused:${slug}`, `text` the outcome, `at` the launch's `endedAt`, `resetsAt` `budget?.resetsAt ?? null`, `href` the run page.
- `launch-failed` / `launch-lost`: a launch with status `failed`/`lost` that is the newest launch with the same `action|repo|plan` key and started within the last 72 hours. `id` `launch:${l.id}`, `text` `${l.action} ${l.status}`, `detail` `l.error ?? l.outcome ?? ''`, `at` `l.endedAt ?? l.startedAt`, `href` `#/launches/${l.id}`. Project from the launch's repository; null when the launch has no registered repository.
- `routine`: each `routineItems` entry; parse `instance` and `finding` from its id with `/^routine:([^:]+):(.+)$/`; project from its `rid` (null when `rid` is null or unknown).
- `setup`: `setupIssues` entries as they are (project null).
Sort newest `at` first; items without `at` last.

`setupIssuesFrom(recos)` (pure): recos with `state === 'open'`, `apply.kind === 'manual'` and source `gh`, `connectors`, or `keys` with `unblocks === true`. Map to a need with `id` `setup:${r.id}`, `kind 'setup'`, `text` `r.title`, `detail` `r.benefit`, `at` `r.at ?? null`, `copy` `r.apply.copy`, `href` `#/setup/connectors` for `gh` and `connectors`, `#/setup/keys` for `keys`.

**Cards:**
- `running`: plans with status `running` or `blocked`. `{ type: 'plan', id: `${rid}:${slug}`, project, projectName, rid, repoName, slug, file, title, flow, status, wave: currentWave, waves: waveCount, done: green, total: totals.tasks, startedAt, leftMin, launch: {id} | null, lanes, href }`. `lanes` = `runningPlan(summary, plan, { launches }).groups.running` mapped to `{ lane, title, kind, hex, avatar, status, task, fix }` (`runningPlan` from `./home.mjs`; `startedAt` from its `kpis.startedAt`). `leftMin`: `forecastPlan(join(path, file))` (from `scripts/relay-forecast.mjs`); sum `minutes` of `forecast.perWave` entries with `wave >= max(1, currentWave)`, rounded; null when the forecast has errors or no `perWave`; wrap in try/catch. Then plan-less live launches: running launches whose `plan` is null or matches no plan of its repository, as `{ type: 'launch', id: l.id, project, projectName, rid, repoName, action: l.action, startedAt: l.startedAt }`.
- `ready`: plans with `readyToMerge`. `{ id, project, projectName, rid, repoName, slug, title, branch: `relay/${slug}/integration`, into: summary.git.branch, at: lastAt, tests, rulings: review.rulings.length, openFindings, suite, href }` with `review = reviewOf(plan.board, runDir(join(path, file), slug))` (`runDir` from `scripts/relay-lanes.mjs`).
- `finished`: plans with status `complete` and not `readyToMerge`, newest `lastAt` first, at most 10: `{ id, project, projectName, rid, repoName, slug, title, at: lastAt, href }`.
- `activity`: `activityFor(memberRepos, { launches: launches of those repos (all launches for All), limit: 50 })`.

`overviewFor(reg, projectId)`: `'all'` → every visible repository and every item; `UNASSIGNED` → repositories without a project; else a `reg.projects` id; unknown → throw `{ status: 404, message: 'unknown project' }`. For a project, keep only items and cards whose `project` equals it (setup items and items with project null appear on All only). Returns `{ project: { id, name, repos: [{ rid, name }] }, needs, running, ready, finished, activity }` (All: `{ id: 'all', name: 'All projects' }`).

`sidebarFor(reg, opts)`: compute `all = overviewFor(reg, 'all', opts)` once. Return `{ all: { needs: all.needs.length, live: all.running.length }, projects: [...reg.projects in registry order, then Unassigned when it has a visible repository].map((p) => ({ id, name, needs: all.needs.filter((n) => n.project === p.id).length, live: all.running.filter((c) => c.project === p.id).length })) }`.

`runExtras(path, slug, { launches, now })`: `abs = planFileOf(path, slug)`, `r = boardFor(abs)` (409 on errors), `file` repository-relative. Return `{ launches: that plan's launches, newest first, at most 20, as { id, action, status, outcome, harness, startedAt, endedAt, retryable }, live: { id, log: logTail(id, 16 * 1024) } | null for a running one, ledger: last 40 ledgerOf(r.dir) entries as "<at> <text>", startedAt: ISO of the last "start:" entry or null, leftMin (0 when complete), branch, into: current branch, review: complete ? { ...reviewOf(r.board, r.dir), ready: hasInt && !merged, merged } : null }`.

Create `test/hq-overview.test.mjs` (temp `RELAY_HOME`; call with `routineItems: []`, `setupIssues: []`). Three repositories in project `Billing` (`addRepo(dir, { project: 'Billing' })` → id `billing`), each with `plan-basic.md`: A blocked (ledger `start:`, `worktrees sync --wave 1`, `Lane b: T4 BLOCKED …`); B complete and not merged (integration branch with a commit ahead, as in B4); C complete and marked merged (`plan: merged (squashed)` ledger line). One more repository with no project and a blocked plan.
1. Behavior 1: `sidebarFor` gives `billing` `needs` 1 and equal to `overviewFor(reg, 'billing').needs.length`; `all.needs` equals `overviewFor(reg, 'all').needs.length` and is 2; the Unassigned entry has needs 1.
2. Behavior 7: on `billing`, A's card is only in `running` (with lane `b` status `blocked`) and its item is in `needs` (kind `lane-blocked`); B is only in `ready`; C is only in `finished`; no `ready-to-merge` kind in `needs`. A hand-made failed launch (as in B2) for repo A adds one `launch-failed` need; a newer launch with the same action, repo and plan removes it.

### B7: Server routes

In `lib/hq/server.mjs`:
- Dispatch passes a third argument: `const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');` then `fn(m, body, query)`.
- Error body: add `...(err.conflicts ? { conflicts: err.conflicts } : {})`.
- Helpers: `const SLUG = /^[a-z0-9][a-z0-9-]*$/;` `planTarget(body)` → 400 `rid and slug are required` unless `body.rid` is a string and `body.slug` matches `SLUG`; returns `repoByRid(readRegistry(), body.rid).path`. `overviewOpts()` → `{ launches: listLaunches().map(cleanLaunch), routineItems: safe(routineAttention), setupIssues: safe(() => setupIssuesFrom(recosView().recos)), budget: budgetNow() }` where `safe` returns `[]` on a throw.
- New routes:
  - `GET /api/sidebar` → `{ ...sidebarFor(reg, overviewOpts()), budget: budgetNow(), repos: visible repos as { rid, name, path, project: project ?? null } }`.
  - `GET /api/overview?project=<id|all>` → `overviewFor(readRegistry(), id, overviewOpts())`; default `all`; 400 unless the id matches `/^[a-z0-9_-]+$/`.
  - `POST /api/plans/answer {rid, slug, text}` → `answerPlan(path, slug, text)`; return `{ launch: cleanLaunch(r.launch) }`.
  - `POST /api/launches/:id/retry` (path id matches `LAUNCH_ID`) → `retryLaunch(id)`; return `{ launch: cleanLaunch(r.launch) }`.
  - `POST /api/plans/pr {rid, slug, confirm?}` → `confirm === true ? openPr(path, slug) : { preview: prPreview(path, slug) }`.
  - `POST /api/plans/merge {rid, slug, confirm?}` → `confirm === true ? mergeLocally(path, slug) : { preview: mergePreview(path, slug) }`.
  - `GET /api/repos/:rid/plans/:slug` now returns `{ ...planDetail(path, slug), run }` where `run = runExtras(path, slug, { launches: listLaunches().map(cleanLaunch) })` with `run.live.log` passed through `redact`.
- Remove the duplicated `GET /api/plans` and `GET /api/brain` entries (each appears twice). Keep every other route.

Create `test/hq-overview-http.test.mjs`:
1. Every new endpoint answers 401 without the token and 403 with `Origin: http://evil.example`; answer, pr and merge answer 400 for `slug: '../x'`; retry answers 404 for an unknown launch id.
2. Behavior 1 end to end: one registered repository with a blocked plan in project `Billing`; `GET /api/sidebar` project `billing` `needs` equals the length of `GET /api/overview?project=billing` `needs` (1), and `all.needs` equals the length of `GET /api/overview` `needs`; `GET /api/repos/<rid>/plans/billing-export` has an array `run.ledger`.

### U1: Route table and view stylesheets

Create `lib/hq/ui/routes.js` with exactly this code:

```js
// relay HQ routes: hash → view, old routes redirected. Pure (no DOM), so Node tests import it.

export const SETUP_TABS = [
  ['team', 'Team'],
  ['flows', 'Flows'],
  ['skills', 'Skills'],
  ['connectors', 'Connectors'],
  ['keys', 'API keys'],
  ['routines', 'Routines'],
  ['repos', 'Repositories'],
];
const TAB_IDS = new Set(SETUP_TABS.map(([id]) => id));
const BRAIN_ALIASES = { agents: 'team', wiring: 'flows' };
const ALL = '#/';

const decode = (p) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
};

// { name: 'all' | 'project' | 'run' | 'setup' | 'launch' | 'routine', ...params, redirect?: hash }
export function parseRoute(hash = '') {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean).map(decode);
  const [head, a, b, c, d, e] = parts;
  const enc = encodeURIComponent;
  switch (head) {
    case undefined:
      return { name: 'all' };
    case 'projects':
      if (!a) return { name: 'all', redirect: ALL };
      return b ? { name: 'project', id: a, redirect: `#/projects/${enc(a)}` } : { name: 'project', id: a };
    case 'repos':
      if (a && b === 'plans' && c) return { name: 'run', rid: a, slug: c, task: d === 'tasks' ? e : undefined };
      return { name: 'all', redirect: ALL };
    case 'setup':
      return TAB_IDS.has(a) ? { name: 'setup', tab: a } : { name: 'setup', tab: 'team', redirect: '#/setup/team' };
    case 'brain': {
      const wanted = BRAIN_ALIASES[a] ?? a;
      const tab = TAB_IDS.has(wanted) ? wanted : 'team';
      return { name: 'setup', tab, redirect: `#/setup/${tab}` };
    }
    case 'routines':
      return a ? { name: 'routine', id: a } : { name: 'setup', tab: 'routines', redirect: '#/setup/routines' };
    case 'launches':
      return a ? { name: 'launch', id: a } : { name: 'all', redirect: ALL };
    default:
      return { name: 'all', redirect: ALL };
  }
}
```

In `lib/hq/ui/dom.js`, add after `fill`:

```js
// Loads a view's own stylesheet once (views do not share app.css).
export function useStyle(href) {
  if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}
```

Create `test/hq-routes.test.mjs` with one table test (behavior 6): `#/plans`, `#/projects`, `#/recos`, `#/launches`, `#/activity` → `{ name: 'all', redirect: '#/' }`; `#/brain/keys` → `{ name: 'setup', tab: 'keys', redirect: '#/setup/keys' }`; `#/brain` and `#/brain/agents` → tab `team`; `#/routines` → tab `routines`; `''` and `#/` → `{ name: 'all' }` with no `redirect`; `#/repos/abc1234567/plans/x/tasks/T1` → run with task `T1`; `#/launches/20260101-000000-abcd` → launch; `#/projects/billing/repos` → project `billing` with redirect `#/projects/billing`. Import with `import { parseRoute } from '../lib/hq/ui/routes.js';`.

### U2: Chrome, router and removed pages

Rewrite `lib/hq/ui/app.js` around `parseRoute` from `./routes.js`:
- `onRoute()`: `const r = parseRoute(location.hash)`; when `r.redirect` differs from `location.hash`, `history.replaceState(null, '', r.redirect)`. Drop the `body.home` layout switch.
- Views: `all` → `lazy('./overview.js', (m) => m.renderOverview(main, { project: 'all' }, ctx))`; `project` → the same with `{ project: r.id }`; `run` → `lazy('./plan.js', (m) => m.renderPlan(main, { rid, slug, task }, ctx))`; `setup` → `lazy('./setup.js', (m) => m.renderSetup(main, { tab: r.tab }, ctx))`; `routine` → `routines.js` `renderRoutine` with crumbs `[['Setup', '#/setup/team'], ['Routines', '#/setup/routines'], [id]]`; `launch` → keep `renderLaunch` in `app.js`, crumbs `[['All', '#/'], [id]]`, and add a **Retry** button when `l.retryable` that posts `/api/launches/<id>/retry` and navigates to the new launch.
- Delete `renderActivity`, `renderLaunches`, `activityTabs`, the `SECTION` map, `homeCache`, `ctx.home`, and the `/` key special case for recos.
- `ctx`: `crumbs`, `navigate`, `refresh`, `sidebar()` (one `/api/sidebar` per 2 s, shared by chrome and views), `repos` (from the last sidebar), `projectOf(rid)` → `{ id, name } | null` from sidebar repos and projects, `openLaunch(intent)`.
- Sidebar (`refreshChrome`): brand link `#/`; `★ All` → `#/` with a red badge `●n` when `all.needs > 0`; a separator; one link per project → `#/projects/<id>` with a red badge `●n` (needs) and a blue pulsing badge `▶n` (live) when non-zero; a flex spacer; `⚙ Setup` → `#/setup/team` at the bottom. `aria-current="page"` on All for `all`, on the project for `project` and for `run` (the run's project from `ctx.projectOf(rid)`), on Setup for `setup` and `routine`. The budget in the top bar comes from `sidebar.budget` (same rendering as now).
- `lib/hq/ui/index.html`: remove the `data-run` "Run a skill" button. Keep crumbs, Search and budget.
- `lib/hq/ui/app.css`: remove `@import url("/home.css");` and the `body.home` rules. Add `.side .sep`, `.side .grow{flex:1}`, `.side .b{margin-left:auto;display:flex;gap:4px}`, `.n.r` (red badge) and `.n.l` (accent badge with `animation:pulse 1.6s infinite`, `@keyframes pulse{50%{opacity:.5}}`) per the mockup colours. Keep the 900 px single-column rule working.
- `lib/hq/ui/search.js`: GO TO items become All (`#/`) and one per Setup tab (`Setup · <label>`, from `SETUP_TABS`). Projects come from `/api/sidebar`, plans from `/api/plans`, skills from `/api/brain/skills` (`#/setup/skills`). Drop recos and `/api/home`.
- Delete `lib/hq/ui/home.js`, `home.css`, `orb.js`, `plans.js`, `recos.js`, `recos.css`, `apply-dialog.js`. Check with `grep -rn "home.js\|orb.js\|plans.js\|recos.js\|apply-dialog.js\|ctx.home" lib/hq/ui` that only `projects.js` still mentions `ctx.home` (U6 deletes it).

### U3: Merge and PR confirmation dialogs

Create `lib/hq/ui/merge-dialog.js` with exactly this code:

```js
// Confirmation dialogs for Open PR and Merge locally: the server's preview first, then the
// action with confirm: true. Shown in the shared #launch dialog. Text only.

import { api, errorBox, fill, h } from './dom.js';

const btn = (label, onclick, cls = 'btn') => h('button', { class: cls, type: 'button', onclick }, label);

async function confirmFlow({ path, rid, slug, title, details, confirmLabel, done, onDone }) {
  const dlg = document.getElementById('launch');
  const close = btn('Close', () => dlg.close());
  fill(dlg, h('h2', {}, title), h('p', { class: 'muted' }, '…'));
  if (!dlg.open) dlg.showModal();
  let preview;
  try {
    preview = (await api(path, { method: 'POST', body: { rid, slug } })).preview;
  } catch (err) {
    fill(dlg, h('h2', {}, title), errorBox(err), h('div', { class: 'row' }, close));
    return;
  }
  const go = btn(confirmLabel, async () => {
    go.disabled = true;
    try {
      const res = await api(path, { method: 'POST', body: { rid, slug, confirm: true } });
      fill(dlg, h('h2', {}, title), done(res), h('div', { class: 'row' }, close));
      onDone?.();
    } catch (err) {
      const conflicts = err.data?.conflicts ?? [];
      fill(dlg, h('h2', {}, title), errorBox(err), conflicts.length ? h('ul', {}, conflicts.map((c) => h('li', {}, c))) : null, h('div', { class: 'row' }, close));
    }
  }, 'btn primary');
  fill(dlg, h('h2', {}, title), details(preview), h('div', { class: 'row' }, go, btn('Cancel', () => dlg.close())));
}

export function openPrDialog({ rid, slug }, { onDone } = {}) {
  return confirmFlow({
    path: '/api/plans/pr', rid, slug, title: `Open PR · ${slug}`, confirmLabel: 'Push and open PR', onDone,
    details: (p) => h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('b', {}, p.branch), h('span', { class: 'muted' }, '→'), h('b', {}, p.base)),
      h('p', {}, p.title),
      h('pre', { class: 'code' }, p.body)),
    done: (res) => h('p', {}, h('a', { href: res.url, target: '_blank', rel: 'noopener noreferrer' }, res.url)),
  });
}

export function openMergeDialog({ rid, slug }, { onDone } = {}) {
  return confirmFlow({
    path: '/api/plans/merge', rid, slug, title: `Merge locally · ${slug}`, confirmLabel: 'Merge', onDone,
    details: (p) => h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('b', {}, p.branch), h('span', { class: 'muted' }, '→'), h('b', {}, p.into)),
      p.dirty ? errorBox(new Error('the working tree has uncommitted changes')) : null,
      h('pre', { class: 'code' }, p.commits.join('\n'))),
    done: (res) => h('p', {}, `Merged into ${res.into} @ ${res.sha}`),
  });
}
```

Check: `h` in `dom.js` must accept arrays and `null` children (it goes through the same flattening as `fill`); if it does not, wrap those children in `fill`.

### U4: All and project page

Create `lib/hq/ui/overview.js` exporting `renderOverview(main, { project }, ctx)` and `lib/hq/ui/overview.css` (loaded with `useStyle('/overview.css')` at module top). Follow the mockup's Screen 1 layout and classes; write the CSS for them in `overview.css`.
- Data: `GET /api/overview?project=<id|all>`. Crumbs: All → `[['All']]`; a project → `[['All', '#/'], [name]]`.
- Header: `h1` (project name or "All projects"), meta line (repositories names on a project; on All `<n> projects · <n> running`), **Run plan** (`ctx.openLaunch({ action: 'run' })`) and **+ New plan** (`ctx.openLaunch({ action: 'plan' })`); on a project, limit the dialog repos to the project's repos (pass `rid` when it has exactly one). On a real project keep the `projectMenu` from `./project-menu.js` (rename, delete → navigate `#/`).
- **Needs you `<n>`**: one row per item: dot, project name (on All; `setup` for setup items), label and `text`/`detail`, actions by `kind`:
  - `lane-blocked`, `marathon-blocked`: **Open run** (`href`) and an answer row: a text input (`maxlength` 4000) and **Answer and resume** → `POST /api/plans/answer { rid, slug: plan, text }`, then navigate to `#/launches/<id>`; show the error inline on refusal.
  - `run-paused`: **Resume** → `ctx.openLaunch({ action: 'run', rid, plan: file })`, with the reset time from `resetsAt` (`HH:MM`) shown beside it; **Marathon** → `ctx.openLaunch({ action: 'marathon', rid, plan: file, hours: 8 })`.
  - `suite-failed`, `launch-failed`, `launch-lost`: **Log** (`#/launches/<launch.id>` when `launch`, else `href`), **Retry** when `launch?.retryable` → `POST /api/launches/<id>/retry`, then navigate to the new launch.
  - `routine`: **Open** (`href`), **Dismiss** → `POST /api/routines/<instance>/dismiss { finding }`, then `ctx.refresh()`.
  - `setup`: **Copy command** (`copyButton('Copy command', copy)`), **Open Setup** (`href`).
  Empty list: `empty('Nothing needs you.')`.
- **Running `<n>`**: plan cards: title `repoName · slug` (prefix the project name on All), flow tag, `elapsed · ~left` (elapsed from `startedAt`, left from `leftMin`; omit unknowns), a wave bar (`done/total` width) with `wave w/waves · done of total tasks`, then one line per lane: `lane <id>`, `mascot(kind, status === 'working', title, hex)`, `task.id · task.title` (or `fix` round), a status tag; a blocked lane gets class `red`. The card links to `href`. Launch cards (`type: 'launch'`): action, repository, started time, **Log** (`#/launches/<id>`) and **Stop** (`POST /api/launches/<id>/stop`).
- **Ready to merge `<n>`**: one card each: title, `branch → into`, stats (`+added` tests, `−removed` tests, rulings, open findings, suite ✓/✗; `?` when tests is null), actions **Review** (navigates to `href`; the Run page scrolls to its review panel when the plan is ready), **Open PR** (`openPrDialog`), **Merge locally** (`openMergeDialog`), **Mark merged** (`POST /api/plans/merged { rid, slug }`). Dialog `onDone` → `ctx.refresh()`.
- **Finished · n**: a closed `<details>` with one link per plan (`repoName · slug · ago(at)`).
- **Activity**: a closed `<details>` with `activityGroups(activity, (e) => projectOf, empty)` from `./activity.js`.
- Return `{ poll: true }`. The app's `busy()` already keeps a focused answer input from being re-rendered; check that it still covers `INPUT` inside `main`.

### U5: Run page

Rewrite `lib/hq/ui/plan.js` (`renderPlan(main, { rid, slug, task }, ctx)`) as the Run page; keep the task panel (`/tasks/<id>`) and the filters. Put new styles in `lib/hq/ui/run.css`, loaded with `useStyle('/run.css')`. Follow the mockup's Screen 2.
- Data: `GET /api/repos/<rid>/plans/<slug>` (now with `run`). Crumbs `[['All', '#/'], [project name, '#/projects/<id>'], [slug]]` with the project from `ctx.projectOf(rid)` (skip the middle crumb when null).
- Header: `h1` slug; meta `repo · flow · status · run.branch · elapsed (from run.startedAt) · ~left (run.leftMin)`; **Stop** (danger) while `run.live` → `POST /api/launches/<run.live.id>/stop`; **Run**/**Resume** and **Marathon** as now when the plan is neither running nor complete.
- Waves: one block per wave with its state tag; per lane: `mascot` of its first agent with title, `lane.note` (fix round), tasks as chips (done struck through, current highlighted), the lane's pieces with their result (`pieceChip`); a blocked lane gets class `red`.
- Right column: **Live log**: `pre` with `run.ledger` joined, then, when `run.live`, `[launch <id>]` and `run.live.log`. **Launches**: one row per `run.launches` item (action, status, outcome, started) with **Log** and, when `retryable`, **Retry**.
- **Review and merge** (`id="review"`; on first render, scroll it into view when the route has no task and `run.review?.ready`): tests added/removed, every ruling, deferred findings, `finalFindings` in a `pre`, report buttons (`openPath` for `run.review.reports` and plan pieces with a report), then **Open PR**, **Merge locally** (from `./merge-dialog.js`) and **Mark merged** when `run.review.ready`. Hide the panel when `run.review` is null.
- Return `{ poll: true }`.

### U6: Setup page

- Create `lib/hq/ui/setup.js` exporting `renderSetup(main, { tab }, ctx)`: `h1` "Setup", tabs from `SETUP_TABS` (`./routes.js`) as `#/setup/<id>` links with `aria-current`, a body. Crumbs `[['Setup', '#/setup/team'], [label]]`. Tabs: `team`, `flows`, `skills`, `connectors`, `keys` → `renderBrainTab(body, tab, ctx)`; `routines` → `renderRoutines(body, { embedded: true }, ctx)`; `repos` → `renderRepos(body, ctx)`. Return what the tab renderer returns (`{ poll: false }` for brain tabs).
- `lib/hq/ui/brain.js`: replace `renderBrain` with `export async function renderBrainTab(body, id, ctx)` that fetches `/api/brain/<id>` and fills `body` (no `h1`, no tabs, no crumbs). Keep the badge counts out (the Setup tabs carry none). Change any `#/brain/...` href inside to `#/setup/...`.
- `lib/hq/ui/routines.js`: `renderRoutines(main, { embedded } = {}, ctx)`; when `embedded`, render the Enable button without the `Routines` `h1`. Change `#/routines` (list) hrefs to `#/setup/routines`; keep `#/routines/<id>`.
- Create `lib/hq/ui/repos.js` exporting `renderRepos(body, ctx)`: move `repoCard`, `moveSelect` and `githubBlock` from `projects.js`; data from `/api/projects/<id>` for every project in `/api/sidebar` (or `/api/repos/<rid>` per sidebar repo; pick one and keep the card fields the same). Header row: **Add repository** (`openAddDialog`) and **New project**. Group cards by project; hidden repositories last under "Hidden".
- Delete `lib/hq/ui/projects.js`, `plan-row.js`, `running.js`. Check `grep -rn "projects.js\|plan-row.js\|running.js\|renderBrain(" lib/hq/ui` is empty.
- Optional `lib/hq/ui/setup.css` via `useStyle` for the tab layout only if needed.

### D1: README and command descriptions

Rewrite README.md "relay HQ: how to use it" subsections 2–6 (from "### 2. Add your repositories" to before "### Good to know") for the new pages: sidebar (★ All with needs badge, projects with ●needs and ▶live, ⚙ Setup), the project page sections and their actions (table of Needs you items and actions from the spec), the Run page, Setup tabs (move the Brain tab table here; Flows replaces "Flows & pieces"; add Routines and Repositories), and the redirects of old routes. Remove mentions of Home, the ring, Plans, Projects list, Recos and Launches pages. Update the descriptions in `commands/hq.md` and `commands/connectors.md` (Brain → Setup). Check whether `node scripts/relay.mjs build` changes generated files; if it does, run it and add nothing by hand.

```relay-plan
{
  "slug": "relay-hq-projects-first",
  "flow": "feature",
  "suite": "npm test",
  "tasks": [
    {
      "id": "B1", "title": "Review summary and repo exports", "tier": "cheap", "code": "complete", "risk": "low",
      "files": ["lib/hq/repo.mjs", "lib/hq/review.mjs", "test/hq-review.test.mjs"], "deps": [],
      "tags": ["api"],
      "behaviors": ["the review summary sums tests added and removed from lane reports and lists rulings, deferred findings and the last suite result"],
      "tests": 1,
      "done": "node --test test/hq-review.test.mjs test/hq-repo.test.mjs"
    },
    {
      "id": "B2", "title": "Retry with stored intents", "tier": "mid", "code": "prose", "risk": "high",
      "files": ["lib/hq/launches.mjs", "lib/hq/launch.mjs", "test/hq-retry.test.mjs"], "deps": [],
      "tags": ["api"],
      "behaviors": ["Retry starts a launch with the failed launch's intent", "Retry is refused for a running or done launch", "a marathon that ended blocked can be resumed when no newer non-ruling ledger line exists"],
      "tests": 2,
      "done": "node --test test/hq-retry.test.mjs test/hq-launch.test.mjs test/hq-launches.test.mjs"
    },
    {
      "id": "B3", "title": "Answer and resume", "tier": "mid", "code": "complete", "risk": "high",
      "files": ["lib/hq/answer.mjs", "test/hq-answer.test.mjs"], "deps": ["B1", "B2"],
      "tags": ["api"],
      "behaviors": ["Answer and resume appends the ruling line to the ledger and starts a run launch", "it is refused for a plan that is not blocked", "it is refused while a run of that plan is live, without writing the ledger"],
      "tests": 3,
      "done": "node --test test/hq-answer.test.mjs"
    },
    {
      "id": "B4", "title": "Merge locally", "tier": "mid", "code": "complete", "risk": "high",
      "files": ["lib/hq/merge.mjs", "test/hq-merge.test.mjs"], "deps": ["B1"],
      "tags": ["api"],
      "behaviors": ["Merge locally merges the integration branch with a merge commit and ledgers plan: merged", "it refuses a dirty tree", "on a conflict the repository is left as before"],
      "tests": 3,
      "done": "node --test test/hq-merge.test.mjs"
    },
    {
      "id": "B5", "title": "Open PR", "tier": "mid", "code": "complete", "risk": "high",
      "files": ["lib/hq/pr.mjs", "test/fixtures/stub-gh.mjs", "test/hq-pr.test.mjs"], "deps": ["B1"],
      "tags": ["api"],
      "behaviors": ["Open PR is refused without gh, without gh sign-in or without origin", "with a stubbed gh it pushes the integration branch and returns the URL gh printed"],
      "tests": 2,
      "done": "node --test test/hq-pr.test.mjs"
    },
    {
      "id": "B6", "title": "Overview, sidebar and run extras", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/overview.mjs", "test/hq-overview.test.mjs"], "deps": ["B1", "B2"],
      "tags": ["api"],
      "behaviors": ["the sidebar counts match the overview: a blocked lane adds one to its project's needs and to All", "a plan's card appears in exactly one of Running, Ready to merge or Finished; a blocked lane's item is in Needs you and its plan card in Running with that lane red"],
      "tests": 2,
      "done": "node --test test/hq-overview.test.mjs"
    },
    {
      "id": "B7", "title": "Server routes", "tier": "mid", "code": "prose", "risk": "high",
      "files": ["lib/hq/server.mjs", "test/hq-overview-http.test.mjs"], "deps": ["B3", "B4", "B5", "B6"],
      "tags": ["api"],
      "behaviors": ["every new endpoint keeps the token, Host and Origin checks and validates its ids", "GET /api/sidebar and GET /api/overview agree on needs counts"],
      "tests": 2,
      "done": "node --test test/hq-overview-http.test.mjs test/hq-server.test.mjs test/hq-home.test.mjs test/hq-plans-merged.test.mjs"
    },
    {
      "id": "U1", "title": "Route table and view stylesheets", "tier": "cheap", "code": "complete", "risk": "medium",
      "files": ["lib/hq/ui/routes.js", "lib/hq/ui/dom.js", "test/hq-routes.test.mjs"], "deps": [],
      "tags": ["ui"],
      "behaviors": ["old routes #/plans, #/projects, #/recos and #/launches land on All; #/brain/<tab> lands on the matching Setup tab"],
      "tests": 1,
      "done": "node --test test/hq-routes.test.mjs test/hq-server.test.mjs"
    },
    {
      "id": "U2", "title": "Chrome, router and removed pages", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/ui/app.js", "lib/hq/ui/index.html", "lib/hq/ui/app.css", "lib/hq/ui/search.js", "lib/hq/ui/home.js", "lib/hq/ui/home.css", "lib/hq/ui/orb.js", "lib/hq/ui/plans.js", "lib/hq/ui/recos.js", "lib/hq/ui/recos.css", "lib/hq/ui/apply-dialog.js"], "deps": ["U1"],
      "tags": ["ui"],
      "behaviors": ["the sidebar shows All with its needs badge, each project with needs and live badges, and Setup at the bottom", "HQ opens on All and old routes redirect", "the Home ring, orb, Plans, Projects list, Recos and Launches pages are gone"],
      "tests": 0,
      "done": "node --test test/hq-server.test.mjs test/hq-routes.test.mjs && node --check lib/hq/ui/app.js && node --check lib/hq/ui/search.js"
    },
    {
      "id": "U3", "title": "Merge and PR confirmation dialogs", "tier": "cheap", "code": "complete", "risk": "medium",
      "files": ["lib/hq/ui/merge-dialog.js"], "deps": [],
      "tags": ["ui"],
      "behaviors": ["Open PR and Merge locally show a confirmation with the server's preview before acting"],
      "tests": 0,
      "done": "node --check lib/hq/ui/merge-dialog.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "U4", "title": "All and project page", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/ui/overview.js", "lib/hq/ui/overview.css"], "deps": ["U1", "U3"],
      "tags": ["ui"],
      "behaviors": ["Needs you lists each item with its actions", "Running shows one card per running plan with wave bar and lanes, and plan-less launches with Log and Stop", "Ready to merge cards offer Review, Open PR, Merge locally and Mark merged", "Finished and Activity are collapsed"],
      "tests": 0,
      "done": "node --check lib/hq/ui/overview.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "U5", "title": "Run page", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/ui/plan.js", "lib/hq/ui/run.css"], "deps": ["U1", "U3"],
      "tags": ["ui"],
      "behaviors": ["the Run page shows header with Stop, waves and lanes with agents and pieces, the live log, the plan's launches and the review panel with Open PR, Merge locally and Mark merged"],
      "tests": 0,
      "done": "node --check lib/hq/ui/plan.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "U6", "title": "Setup page", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/ui/setup.js", "lib/hq/ui/setup.css", "lib/hq/ui/brain.js", "lib/hq/ui/routines.js", "lib/hq/ui/repos.js", "lib/hq/ui/projects.js", "lib/hq/ui/plan-row.js", "lib/hq/ui/running.js"], "deps": ["U1", "U2"],
      "tags": ["ui"],
      "behaviors": ["Setup has the tabs Team, Flows, Skills, Connectors, API keys, Routines and Repositories", "Repositories can be added, assigned to a project, hidden and removed"],
      "tests": 0,
      "done": "node --check lib/hq/ui/setup.js && node --check lib/hq/ui/repos.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "D1", "title": "README and command descriptions", "tier": "mid", "code": "prose", "risk": "low",
      "files": ["README.md", "commands/hq.md", "commands/connectors.md"], "deps": [],
      "tags": ["docs"],
      "behaviors": ["the README describes All, project pages, the Run page and Setup, and no longer describes the removed pages"],
      "tests": 0,
      "done": "node scripts/relay.mjs build --check"
    }
  ]
}
```
