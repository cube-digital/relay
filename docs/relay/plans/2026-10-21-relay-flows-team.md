# Relay Flows and Team Plan

**Goal:** Make relay's fixed pipeline extensible: pieces (data) placed at six fixed points around the unchanged lane chassis, flows that a plan chooses, task roles, and a team of roles with identities, visible live in Claude Code (the mod) and in HQ.
**Spec:** docs/relay/specs/2026-10-21-relay-flows-team-design.md
**Architecture:** `lib/team.mjs` reads each role's identity and profile from `roles/*.md`; `lib/flows.mjs` loads, validates and resolves `pieces/*.json` and `flows/*.json` (pure, plus two readers). `relay lanes` attaches the applicable pieces to every lane, `relay flow at|done` resolves and records them for the conductor, `relay build --check` validates all of it, forecast and calibration weigh it, the mod tracks the team from a generated identity table, and HQ draws the team, the flows and each piece's result from the ledger's `piece …` lines.

## Global Constraints

- Plain Node >= 20, ESM, named exports, no dependencies, imports from `node:*` and relay's own modules only. Every new file starts with a 1-3 line comment saying what it is.
- Sources vs generated: edit `roles/*.md`, `config/routing.json`, `scripts/build.mjs`; then run `node bin/relay build` and commit the regenerated `agents/*.md`, `codex/agents/*.toml` and the `<relay:generated>` block of `hooks/register.ts` in the same task. Never hand-edit those.
- The mod (`hooks/register.ts`): no `node:` imports, no fs except through `$`, logic in pure exported functions covered by `hooks/register.test.ts`. Every handler fails open; gating handlers keep `.catch(($, e, next) => next(e))`. Routing and lane-cwd behaviour of `agent.spawn` must not change.
- The mod's tests need the mod-capable Claude Code. On this machine `claude` on PATH is 2.1.119 and has no mods; use `"$HOME/Library/Application Support/Claude/claude-code/2.1.304/6bbba6adc37f/claude.app/Contents/MacOS/claude" plugin test .` (T1 records the exact path if it differs). `claude plugin validate .` works with either.
- Skills: frontmatter `name` + `description` only; keep SKILL.md short; name actions, not tools.
- CLI tests use real git repositories (`tempRepo`, `runCli` from `test/helpers.mjs`) and pass `env: { RELAY_HOME: <temp dir> }` so no test reads or writes `~/.relay`. No test modifies the repository's own `roles/`, `flows/`, `pieces/` or `config/`: copy them to a temp dir (as `test/build.test.mjs` does) or point `RELAY_SOURCE_ROOT` at a copy.
- Each task's commit subject starts with its id: `T3: pieces, flows and their validation`.

#### Fixed names and values (binding for every task)

- **Points**, in run order: `plan.before`, `plan.after`, `lane.before`, `lane.after`, `wave.after`, `final`. Lane points: `lane.before`, `lane.after`.
- **Kinds:** `planner`, `coordinator`, `builder`, `reviewer`, `finder`. **Profile sections**, in this order, each a `## ` heading in the role body: `Understands`, `Receives`, `Delivers`, `Never`; the existing instructions follow under `## Instructions`.
- **Agent colours** (`AGENT_COLORS`): `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`. **Hex** used by HQ and the mod (`COLOR_HEX`): red `#f43f5e`, blue `#60a5fa`, green `#34d399`, yellow `#f59e0b`, purple `#8b5cf6`, orange `#fb923c`, pink `#f472b6`, cyan `#5ee7ff`; unknown colour → `#888888`.
- **Roster:**

| Role | Title | Avatar | Kind | Tier | Colour |
|---|---|---|---|---|---|
| scout | Code Scout | SC | finder | cheap | cyan |
| architect | Software Architect | AR | planner | strong | red |
| conductor | Delivery Lead | DL | coordinator | mid | pink |
| implementer-fast | Engineer | EN | builder | cheap | green |
| implementer | Software Engineer | SE | builder | mid | blue |
| implementer-deep | Senior Engineer | SR | builder | strong | purple |
| test-author | Test Engineer | TE | builder | mid | yellow |
| reviewer | Code Reviewer | CR | reviewer | mid | orange |
| business-analyst | Business Analyst | BA | planner | strong | cyan |
| platform-engineer | Platform Engineer | PE | builder | mid | green |

- **Default flow:** a plan without `"flow"` runs as `feature`. `parsePlan` sets `plan.flow = data.flow ?? 'feature'`.
- **Run directory:** `runDir(planPath, slug)` = `<main checkout>/.relay/runs/<slug>`. Before a plan exists (`--flow … --slug …`): `<mainRoot(cwd)>/.relay/runs/<slug>`.
- **Piece agent names:** `lane-<lane>-<piece>` at lane points, `<piece>` elsewhere. Brief file: `<run>/pieces/<agent>.brief.md`. Head records: `<run>/pieces.json`, shape `{ "<agent>": { "piece": "<id>", "lane": "<id>" | null, "point": "<point>", "ref": "<git ref>", "head": "<sha>", "at": "<ISO time>" } }`.
- **Refs for read-only checks:** lane points → `relay/<slug>/lane-<lane>`; `wave.after` and `final` → `relay/<slug>/integration`; plan points → `HEAD`. When the ref does not exist, use `HEAD` and record `"ref": "HEAD"`.
- **Ledger lines (fixed shapes; the board, HQ and calibration parse them):**
  - `piece <id>[ lane <lane>]: <status> (<report path>)`, status `pass` | `findings` | `blocked`;
  - read-only piece that committed: `piece <id>[ lane <lane>]: blocked (<report path>) committed: <subject>; <subject>`;
  - requires missing: `piece <id>[ lane <lane>]: skipped (requires <path> missing)`.
  - Parse regex (T11): `/^piece ([a-z0-9][a-z0-9-]*)(?: lane ([a-z]+))?: (pass|findings|blocked|skipped)\b(?: \(([^)]*)\))?/`.
- **Requirements document:** `docs/relay/requirements/<slug>.md`.
- **Source root for authoring commands:** `process.env.RELAY_SOURCE_ROOT || RELAY_ROOT` (T6 only).

#### Module interfaces (binding)

- `lib/team.mjs` (T2): `KINDS`, `PROFILE_SECTIONS`, `AGENT_COLORS`, `COLOR_HEX`, `profileOf(body)`, `roleProblems(data, body, file)`, `avatarFor(title)`, `freeColor(team)`, `loadTeam(root)` → `[{ name, file, title, avatar, color, hex, kind, tier, description, tools, readonly, maxTurns, profile, problems }]` (never throws).
- `scripts/build.mjs`: `checkRoles(root)` (T2) and `checkFlow(root)` (T3, same name as today, new meaning: validates `flows/` + `pieces/`) → problem strings; `modRouting(routing, roles)` gains `team` (T10).
- `lib/flows.mjs` (T3): `POINTS`, `LANE_POINTS`, `GATES`, `WHEN_KEYS`, `DEFAULT_FLOW`, `loadFlowSet(root)` → `{ pieces: Map, flows: Map, problems }`, `whenProblems(when, at)`, `flowProblems(set, { roles, skills })`, `effectivePiece(flow, piece)`, `matchWhen(when, tasks)`, `whenSummary(when)`, `fillPlaceholders(text, vars)`, `piecesAt({ set, flowId, point, tasks, lane, vars, exists })` → `{ apply, skipped }`, `attachPieces(plan, lanes, set, team)`, `planFlowProblems(plan, set, team)` → `{ errors, warnings }`.
- `scripts/relay-lanes.mjs` (T4): `planLanes` returns lanes with `lanes.flow`, `lanes.planPieces` and `lane.pieces = [{ piece, point, role, tier, gate, readonly }]`.
- `scripts/relay-flow.mjs` (T5, T6): `main(argv)` for `list | show | at | done | add | remove`.
- `lib/calibration.mjs` (T7): `laneModel` returns `{ id, base, p, pieces, weight }`, `weight = base·(1 + κ·p) + pieces`.
- `lib/hq/catalog.mjs` (T11): `listTeam({ home, relayRoot })` replaces `listAgents`; `wiring({ relayRoot })` returns `{ points, flows, pieces, problems, generated, edges }`.

#### API shapes (T11 produces, T12/T13 read)

- `GET /api/brain/team`: `{ team: [{ name, title, avatar, color, hex, kind, tier, description, claude: { model, effort }, codex: { model, effort }, tools, readonly, maxTurns, profile: { Understands, Receives, Delivers, Never }, appearsIn: [{ flow, point, piece }], source, generated, problems }], other: [...same as today's agents.other], roleNew: 'relay role new <name> --kind <kind> --tier <tier> --title "<title>"' }`.
- `GET /api/brain/flows`: `{ points, flows: [{ id, title, slots: { [point]: [piece view] } }], pieces: [piece view], problems, generated, edges }`; piece view = `{ piece, title, role, roleTitle, avatar, hex, gate, readonly, protect, when, brief, output, slots, skills }` where `when` is `whenSummary(...)` after the flow's overrides (in `pieces`, the piece's own) and `roleTitle` is the role's title.
- Board (`computeBoard`) gains `flow`, per lane `pieces: [{ piece, point, role, gate, status: pass|findings|blocked|skipped|pending, report }]`, and `planPieces: [{ piece, point, role, gate, status, report }]`.
- `GET /api/repos/:rid/plans/:slug` gains `team: { [role]: { title, avatar, hex } }`, per lane `pieces` (board's, with `report` absolute when the file exists, else null) and `planPieces`.
- `GET /api/home`: each `running.plans[]` entry gains `roles: [{ role, title, avatar, hex }]`.

## Review Focus

- Read-only enforcement races the fix loop: a `lane.after` piece's `flow done` must run before the lane's fix round commits, or it reports a false `blocked`. T8's text says so; check the conductor cannot read it otherwise.
- `relay flow at` ledgers a `skipped (requires …)` line on every call; repeated calls duplicate it. Accepted; check the board's last-wins parsing copes.
- `plan.before` pieces are recorded with `flow done` only after the plan exists (no ledger before that). An old plan without `flow` runs as `feature` but its plan points never run again; `requirements-check` is then skipped because the document is missing.
- Calibration: piece units now enter `laneModel`; samples from earlier runs were computed without them and `SAMPLE_VERSION` is not bumped, a small bias (the rates here are placeholders anyway).
- The mod's `agent.spawn` now awaits `next()` to read `agentId`. Confirm the fork/resume/workflow path, the deny path and the result returned are unchanged, and that a throw in tracking cannot alter the spawn.
- Board: `piece … lane a: blocked` turns lane a red through the existing BLOCKED rule (intended); `findings` does not.
- Today's test-author agent `lane-<id>-tests` becomes `lane-<id>-acceptance-tests`; the mod's `LANE_NAME` already accepts it.
- HQ renders new untrusted text (briefs, profiles, report paths) through `h()` only.
- Shared colours: business-analyst shares cyan with scout, platform-engineer green with implementer-fast (Claude Code accepts 8 agent colours); avatars tell them apart.
- `commands/plan.md` must keep step 2 as the questions step: HQ's headless prefix says "Skip step 2".

## Tasks

### T1: Verify the mod events, agent colours and Codex agent keys
Spec section 9, done before any code depends on it. Write `docs/relay/notes/2026-10-21-flows-team-facts.md` with exactly these headings, each holding the verified answer and its evidence (where you found it), or `unverified: <why>` and the fallback named below. Change nothing else in the repository; throwaway experiments go in the scratchpad.

```markdown
# Verified facts: relay flows and the team

Claude Code build: <version> at <binary path>

## agent.spawn → agentId
## turn.step
## turn.complete
## Emitting events in the test kit
## Text colours in ui.render
## Agent colours
## Codex agent TOML
```

Where to look:
- The mod-capable binary is the desktop-bundled Claude Code: `B="$HOME/Library/Application Support/Claude/claude-code/2.1.304/6bbba6adc37f/claude.app/Contents/MacOS/claude"` (run `"$B" --version`; PATH's `claude` 2.1.119 has no mods). Mod type declarations are embedded in it: `LC_ALL=C grep -a -o '.\{0,400\}turn\.step.\{0,400\}' "$B" | head`, the same for `turn.complete`, `agentId`, and the `Text` props. `"$B" plugin init <name>` in the scratchpad may scaffold a mod with typings; `"$B" plugin test <dir>` runs `*.test.ts` in a scratch mod.
- `hooks/register.test.ts` shows the default `agent.spawn` result as `{ model, agentId }`. Confirm with a scratch mod test that a handler's `await next(e)` returns `agentId` (and `model`), whether a resumed spawn keeps its `agentId`, and record it.
- **turn.step:** the event's field that names the agent (`agentId`?), and the exact usage fields (input, output, cache read, cache write tokens), with their types.
- **turn.complete:** the agent field and any time/duration field.
- **Emitting events in the test kit:** whether `$.turn.step(...)` / `$.turn.complete(...)` exist in `claude-code/testing`, and their input shapes. Fallback: the mod test calls the pure tracking functions directly.
- **Text colours:** whether `Text`'s `color` accepts `#rrggbb`, and/or which names. Fallback: map agent colours to theme names the existing code uses (`inactive`, `warning`, `success`, `error`) or to accepted names.
- **Agent colours:** the list Claude Code accepts in agent frontmatter `color:` (expected exactly `red, blue, green, yellow, purple, orange, pink, cyan`; grep the binary near those words).
- **Codex:** `codex` is not installed here. Record `unverified: codex not installed; identity stays in developer_instructions` unless current OpenAI Codex docs reachable from this machine show further agent TOML keys.

### T2: Team identity: roles, lib/team.mjs and the role check
1. Create `lib/team.mjs` exactly as below. If T1's "Agent colours" section lists a different set, use T1's list for `AGENT_COLORS` (and give any new name a hex in `COLOR_HEX`).

```js
// relay's team: each role's identity (title, avatar, colour, kind) and its
// four-part profile, read from roles/*.md. loadTeam never throws; roleProblems
// says what is wrong, naming the file and the field.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { RELAY_ROOT } from './routing.mjs';

export const KINDS = ['planner', 'coordinator', 'builder', 'reviewer', 'finder'];
export const PROFILE_SECTIONS = ['Understands', 'Receives', 'Delivers', 'Never'];
// The colour names Claude Code accepts for agents, and the hex HQ and the mod draw each with.
export const AGENT_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];
export const COLOR_HEX = { red: '#f43f5e', blue: '#60a5fa', green: '#34d399', yellow: '#f59e0b', purple: '#8b5cf6', orange: '#fb923c', pink: '#f472b6', cyan: '#5ee7ff' };
const NO_HEX = '#888888';

// "## Understands" … up to the next "## " heading, for the four profile sections.
export function profileOf(body) {
  const out = {};
  let current = null;
  for (const line of String(body ?? '').split('\n')) {
    const m = /^## +(.+?)\s*$/.exec(line);
    if (m) {
      current = PROFILE_SECTIONS.includes(m[1]) ? m[1] : null;
      if (current) out[current] = [];
    } else if (current) {
      out[current].push(line);
    }
  }
  return Object.fromEntries(
    Object.entries(out)
      .map(([k, lines]) => [k, lines.join('\n').trim()])
      .filter(([, v]) => v),
  );
}

export function roleProblems(data, body, file) {
  const out = [];
  if (typeof data.title !== 'string' || !data.title.trim()) out.push(`${file}: title is required (a job title, such as "Business Analyst")`);
  if (typeof data.avatar !== 'string' || !/^[A-Z]{2}$/.test(data.avatar)) out.push(`${file}: avatar must be two capital letters`);
  if (!KINDS.includes(data.kind)) out.push(`${file}: kind must be one of ${KINDS.join(', ')}`);
  if (!AGENT_COLORS.includes(data.color)) out.push(`${file}: color must be one of ${AGENT_COLORS.join(', ')}`);
  const profile = profileOf(body);
  for (const s of PROFILE_SECTIONS) if (!profile[s]) out.push(`${file}: profile section "## ${s}" is missing or empty`);
  return out;
}

// Initials of the title's first two words ("Quality Engineer" → QE), or its first two letters.
export function avatarFor(title) {
  const words = String(title ?? '').match(/[A-Za-z0-9]+/g) ?? [];
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase().padEnd(2, 'X');
}

// The least used agent colour, earliest in AGENT_COLORS on a tie.
export function freeColor(team) {
  const count = (c) => team.filter((r) => r.color === c).length;
  return [...AGENT_COLORS].sort((a, b) => count(a) - count(b) || AGENT_COLORS.indexOf(a) - AGENT_COLORS.indexOf(b))[0];
}

export function loadTeam(root = RELAY_ROOT) {
  const dir = join(root, 'roles');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const name = f.replace(/\.md$/, '');
      const file = `roles/${f}`;
      try {
        const { data, body } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
        return {
          name,
          file,
          title: data.title ?? '',
          avatar: data.avatar ?? '',
          color: data.color ?? '',
          hex: COLOR_HEX[data.color] ?? NO_HEX,
          kind: data.kind ?? '',
          tier: data.tier,
          description: data.description ?? '',
          tools: data.tools ?? [],
          readonly: Boolean(data.readonly),
          maxTurns: data.maxTurns ?? null,
          profile: profileOf(body),
          problems: roleProblems(data, body, file),
        };
      } catch (err) {
        return { name, file, title: '', avatar: '', color: '', hex: NO_HEX, kind: '', tier: undefined, description: '', tools: [], readonly: false, maxTurns: null, profile: {}, problems: [`${file}: ${err.message}`] };
      }
    });
}
```

2. In `scripts/build.mjs`: import `roleProblems` from `../lib/team.mjs`; add the export below; in `main`, `const problems = [...checkSkills(root), ...checkRoles(root), ...checkFlow(root)];`. Update the header comment ("Also checks every role's identity and profile").

```js
// Every role needs its identity (title, avatar, kind, color) and the four profile sections.
export function checkRoles(root = RELAY_ROOT) {
  const dir = join(root, 'roles');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .flatMap((f) => {
      try {
        const { data, body } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
        return roleProblems(data, body, `roles/${f}`);
      } catch (err) {
        return [`roles/${f}: ${err.message}`];
      }
    });
}
```

3. The eight existing roles: in the frontmatter add `title`, `avatar`, `kind` right after `tier` (values from the roster) and keep every other key and `color` as they are. In the body, insert the profile below, then the line `## Instructions`, then the existing instruction text byte for byte unchanged.

`roles/scout.md`:
```markdown
## Understands
- Where things live in a codebase: files, symbols, call sites, configs and test commands.

## Receives
- One exact question to answer, from a planner or the conductor.

## Delivers
- At most 15 lines of `path:line — note`, then a one-line answer.

## Never
- Edits files, runs tests, installs anything, or pastes more than 5 consecutive lines.
```

`roles/architect.md`:
```markdown
## Understands
- Specs, interfaces and where judgment pays: tiers, risk, test budgets, lanes and merge risk.

## Receives
- At plan time: a spec, its requirements document when there is one, scout findings and the plan-with-tiers skill.
- At the end: the whole-branch package, the ledger's deferred findings and rulings, and the plan's Review Focus.

## Delivers
- A plan that `relay lanes` accepts, or a final review of what must be fixed before merge; at most 10 lines back.

## Never
- Implements or edits code, reads the codebase file by file, or reports style preferences as findings.
```

`roles/conductor.md`:
```markdown
## Understands
- The run-lanes procedure, the ledger, budget levels, and when a ruling beats a question.

## Receives
- A plan path to run from start to finish.

## Delivers
- A reviewed integration branch, a complete ledger, and a final report of at most 40 lines with every ruling.

## Never
- Implements, tests or fixes code itself, or pauses to check in outside the stop reasons.
```

`roles/implementer-fast.md`:
```markdown
## Understands
- How to transcribe complete plan code exactly, one task per commit.

## Receives
- A lane brief whose tasks carry the complete code, or a one-file mechanical edit.

## Delivers
- One commit per task, verified by its `done` command, and a report.

## Never
- Redesigns, renames or improvises past the plan text, dispatches subagents, or edits protected tests.
```

`roles/implementer.md`:
```markdown
## Understands
- Multi-file changes, integration and debugging inside one lane's part of the codebase.

## Receives
- A lane brief (global constraints, tasks, files, test budgets, `done` checks); later, review findings to fix.

## Delivers
- One commit per task, tests within budget, rulings on ambiguity, and a report.

## Never
- Runs the full suite, edits protected tests, dispatches subagents, or strays from the task's files without saying why.
```

`roles/implementer-deep.md`:
```markdown
## Understands
- Root causes, subtle concurrency and broad refactors, and why a previous attempt failed.

## Receives
- A brief, the previous report and the open review findings, or a task the plan marks strong.

## Delivers
- The smallest change that removes the root cause, committed, with the cause stated in one paragraph.

## Never
- Patches around a wrong approach, dispatches subagents, or carries on when every path is a guess.
```

`roles/test-author.md`:
```markdown
## Understands
- QA: which few tests catch real bugs, with boundaries and error partitions, from the spec alone.

## Receives
- The spec, the lane brief (behaviors, risk, test budget) and the public interfaces to test.

## Delivers
- Failing acceptance tests committed on their own, and the paths to protect.

## Never
- Reads the implementation under test, takes expected values from running code, or exceeds the budget.
```

`roles/reviewer.md`:
```markdown
## Understands
- Spec compliance, correctness risk and test quality as the qa-mindset skill defines it.

## Receives
- The lane brief, the implementer's report and the review package; for a re-review, the findings and the fix diff.

## Delivers
- Per task a spec verdict and a quality verdict, with findings at `path:line` labelled Critical / Important / Minor.

## Never
- Edits files or commits, reruns tests the report already ran, or reports style preferences.
```

4. Create `roles/business-analyst.md` exactly:

```markdown
---
name: business-analyst
tier: strong
title: Business Analyst
avatar: BA
kind: planner
description: Writes the requirements document (R1…Rn with Given / When / Then) before a plan, and checks the finished branch against it. Use for the requirements and requirements-check pieces.
tools: Read, Grep, Glob, Bash, Write
maxTurns: 30
color: cyan
---
## Understands
- Requirements: actors, needs, acceptance criteria, and what is out of scope.

## Receives
- Before the plan: the spec and any documents under `docs/requirements/`.
- At the end: the integration branch and its requirements document.

## Delivers
- `docs/relay/requirements/<slug>.md` with R1…Rn, or a check of every R as met, partial or missing, with evidence.

## Never
- Writes code, tests or plans, or edits any file but its own documents.

## Instructions
You are relay's business analyst. You turn a spec into requirements everyone can check, and at the end you check them.

Your piece brief says which of the two jobs this is. Read it first, then the files it names.

**Requirements (before the plan).** Write the document the brief names, and nothing else:
1. Requirements R1…Rn, each with its actor, the need, and acceptance criteria as Given / When / Then.
2. Out of scope: what this work does not do.
3. Open questions, each with the assumption you took so planning can go on.

Keep every requirement observable: something a test or a reviewer can confirm. Number them once; later documents refer to the ids.

**Requirements check (at the end).** You are read-only: never edit files, never commit. For each R, record met, partial or missing, with evidence: the tests, files and behaviours that show it. Every partial or missing R is an Important finding with a one-line fix direction.

Write your report to the report path you were given. Return at most 5 lines:
STATUS: DONE | NEEDS_CONTEXT | BLOCKED
result: pass | findings
requirements: <count> (for a check: met <n>, partial <n>, missing <n>)
report: <path>
```

5. Create `roles/platform-engineer.md` exactly:

```markdown
---
name: platform-engineer
tier: mid
title: Platform Engineer
avatar: PE
kind: builder
description: Implements infra, CI/CD, deploy, configuration and observability tasks in a lane worktree, and reviews lanes for deployability. Use for tasks with role platform-engineer and for the platform-review piece.
tools: Read, Edit, Write, Bash, Grep, Glob
maxTurns: 80
color: green
---
## Understands
- Infrastructure as code, CI/CD pipelines, deploys and rollbacks, secrets and configuration, logs, metrics and health checks.

## Receives
- A lane brief whose tasks carry `role: platform-engineer`; or, for a review, a piece brief naming the lane brief, its report and its changes.

## Delivers
- One commit per task, verified by its `done` check; or a deployability review with findings labelled Critical / Important / Minor.

## Never
- Deploys, pushes or applies changes outside the repository, puts a secret value in a file, or commits during a review.

## Instructions
You are relay's platform engineer. You own what it takes to ship and run the code: infrastructure, pipelines, deploys, configuration and observability.

**Implementing** (your agent name is a lane, `lane-<id>` or `lane-<id>-s<n>`). Read your brief file first; it is your requirements, and its exact values are binding. For each task assigned to you, in order:
1. Make the smallest change that meets the task's behaviors, following the repository's existing infra and pipeline patterns.
2. Verify with the task's `done` command and the narrowest local check the tooling offers (validate, lint, plan or dry-run). Never apply, deploy or push: changing a real environment is the human's step.
3. Commit: `git commit -m "<task id>: <title>"`.

**Reviewing** (the platform-review piece). You are read-only: never edit files, never commit. For the lane's changes, check rollout and rollback; secrets and configuration (no values in files, every new setting documented with its default); reversible migrations; and logs, metrics and health checks for what was added. Report only what can break a deploy or an incident response, each finding at `path:line`, labelled Critical / Important / Minor, with a one-line fix direction.

Never dispatch subagents. Never edit protected tests. If the brief is ambiguous, decide, record `Ruling: <what> — <why> — <cost if wrong>` in your report, and continue.

Write the full report to the report path you were given. Return at most 8 lines:
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
commits: <first7>..<last7> (none for a review)
result: pass | findings (for a review)
report: <path>
concerns: <one line or none>
```

6. `config/routing.json`: `budget.critical.denyNewSpawns` becomes `["implementer", "implementer-fast", "implementer-deep", "test-author", "platform-engineer"]`.
7. Run `node bin/relay build` and commit the regenerated `agents/*.md`, `codex/agents/relay-*.toml` and the generated block of `hooks/register.ts` (it gains the two roles and the new deny entry). The Claude agents carry no `title`/`avatar`/`kind` keys; the profile reaches both harnesses through the body.

Tests: none new here; T3's build test covers a role without its profile. `test/build.test.mjs`'s existing `--check` test must pass.

### T3: Pieces, flows and their validation in relay build
1. Create `lib/flows.mjs` exactly:

```js
// Flows and pieces: building blocks at fixed points around relay's lane chassis.
// pieces/<id>.json is one block (role, allowed points, when it applies, brief,
// output); flows/<id>.json places pieces at points. The CLI resolves them, never a model.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchesAny } from './glob.mjs';
import { RISKS } from './plan.mjs';
import { RELAY_ROOT, TIERS } from './routing.mjs';
import { loadTeam } from './team.mjs';

export const POINTS = ['plan.before', 'plan.after', 'lane.before', 'lane.after', 'wave.after', 'final'];
export const LANE_POINTS = ['lane.before', 'lane.after'];
export const GATES = ['blocking', 'advisory'];
export const WHEN_KEYS = ['any', 'risk', 'tier', 'testsAtLeast', 'files', 'tags'];
export const DEFAULT_FLOW = 'feature';
const PIECE_KEYS = ['id', 'title', 'role', 'slots', 'skills', 'when', 'requires', 'brief', 'output', 'gate', 'readonly', 'protect'];
const FLOW_KEYS = ['id', 'title', 'slots', 'overrides'];
const OVERRIDABLE = ['when', 'gate'];
const KEBAB = /^[a-z0-9][a-z0-9-]*$/;
const PLACEHOLDER = /\{([^}]*)\}/g;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

function readJsonDir(root, dirName, problems) {
  const out = new Map();
  const dir = join(root, dirName);
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let value;
    try {
      value = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      problems.push(`${dirName}/${f}: not valid JSON`);
      continue;
    }
    if (!isObj(value)) problems.push(`${dirName}/${f}: must be a JSON object`);
    else out.set(f.replace(/\.json$/, ''), value);
  }
  return out;
}

// Never throws: unreadable files become problems.
export function loadFlowSet(root = RELAY_ROOT) {
  const problems = [];
  const pieces = readJsonDir(root, 'pieces', problems);
  const flows = readJsonDir(root, 'flows', problems);
  return { pieces, flows, problems };
}

export function whenProblems(when, at) {
  if (when === undefined) return [];
  if (!isObj(when)) return [`${at}: when must be an object`];
  const out = [];
  for (const [k, v] of Object.entries(when)) {
    if (!WHEN_KEYS.includes(k)) out.push(`${at}: unknown when key "${k}" (keys: ${WHEN_KEYS.join(', ')})`);
    else if (k === 'any') {
      if (!Array.isArray(v) || !v.length) out.push(`${at}: when.any must be a non-empty list of conditions`);
      else v.forEach((w, i) => out.push(...whenProblems(w, `${at} when.any[${i}]`)));
    } else if (k === 'risk' && !(strings(v) && v.length && v.every((x) => RISKS.includes(x)))) out.push(`${at}: when.risk must list risks (${RISKS.join(', ')})`);
    else if (k === 'tier' && !(strings(v) && v.length && v.every((x) => TIERS.includes(x)))) out.push(`${at}: when.tier must list tiers (${TIERS.join(', ')})`);
    else if (k === 'testsAtLeast' && !(Number.isInteger(v) && v >= 0)) out.push(`${at}: when.testsAtLeast must be a whole number >= 0`);
    else if ((k === 'files' || k === 'tags') && !(strings(v) && v.length)) out.push(`${at}: when.${k} must be a non-empty list of strings`);
  }
  return out;
}

function placeholderProblems(text, allowed, at, field) {
  return [...String(text).matchAll(PLACEHOLDER)]
    .filter((m) => !allowed.includes(m[1]))
    .map((m) => `${at}: ${field} placeholder "{${m[1]}}" is not valid for its points (allowed: ${allowed.map((a) => `{${a}}`).join(', ')})`);
}

function pieceProblems(id, p, { roles, skills }) {
  const at = `pieces/${id}.json`;
  const out = [];
  if (p.id !== id) out.push(`${at}: id must be "${id}" (the file name)`);
  if (!KEBAB.test(id)) out.push(`${at}: id must be kebab-case`);
  for (const k of Object.keys(p)) if (!PIECE_KEYS.includes(k) && !k.startsWith('$')) out.push(`${at}: unknown field "${k}"`);
  if (typeof p.title !== 'string' || !p.title) out.push(`${at}: title is required`);
  if (!roles.has(p.role)) out.push(`${at}: role "${p.role}" is not a role in roles/`);
  if (!strings(p.slots) || !p.slots.length) out.push(`${at}: slots must list the points it may sit at (${POINTS.join(', ')})`);
  else for (const s of p.slots) if (!POINTS.includes(s)) out.push(`${at}: slot "${s}" is not a point (${POINTS.join(', ')})`);
  if (p.skills !== undefined && !strings(p.skills)) out.push(`${at}: skills must be a list of skill folders`);
  for (const s of strings(p.skills) ? p.skills : []) if (!skills.has(s)) out.push(`${at}: skill "${s}" is not a folder in skills/`);
  out.push(...whenProblems(p.when, at));
  if (p.requires !== undefined && !strings(p.requires)) out.push(`${at}: requires must be a list of paths`);
  for (const r of strings(p.requires) ? p.requires : []) out.push(...placeholderProblems(r, ['slug', 'run'], at, 'requires'));
  if (typeof p.brief !== 'string' || !p.brief.trim()) out.push(`${at}: brief is required`);
  if (typeof p.output !== 'string' || !p.output) out.push(`${at}: output is required`);
  else {
    const laneOnly = strings(p.slots) && p.slots.length > 0 && p.slots.every((s) => LANE_POINTS.includes(s));
    out.push(...placeholderProblems(p.output, laneOnly ? ['slug', 'run', 'lane'] : ['slug', 'run'], at, 'output'));
  }
  if (!GATES.includes(p.gate)) out.push(`${at}: gate must be one of ${GATES.join(', ')}`);
  for (const k of ['readonly', 'protect']) if (p[k] !== undefined && typeof p[k] !== 'boolean') out.push(`${at}: ${k} must be true or false`);
  if (p.readonly === true && p.protect === true) out.push(`${at}: a read-only piece cannot write protected tests`);
  return out;
}

function flowFileProblems(id, f, pieces) {
  const at = `flows/${id}.json`;
  const out = [];
  if (f.id !== id) out.push(`${at}: id must be "${id}" (the file name)`);
  for (const k of Object.keys(f)) if (!FLOW_KEYS.includes(k) && !k.startsWith('$')) out.push(`${at}: unknown field "${k}"`);
  if (typeof f.title !== 'string' || !f.title) out.push(`${at}: title is required`);
  if (!isObj(f.slots)) return [...out, `${at}: slots must map points to lists of pieces`];
  for (const [point, ids] of Object.entries(f.slots)) {
    if (!POINTS.includes(point)) {
      out.push(`${at}: "${point}" is not a point (${POINTS.join(', ')})`);
      continue;
    }
    if (!strings(ids)) {
      out.push(`${at}: slots.${point} must be a list of piece ids`);
      continue;
    }
    ids.forEach((pid, i) => {
      const p = pieces.get(pid);
      if (ids.indexOf(pid) !== i) out.push(`${at}: piece "${pid}" is placed twice at ${point}`);
      else if (!p) out.push(`${at}: piece "${pid}" at ${point} does not exist in pieces/`);
      else if (!strings(p.slots) || !p.slots.includes(point)) out.push(`${at}: piece "${pid}" cannot sit at ${point} (its slots: ${strings(p.slots) ? p.slots.join(', ') : 'none'})`);
    });
  }
  if (f.overrides !== undefined && !isObj(f.overrides)) out.push(`${at}: overrides must be an object`);
  const placed = new Set(Object.values(f.slots).filter(strings).flat());
  for (const [pid, o] of Object.entries(isObj(f.overrides) ? f.overrides : {})) {
    const where = `${at} overrides.${pid}`;
    if (!placed.has(pid)) out.push(`${where}: the piece is not placed in this flow`);
    if (!isObj(o)) {
      out.push(`${where}: must be an object`);
      continue;
    }
    for (const k of Object.keys(o)) if (!OVERRIDABLE.includes(k)) out.push(`${where}: ${k} cannot be overridden (only ${OVERRIDABLE.join(', ')})`);
    out.push(...whenProblems(o.when, where));
    if (o.gate !== undefined && !GATES.includes(o.gate)) out.push(`${where}: gate must be one of ${GATES.join(', ')}`);
  }
  return out;
}

// roles: Map of role name → team member; skills: Set of skill folder names.
export function flowProblems(set, { roles, skills }) {
  const out = [];
  for (const [id, p] of set.pieces) out.push(...pieceProblems(id, p, { roles, skills }));
  for (const [id, f] of set.flows) out.push(...flowFileProblems(id, f, set.pieces));
  if (!set.flows.has(DEFAULT_FLOW)) out.push(`flows/${DEFAULT_FLOW}.json is missing (plans without "flow" run as ${DEFAULT_FLOW})`);
  return out;
}

export function effectivePiece(flow, piece) {
  const o = isObj(flow?.overrides?.[piece.id]) ? flow.overrides[piece.id] : {};
  const out = { ...piece };
  for (const k of OVERRIDABLE) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

// All keys must hold; `any` holds when one of its conditions does. Missing `when` = always.
export function matchWhen(when, tasks) {
  if (!isObj(when)) return true;
  return Object.entries(when).every(([k, v]) => {
    if (k === 'any') return Array.isArray(v) && v.some((w) => matchWhen(w, tasks));
    if (k === 'risk') return v.includes(RISKS[Math.max(-1, ...tasks.map((t) => RISKS.indexOf(t.risk)))]);
    if (k === 'tier') return tasks.some((t) => v.includes(t.tier));
    if (k === 'testsAtLeast') return tasks.reduce((s, t) => s + (t.tests ?? 0), 0) >= v;
    if (k === 'files') return tasks.some((t) => (t.files ?? []).some((f) => matchesAny(f, v)));
    if (k === 'tags') return tasks.some((t) => (t.tags ?? []).some((x) => v.includes(x)));
    return false;
  });
}

export function whenSummary(when) {
  if (!isObj(when) || !Object.keys(when).length) return 'always';
  const part = ([k, v]) => {
    if (k === 'any') return `any of (${v.map(whenSummary).join(' | ')})`;
    if (k === 'testsAtLeast') return `tests >= ${v}`;
    return `${k} ${[].concat(v).join(', ')}`;
  };
  return Object.entries(when).map(part).join(' and ');
}

// Unknown placeholders stay as written.
export function fillPlaceholders(text, vars) {
  return String(text).replace(PLACEHOLDER, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

// The pieces of a flow at one point, for a lane's tasks (lane points) or the plan's.
// vars: { slug, run, lane }; exists(path) checks a filled `requires` path.
export function piecesAt({ set, flowId, point, tasks, lane, vars, exists = existsSync }) {
  const flow = set.flows.get(flowId);
  if (!flow) throw new Error(`unknown flow "${flowId}"`);
  const apply = [];
  const skipped = [];
  for (const id of flow.slots?.[point] ?? []) {
    const raw = set.pieces.get(id);
    if (!raw) {
      skipped.push({ piece: id, kind: 'missing', reason: `pieces/${id}.json does not exist` });
      continue;
    }
    const piece = effectivePiece(flow, raw);
    if (!matchWhen(piece.when, tasks)) {
      skipped.push({ piece: id, kind: 'when', reason: `when ${whenSummary(piece.when)} does not hold` });
      continue;
    }
    const missing = (piece.requires ?? []).map((r) => fillPlaceholders(r, vars)).find((p) => !exists(p));
    if (missing !== undefined) {
      skipped.push({ piece: id, kind: 'requires', reason: `requires ${missing} missing` });
      continue;
    }
    apply.push({ ...piece, point, agent: lane ? `lane-${lane}-${id}` : id, report: fillPlaceholders(piece.output, vars) });
  }
  return { apply, skipped };
}

// Lanes from computeLanes plus the pieces that apply to each lane (lane points) and
// to the plan (wave.after, final), by `when` only; `relay flow at` checks `requires`.
export function attachPieces(plan, lanes, set = loadFlowSet(), team = loadTeam()) {
  const flowId = plan.flow ?? DEFAULT_FLOW;
  const flow = set.flows.get(flowId);
  const tierOf = new Map(team.map((r) => [r.name, r.tier]));
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const at = (point, tasks) =>
    (flow?.slots?.[point] ?? [])
      .map((id) => set.pieces.get(id))
      .filter(Boolean)
      .map((p) => effectivePiece(flow, p))
      .filter((p) => matchWhen(p.when, tasks))
      .map((p) => ({ piece: p.id, point, role: p.role, tier: tierOf.get(p.role) ?? 'mid', gate: p.gate, readonly: Boolean(p.readonly) }));
  for (const w of lanes.waves) {
    for (const lane of w.lanes) {
      const tasks = lane.tasks.map((id) => byId.get(id)).filter(Boolean);
      lane.pieces = LANE_POINTS.flatMap((point) => at(point, tasks));
    }
  }
  lanes.flow = flowId;
  lanes.planPieces = ['wave.after', 'final'].flatMap((point) => at(point, plan.tasks));
  return lanes;
}

// The plan's flow, task roles (builders only) and tags.
export function planFlowProblems(plan, set = loadFlowSet(), team = loadTeam()) {
  const errors = [];
  const warnings = [];
  const flowId = plan.flow ?? DEFAULT_FLOW;
  if (typeof flowId !== 'string' || !set.flows.has(flowId)) errors.push(`flow "${flowId}" is not a flow (known: ${[...set.flows.keys()].sort().join(', ') || 'none'})`);
  const roles = new Map(team.map((r) => [r.name, r]));
  const builders = team.filter((r) => r.kind === 'builder').map((r) => r.name);
  for (const t of plan.tasks) {
    const at = `task ${t.id}`;
    if (t.tags !== undefined && !strings(t.tags)) errors.push(`${at}: tags must be a list of strings`);
    if (t.role === undefined) continue;
    const r = roles.get(t.role);
    if (!r) errors.push(`${at}: role "${t.role}" is not a role in roles/`);
    else if (r.kind !== 'builder') errors.push(`${at}: role "${t.role}" is a ${r.kind || 'role without a kind'}; a task's role must be a builder (${builders.join(', ')})`);
    else if (r.tier !== t.tier) warnings.push(`${at}: tier ${t.tier} differs from ${t.role}'s tier ${r.tier}; the role's tier decides the model`);
  }
  return { errors, warnings };
}
```

2. Create the five pieces and two flows exactly (2-space JSON, trailing newline).

`pieces/acceptance-tests.json`:
```json
{
  "id": "acceptance-tests",
  "title": "Acceptance tests first",
  "role": "test-author",
  "slots": ["lane.before"],
  "skills": ["qa-mindset"],
  "when": { "risk": ["medium", "high"], "testsAtLeast": 1 },
  "requires": [],
  "brief": "Write the lane's acceptance tests before any implementation, from the spec and the behaviors in the lane brief, within each task's new-test budget. Do not read the implementation. Commit them on their own as \"<task id>: acceptance tests\" and list every test path you wrote after protect: in your return.",
  "output": "{run}/lane-{lane}.acceptance-tests.md",
  "gate": "blocking",
  "readonly": false,
  "protect": true
}
```

`pieces/reproduce.json`:
```json
{
  "id": "reproduce",
  "title": "Reproduce the bug",
  "role": "test-author",
  "slots": ["lane.before"],
  "skills": ["qa-mindset"],
  "requires": [],
  "brief": "Write exactly one test that fails because of the bug this lane fixes, from the spec and the lane brief. Fix nothing. Run it once and confirm it fails for the bug's reason, not a setup error. Commit it on its own as \"<task id>: acceptance tests\" and list its path after protect: in your return.",
  "output": "{run}/lane-{lane}.reproduce.md",
  "gate": "blocking",
  "readonly": false,
  "protect": true
}
```

`pieces/requirements.json`:
```json
{
  "id": "requirements",
  "title": "Requirements",
  "role": "business-analyst",
  "slots": ["plan.before"],
  "skills": [],
  "requires": [],
  "brief": "From the spec, and any documents under docs/requirements/, write docs/relay/requirements/{slug}.md: requirements R1…Rn, each with actor, need and acceptance criteria (Given / When / Then); what is out of scope; open questions, each with the assumption taken. Write only that file; commit nothing.",
  "output": "docs/relay/requirements/{slug}.md",
  "gate": "blocking",
  "readonly": false
}
```

`pieces/requirements-check.json`:
```json
{
  "id": "requirements-check",
  "title": "Requirements check",
  "role": "business-analyst",
  "slots": ["final"],
  "skills": [],
  "requires": ["docs/relay/requirements/{slug}.md"],
  "brief": "Check the integration branch against docs/relay/requirements/{slug}.md. For each R record met, partial or missing, with evidence: tests, files, behaviours. Report every partial or missing R as an Important finding with a one-line fix direction. Do not edit files.",
  "output": "{run}/final.requirements-check.md",
  "gate": "blocking",
  "readonly": true
}
```

`pieces/platform-review.json`:
```json
{
  "id": "platform-review",
  "title": "Deployability review",
  "role": "platform-engineer",
  "slots": ["lane.after"],
  "skills": [],
  "when": { "any": [{ "files": ["infra/**", ".github/workflows/**", "**/Dockerfile", "**/*.tf", "k8s/**", "deploy/**"] }, { "tags": ["infra"] }] },
  "requires": [],
  "brief": "Review the lane's changes for deployability: rollout and rollback, secrets and configuration, reversible migrations, and logs, metrics and health checks for what was added. Do not edit files.",
  "output": "{run}/lane-{lane}.platform-review.md",
  "gate": "blocking",
  "readonly": true
}
```

`flows/feature.json`:
```json
{
  "id": "feature",
  "title": "Feature",
  "slots": {
    "plan.before": ["requirements"],
    "lane.before": ["acceptance-tests"],
    "lane.after": ["platform-review"],
    "final": ["requirements-check"]
  }
}
```

`flows/bugfix.json`:
```json
{
  "id": "bugfix",
  "title": "Bug fix",
  "slots": {
    "lane.before": ["reproduce", "acceptance-tests"],
    "lane.after": ["platform-review"]
  }
}
```

3. `scripts/build.mjs`: replace `checkFlow` with the version below (same name; `lib/hq/catalog.mjs` keeps importing it), import `loadFlowSet`, `flowProblems` from `../lib/flows.mjs` and `loadTeam` from `../lib/team.mjs`, and update the header comment ("Also validates flows/ and pieces/: every piece, role, skill and point they name must exist"). Delete `config/flow.json`. Keep `cliSubcommands`.

```js
// flows/ and pieces/: every piece, role, skill, point and placeholder must resolve.
export function checkFlow(root = RELAY_ROOT) {
  const set = loadFlowSet(root);
  const roles = new Map(loadTeam(root).map((r) => [r.name, r]));
  const skills = new Set(readdirSync(join(root, 'skills')).filter((d) => existsSync(join(root, 'skills', d, 'SKILL.md'))));
  return [...set.problems, ...flowProblems(set, { roles, skills })];
}
```

4. `test/build.test.mjs`: replace the test `build --check fails when config/flow.json names a role or skill that does not exist` with one test, `build --check fails for a piece with an unknown role, a piece placed outside its slots, and a role without its profile`. Copy `['agents', 'bin', 'codex', 'config', 'flows', 'hooks', 'pieces', 'roles', 'skills']` to a temp dir; assert `main(['--check'], dir) === 0`; then (a) write `pieces/ghost.json` as a copy of `pieces/platform-review.json` with `id: "ghost"` and `role: "no-such-role"`; (b) add `"requirements"` to `slots["lane.after"]` in `flows/feature.json`; (c) remove the `## Never` heading and its text from `roles/scout.md`. Assert `checkFlow(dir)` matches `/pieces\/ghost\.json: role "no-such-role" is not a role/` and `/flows\/feature\.json: piece "requirements" cannot sit at lane\.after/`, `checkRoles(dir)` matches `/roles\/scout\.md: profile section "## Never"/`, and `main(['--check'], dir) === 1`. Import `checkRoles` alongside `checkFlow`.

### T4: Plans choose a flow; task roles and tags in relay lanes
- `lib/plan.mjs` `parsePlan`: add `flow: data.flow ?? 'feature'` to the returned plan (comment: a plan without `flow` runs as feature). `validatePlan` gains: `role`, when present, must be a non-empty string (`task T1: role must be a role name`). Everything else about roles, tags and the flow is checked in `planFlowProblems`.
- `lib/lanes.mjs`: `segmentsFor` splits consecutive runs on `key = t.role ?? (t.tier === 'strong' ? 'strong' : 'default')` (a run continues while the key is equal); a segment's `role` is `r.tasks[0].role ?? roleFor(r.tasks)`. Agent names stay `null`, `s2`, `s3`… Update the comment above `roleFor` ("…and tasks with their own role get theirs").
- `scripts/relay-lanes.mjs` `planLanes`: after `validatePlan`, load `const set = loadFlowSet(); const team = loadTeam();`, append `planFlowProblems(plan, set, team)` errors and warnings; return early on errors as today; after `computeLanes`, call `attachPieces(plan, lanes, set, team)`.
- `renderBrief`: after the `Tier: …` line add `Flow: ${plan.flow}`; in each task's metadata add `- role: <role>` and `- tags: a, b` when set.
- `main` (human output): keep the summary line exactly (`plan <slug>: <n> tasks → <n> lanes in <n> wave(s)`; the build test matches it), then print `flow <flow>`; append ` · pieces <id>, <id>` to a lane's line when `lane.pieces` is non-empty. `--json` prints the lanes object, which now carries `flow`, `planPieces` and `lane.pieces`.
- `test/lanes.test.mjs`: one new test through the CLI on a real repo (`tempRepo`, `runCli(['lanes', plan, '--json'], { cwd: dir, env: { RELAY_HOME } })`). A plan without `flow` with tasks T1 (`src/a.mjs`, mid), T2 (`infra/main.tf`, `"role": "platform-engineer"`, mid, deps T1), T3 (`src/a.mjs`, mid, deps T2): assert exit 0, `flow === 'feature'`, one lane whose segments are `[[null,'implementer','T1'],['s2','platform-engineer','T2'],['s3','implementer','T3']]` (agent, role, tasks joined by `+`) and whose `pieces` include `platform-review`. Then the same plan with T2's role `reviewer`: exit 1, stderr matches `/task T2: role "reviewer" is a reviewer; a task's role must be a builder/`.

### T5: relay flow list, show, at and done
Create `scripts/relay-flow.mjs` (header comment: usage lines below) and add to `bin/relay`'s `COMMANDS`, after `lanes`: `flow: ['../scripts/relay-flow.mjs', 'flows and pieces: list | show <flow> | at <plan> <point> [--lane id] | done <plan> <piece> --status S --report P | add | remove']`. The source of flows, pieces and roles is `RELAY_ROOT` here (T6 adds `RELAY_SOURCE_ROOT` for authoring).

Usage (`relay flow` with no subcommand or an unknown one prints this and exits 64):
```text
relay flow list
relay flow show <flow>
relay flow at <plan> <point> [--lane <id>] [--json]
relay flow at --flow <flow> --slug <slug> <point> [--json]
relay flow done <plan> <piece> [--lane <id>] --status pass|findings|blocked --report <path> [--protect <path>...]
```

**list:** one line per flow `<id>  <title>  plan.before: a · lane.before: b, c …` (points in run order, empty points omitted), a blank line, then one line per piece `<id>  role <role> · slots <a, b> · <gate>[ · read-only][ · protects tests]`.

**show <flow>:** `<id> — <title>`, then for every point in run order `<point>` followed by an indented line per piece `<id>  <role> · <gate> · when <whenSummary>` (effective piece, overrides applied) or `  (none)`. Unknown flow: `✗ unknown flow "<x>" (flows: …)`, exit 1.

**at:** parse with `parseArgs(argv, { booleans: ['json'] })`.
1. Point: unknown → stderr `✗ unknown point "<p>" (points: plan.before, plan.after, lane.before, lane.after, wave.after, final)`, exit 64.
2. Plan form: `planLanes(planPath)`; on errors print them (`✗ …`) and exit 1. `flowId = plan.flow`, `slug = plan.slug`, `root = mainRoot(dirname(resolve(planPath)))`, `run = runDir(planPath, slug)`. Lane points need `--lane` (missing → exit 64 `✗ <point> needs --lane <id>`); an unknown lane → exit 1 `✗ plan <slug> has no lane "<id>" (lanes: a, b)`. Tasks = the lane's tasks, else all plan tasks.
3. `--flow` form: requires `--slug` (kebab-case) and a non-lane point (lane point → exit 64 `✗ lane points need a plan`); unknown flow → exit 1; `root = mainRoot(process.cwd())` (not in a repo → exit 1), `run = join(root, '.relay', 'runs', slug)`, tasks `[]`.
4. `piecesAt({ set, flowId, point, tasks, lane, vars: { slug, run, lane }, exists: (p) => existsSync(resolve(root, p)) })`. Resolve each `report` with `resolve(root, report)`.
5. For each applicable piece write `<run>/pieces/<agent>.brief.md` (mkdir -p), overwriting:

```text
# Piece <id>: <title>

Point: <point> · Flow: <flow> · Role: <role> · Gate: <gate> · Read-only: <yes|no>
Plan: <absolute plan path>                       ← or "Plan: not written yet (slug <slug>)"
Spec: <the plan's **Spec:** line>                ← only when the plan has one
Lane: <id> · brief <run>/lane-<id>.brief.md · branch relay/<slug>/lane-<id>   ← lane points only
Report: <absolute report path>
Skills: <a, b>                                   ← only when the piece names skills
Can read:                                        ← only when the list is non-empty
- <path>

## What to do

<the piece's brief, placeholders filled>

## Rules

- <readonly: "You are read-only: never edit files, never commit." | otherwise: "Write only what the instruction names; commit tests on their own.">
- <protect only: "List every test path you wrote after protect: in your return; they become protected tests.">

## Return

At most 5 lines:
STATUS: DONE | NEEDS_CONTEXT | BLOCKED
result: pass | findings
report: <absolute report path>
protect: <paths>                                 ← protect only
```
"Can read" lists, in this order and only if the file exists: the resolved outputs of every other piece placed anywhere in the flow (for lane-output pieces, filled with this lane; skipped when the output needs `{lane}` and there is no lane), then `<run>/lane-<lane>.report.md` at `lane.after`.
6. For each read-only applicable piece, record `{ piece, lane: lane ?? null, point, ref, head, at }` under its agent in `<run>/pieces.json` (read-modify-write; other entries kept). `ref`/`head` per Global Constraints, via `git(['rev-parse', '--verify', '--quiet', ref], root, { allowFail: true })` from `lib/git.mjs`.
7. Plan form only: for each skip of kind `requires`, `appendLedger(planPath, \`piece <id>[ lane <l>]: skipped (requires <path> missing)\`)`.
8. Output. Human: one line per applicable piece `<piece>  <role> · <gate>[ · read-only]  agent <agent>  brief <brief path>  report <report path>`, then `skip <piece>: <reason>` lines; nothing applicable and nothing skipped → `(no pieces at <point>)`. `--json`: `{ point, flow, slug, lane: lane ?? null, pieces: [{ piece, title, role, gate, readonly, protect, agent, brief, report }], skipped: [{ piece, kind, reason }] }`. Exit 0.

**done:** before `parseArgs`, pull `--protect` and every following argument up to the next `--…` out of argv into `protect: string[]`.
1. `--status` must be `pass`, `findings` or `blocked`, `--report` must be given; else exit 64 with the usage. Plan errors → exit 1. Unknown piece → exit 1 `✗ unknown piece "<id>"`.
2. `agent = lane ? \`lane-${lane}-${piece}\` : piece`; `tag = \`piece ${piece}${lane ? \` lane ${lane}\` : ''}\``.
3. Protect: if the piece has `protect: true`, `--status pass` and no paths → exit 1 `✗ <piece> writes protected tests: --status pass needs --protect <path>...`, nothing ledgered. With paths, call `main(['add', ...paths])` from `scripts/relay-protect.mjs` before ledgering.
4. Read-only: look up `pieces.json[agent]`; no record → exit 1 `✗ no relay flow at record for <agent>; run relay flow at first`, nothing ledgered. Else `now = rev-parse(ref)`; if `now !== head`: subjects = `git log --format=%s <head>..<now>` (one per line), ledger `${tag}: blocked (${report}) committed: ${subjects.join('; ')}`, print it, print `✗ <agent> is read-only and committed; rule on it (nothing was reset)` on stderr, exit 1 — whatever `--status` said.
5. Otherwise ledger `${tag}: ${status} (${report})` with `appendLedger`, print the line, exit 0. `report` is written as given on the command line.

`test/flow.test.mjs`, two tests, both on a `tempRepo` with this plan copied in as `docs/relay/plans/demo.md` (slug `demo`, no `flow`) and `env: { RELAY_HOME: <temp> }`: T1 `infra/main.tf` (mid, low, tests 0), T2 `src/a.mjs` (mid, medium, behaviors 1, tests 1), T3 `docs/x.md` (cheap, complete, low, tests 0); lanes a, b, c in that order.
1. `relay flow at`: `lane.after --lane a --json` gives exactly `platform-review` with agent `lane-a-platform-review`, report `<run>/lane-a.platform-review.md`, and its brief file exists and contains `## What to do`; running it again gives the same agent and brief path; `lane.before --lane c --json` applies nothing and skips `acceptance-tests` with kind `when`, while `--lane b` applies `acceptance-tests`; `final --json` skips `requirements-check` with a reason matching `/requires docs\/relay\/requirements\/demo\.md missing/` and the ledger has `piece requirements-check: skipped (requires docs/relay/requirements/demo.md missing)`; `relay flow at <plan> nowhere` exits 64.
2. `relay flow done` for a read-only piece: create branch `relay/demo/lane-a`; `flow at … lane.after --lane a`; `flow done <plan> platform-review --lane a --status pass --report r.md` exits 0 and the ledger has a line matching `/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: \[[^\]]*\])? piece platform-review lane a: pass \(r\.md\)$/m`; `flow at` again, commit `oops: edit` on `relay/demo/lane-a`, then `flow done … --status pass` exits 1 and the ledger has `piece platform-review lane a: blocked (r.md) committed: oops: edit`; boundary: `flow done <plan> acceptance-tests --lane b --status pass --report t.md` without `--protect` exits 1.

### T6: Authoring: relay flow add/remove, relay piece new, relay role new
All three write under `src = process.env.RELAY_SOURCE_ROOT || RELAY_ROOT` and end by printing `run \`relay build --check\``.
- `relay flow add <flow> <piece> --at <point>` (in `scripts/relay-flow.mjs`): the flow and piece must exist, the point must be in the piece's `slots` (else exit 1 naming its slots), already placed → exit 1. Append the id to `slots[point]` (create the array), write `flows/<flow>.json` as `JSON.stringify(flow, null, 2) + '\n'`, then re-run `checkFlow(src)` from `scripts/build.mjs`; if it reports any problem naming `flows/<flow>.json`, restore the original text, print the problems, exit 1.
- `relay flow remove <flow> <piece> [--at <point>]`: remove from that point, or from every point; drop points left empty; not placed → exit 1. Same write and check.
- `scripts/relay-piece.mjs`, `relay piece new <id> --role <role> --slot <point>`: id kebab-case, role in `loadTeam(src)`, point in `POINTS`, `pieces/<id>.json` must not exist (each failure exit 1, a usage error exit 64). Writes `{ id, title: <id words capitalised, "deploy-check" → "Deploy check">, role, slots: [point], skills: [], requires: [], brief: "TODO: what this piece checks or produces.", output: lane point ? "{run}/lane-{lane}.<id>.md" : "{run}/<id>.md", gate: "advisory", readonly: true }`; prints the path and `next: relay flow add <flow> <id> --at <point>`.
- `scripts/relay-role.mjs`, `relay role new <name> --kind <kind> --tier <tier> --title "<title>"`: name kebab-case and not existing, kind in `KINDS`, tier in `TIERS`, title non-empty. Writes `roles/<name>.md`: frontmatter `name`, `tier`, `title`, `avatar: avatarFor(title)`, `kind`, `description: TODO: when to use this role.`, `tools` (builder: `Read, Edit, Write, Bash, Grep, Glob`; others `Read, Grep, Glob, Bash`), `readonly: true` for reviewer and finder, `maxTurns: 40`, `color: freeColor(loadTeam(src))`; body the four sections each with `- TODO`, then `## Instructions` and `You are relay's <title lower-case>. TODO: how you work and what you return.` Prints the path and `next: fill in the profile and description, then relay build`.
- `bin/relay` `COMMANDS` after `flow`: `piece: ['../scripts/relay-piece.mjs', 'new <id> --role <role> --slot <point>: scaffold pieces/<id>.json']`, `role: ['../scripts/relay-role.mjs', 'new <name> --kind <kind> --tier <tier> --title "<title>": scaffold roles/<name>.md']`.

No new tests (low risk, scaffolding; `checkFlow` guards what add writes). Check by hand in a temp copy: `RELAY_SOURCE_ROOT=<copy> relay piece new x --role reviewer --slot lane.after && RELAY_SOURCE_ROOT=<copy> relay flow add feature x --at lane.after` then confirm `checkFlow(<copy>)` from `scripts/build.mjs` returns no problems.

### T7: Forecast and calibration weigh the pieces
- `lib/calibration.mjs` `laneModel`: `pieces = (lane.pieces ?? []).reduce((a, x) => a + (forecastCfg.tierWeight[x.tier] ?? forecastCfg.tierWeight.mid), 0)`; return `{ id, base, p, pieces, weight: base * (1 + kappa * p) + pieces }` (a fix round re-works the lane's tasks, not its pieces). Update the header comment's formula.
- `lib/forecast.mjs` `roleCounts`: delete the test-author heuristic line; add `for (const pc of lane.pieces ?? []) add(pc.role);` per lane; after the loops, `for (const pc of lanes.planPieces ?? []) add(pc.role, pc.point === 'wave.after' ? lanes.waves.length : 1);`. `forecast()` returns `pieceUnits` (rounded like `units`, sum of lane `pieces`). `formatForecast`: `fixUnits = units - baseUnits - pieceUnits`; usage line reads `… — <base> units of work[ + <pieceUnits> in pieces] + <fix> expected in fix rounds, …; the final review and final pieces are extra` (the pieces part only when > 0). `wave.after` and `final` pieces are counted as agents, not units.
- `test/forecast.test.mjs`, test `forecast counts agents and worktrees …`: build `const withPieces = attachPieces(plan, computeLanes(plan));` (import from `../lib/flows.mjs`) and use it for `f`; keep `test-author === 3`; change the units assertion to `assert.equal(f.units, Math.round((sum(W1) + W2[0] + 9) * 10) / 10, 'three acceptance-tests pieces at mid weight 3 add work')` and add `assert.equal(f.pieceUnits, 9)`. Leave every other test and the whitepaper test unchanged (lanes without pieces weigh as before).

### T8: run-lanes runs pieces with one generic rule
Edit `skills/run-lanes/SKILL.md`; everything not named here stays verbatim.
- Setup step 2: append ` It prints the plan's flow and the pieces each lane may get.`
- Step 1.1: replace `a lane holding a strong task is split into segments (…) that run one after the other in the same worktree, so routine tasks stay off the most expensive model.` with `a lane holding a strong task, or a task with its own role (such as platform-engineer), is split into segments (\`lane-<id>\`, then \`lane-<id>-s2\`, ...) that run one after the other in the same worktree, each as its own role, so routine tasks stay off the most expensive model.`
- Replace step 1.2 entirely with: `2. **Pieces before each lane.** Run the piece rule at \`lane.before\` for every lane of the wave, all lanes in parallel. A lane's implementer starts when its blocking \`lane.before\` pieces are DONE.`
- Step 1.4, DONE bullet: append ` At the same time run the piece rule at \`lane.after\` for the lane. Start the lane's fix loop only when the reviewer and every \`lane.after\` piece have returned and \`relay flow done\` ran for each: a read-only piece checked after a fix commit reports a false \`blocked\`.`
- Step 1.5: first sentence becomes `**Fix loop** when the review has spec ❌ or Critical/Important findings, or a blocking \`lane.after\` piece reported them.`; rounds 1–3 bullet: `…with the findings verbatim (the reviewer's and the pieces').`; "Each round" bullet: append ` A piece whose findings were in the round runs again through the piece rule on the fixed lane.`
- Step 1.7: `Ledger \`wave N: merged @ <sha>, suite <pass/fail>\` (this exact shape; it is a calibration sample). Run the piece rule at \`wave.after\`. \`relay budget\`; then the next wave.`
- Finish 1: append ` At the same time run the piece rule at \`final\`.` Finish 2: `Findings (the architect's and the blocking \`final\` pieces') → one fix dispatch …`. Finish 3: after `every line of \`relay ledger <plan> --rulings\`` insert `, and the findings of advisory pieces`.
- New section before `## Unattended runs`:

```markdown
## Pieces

Which extra steps run, where and when, is data in `flows/` and `pieces/`; the CLI resolves it, you never decide it. At a point (`lane.before` and `lane.after` per lane, `wave.after` and `final` per plan):

1. `relay flow at <plan> <point> [--lane <id>]`. It lists each piece that applies with its role, gate, agent name, brief and report paths, and the skipped ones with the reason (it ledgers skips itself).
2. Dispatch each listed piece as its role under the agent name it printed, with one line: "Read <brief>; it is your instruction. Write your report to <report>." Claude Code: agent `relay:<role>` with `name` set to that agent name (the mod puts `lane-<id>-<piece>` in the lane's worktree). Codex: `relay-<role>` with explicit model and effort, and for a lane piece start with `Work only in <worktree path>; cd there first.` Lane pieces of a wave run in parallel with the other lanes, as lane agents do.
3. When it returns: `relay flow done <plan> <piece> [--lane <id>] --status pass|findings|blocked --report <report> [--protect <paths it listed>]`. Exit 1 for a read-only piece means it committed: the ledger lists the commits; rule on them. Nothing is reset for you.
4. Gate `blocking`: Critical/Important findings are handled like a reviewer's (the lane's fix loop; at `final`, the single fix dispatch). Gate `advisory`: ledger `deferred: <piece>: <finding>` and list them in the final report.
5. BLOCKED or NEEDS_CONTEXT from a piece: handle it as from a lane agent.
```
- Delete the last line (`<!-- config/flow.json describes this procedure as data; change both together. -->`).

Keep the file short; no other additions. High risk with no new test: this is prose read by the conductor; `relay build --check` proves the skill stays portable and the review checks it against spec 4.6.

### T9: The flow chosen at plan time
1. `commands/plan.md` body (frontmatter unchanged), steps renumbered so step 2 stays the questions:
   - Step 1, append: ` Choose the flow: \`bugfix\` when the goal is to fix a defect, \`feature\` otherwise (\`relay flow list\` shows every flow).`
   - Step 3, append: ` The slug you pick here is the plan's slug.`
   - New step 4: `4. **Pieces before the plan.** \`relay flow at --flow <flow> --slug <slug> plan.before\`. Dispatch every piece it lists as its role under the agent name it prints, with one line: "Read <brief>; it is your instruction. Write your report to <report>." Wait for each; a blocking piece must be DONE before the plan is written.`
   - Step 5 (was 4, Plan): the architect also gets `the flow` and `the reports from step 4 (such as docs/relay/requirements/<slug>.md)`, and the instruction becomes `… write the plan to \`docs/relay/plans/YYYY-MM-DD-<slug>.md\` with \`"slug": "<slug>"\` and \`"flow": "<flow>"\`, following them …`.
   - Step 6 (was 5, Check): append ` Then \`relay flow at <plan> plan.after\` and dispatch its pieces as in step 4. For every piece of steps 4 and 6: \`relay flow done <plan> <piece> --status pass|findings|blocked --report <report>\`.`
   - Step 7 (was 6, Hand over): after `the plan path;` insert ` the flow and the pieces that ran;`.
2. `commands/run.md` step 2: `If the only uncommitted files are this plan, its spec and its requirements document (\`docs/relay/requirements/<slug>.md\`, when there is one), commit them: \`git add <those files>\` then …`.
3. `lib/hq/launch.mjs` `PLAN_PREFIX`: append ` Choose the flow yourself in step 1, without asking.`
4. `skills/plan-with-tiers/SKILL.md` (stay short): in the task table add two rows after `files`: `| \`role\` | Optional. \`platform-engineer\` on infra, CI/CD, deploy, configuration and observability tasks. Builder roles only; the role's tier decides the model, so set \`tier\` to match. |` and `| \`tags\` | Optional free labels (\`infra\`, \`api\`, \`ui\`) that pieces' \`when\` reads. |`; the plan-level fields line gains `` `flow` (the flow you were given: `feature`, `bugfix`, or another file in `flows/`), `` first; after the table add one line: `When a requirements document exists (\`docs/relay/requirements/<slug>.md\`), start each behavior with the requirement it serves: \`R2: amounts render with two decimals\`.`
5. `skills/plan-with-tiers/template.md`: add `"flow": "feature",` after `"slug": "csv-export",` and `"tags": ["api"],` to T3 after `"deps": ["T2"],`. The build test's `csv-export: 3 tasks → 1 lanes` must still match.

### T10: The mod tracks the team
Read T1's note first; use only the field names it verified. Where it says `unverified`, implement the named fallback and record `Ruling: …` in your report.
1. `scripts/build.mjs` `modRouting`: add `team: Object.fromEntries(roles.map((r) => [r.name, { title: r.title, avatar: r.avatar, color: r.color, hex: COLOR_HEX[r.color] ?? '#888888', kind: r.kind, tier: r.tier }]))` (import `COLOR_HEX` from `../lib/team.mjs`). If T1 found a different agent colour list, update `AGENT_COLORS`/`COLOR_HEX` in `lib/team.mjs` and fix any role colour it invalidates.
2. `hooks/register.ts`, outside the generated block: `type Member = { title: string; avatar: string; color: string; hex: string; kind: string; tier: Tier }` and `team: Record<string, Member>` in `Routing`. Then `node bin/relay build`.
3. Pure, exported, in a new section `// ---- The team` after the board section:
   - `export type TeamAgent = { id: string; name: string; role: string; title: string; avatar: string; color: string; hex: string; lane?: string; model: string; startedAt: number; endedAt?: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; state: 'working' | 'done' }`; module state `const team = new Map<string, TeamAgent>()`.
   - `laneOf(name?: string): string | undefined` (via `LANE_NAME`).
   - `trackSpawn(map, s: { agentId: string; name?: string; subagentType: string; model: string }, now: number): TeamAgent | undefined`: only `relay:<role>` agents (`roleOf`); identity from `routing.team[role]` (fallbacks: title = role, avatar = first two letters upper-case, hex `#888888`); first drops `done` agents ended more than an hour ago.
   - `trackStep(map, agentId, tokens)`: adds the four counts; a `done` agent seen again becomes `working` (a resumed agent).
   - `trackComplete(map, agentId, now)`: `state = 'done'`, `endedAt = now`.
   - `workingAgents(map)` (by `startedAt`), `formatTokens(n)` (`950 tok`, `12.3k tok`), `formatElapsed(ms)` (`45s`, `12m`, `1h 05m`), `teamRows(map, board, now)` → groups `[{ lane: string | null, rows: [{ agent, task?: string }] }]`, lanes sorted, agents outside lanes last; `task` = `<id> <title>` of the lane's first `working` task in `board`.
4. Handlers (each wrapped in try/catch, plus `.catch(($, e, next) => next(e))` on the registration):
   - `agent.spawn`: keep the fork/resume/workflow and deny paths exactly; where it now returns `next(e)` or `next({...})`, assign `const res = await next(…)`, then (in a try/catch that swallows) when the role is a relay role and `res` carries `agentId`, `trackSpawn(team, { agentId, name: e.name, subagentType: e.subagentType, model: <the model in res, else the routed model, else routing.tiers[routing.roles[role]]> }, Date.now())` and `$.ui.invalidate('ui.render')`; `return res`.
   - `turn.step` with an agent id: `trackStep` with the usage fields T1 verified; invalidate at most once per 2000 ms. Always `return next(e)`.
   - `turn.complete` with an agent id: `trackComplete`, invalidate, `return next(e)`.
   - `session.start`: also register command `relay-team` (description: `Open relay's team: who is working on which lane, on which model, with how many tokens`) inside the existing try.
   - `command.run` `relay-team`: `$.ui.open({ id: 'relay-team', title: 'relay · team' })`, return `{ text: \`relay team: ${n} working\` }`.
5. Band (`AbovePrompt`): show when `showsBand(board, now)` or any agent is working. Before the dots, one `Text` per working agent (max 6, then dim `+N`) with the avatar in its colour (hex or the T1 fallback mapping), bold. The `relay · <slug>` title, dots, summary and Board button only when the board shows; otherwise the title is `relay`. Add a `Team` button (key `relay-team-open`) opening the pane. Keep `Hide`.
6. Pane `requestId: 'relay-team'`: with agents, per group a bold `lane <id>` (or `outside lanes`) line, then per agent `avatar title  name  task  model  tokens  elapsed  working|done` (avatar coloured, the rest dim where secondary); with none, the roster from `routing.team`: `avatar title (role) · kind · tier`.
7. `hooks/register.test.ts`, one test, `the team: a spawn is working, steps add tokens, complete is done, and the band shows the avatar`: spawn `relay:implementer` named `lane-a` through `$.agent.spawn` (handler returning `{ model: e.model ?? 'sonnet', agentId: 'team-1' }`), two steps of known token counts, then assert the agent's lane `a`, avatar `SE`, summed tokens and `working`; mount the band (no board needed) and find `Text` `SE`; complete and assert `done` and no working agents. Emit steps and completion through the kit if T1 found it can, else call `trackStep`/`trackComplete` on the exported state (export a `teamState()` accessor returning the map).

### T11: HQ data: team, flows, the board's pieces
- `lib/board.mjs` `computeBoard`: parse `piece …` ledger lines with the regex in Global Constraints, last line wins per `piece` + `lane`. Board gains `flow: lanes.flow ?? plan.flow ?? 'feature'`; each lane view gains `pieces` from `lane.pieces` (`status` from its line or `pending`, `report` from the line or null); board gains `planPieces`: `lanes.planPieces` with their results, plus pieces seen in non-lane ledger lines that are not in it (`point: null`, `role: null`, `gate: null`). Lanes without `pieces` give `[]`.
- `lib/hq/catalog.mjs`: rename `listAgents` → `listTeam`; its `relay` array becomes `team` with the team shape (from `loadTeam` plus `roleInfo` models, `source`, `generated`, `appearsIn` from every flow's slots), keep `other`, add `roleNew`. `wiring()` returns `{ points: POINTS, flows, pieces, problems: checkFlow(relayRoot) (catch → ['flows/: cannot be checked']), generated, edges }` built from `loadFlowSet(relayRoot)` and `loadTeam(relayRoot)` with the piece view shape; stop reading `config/flow.json`; keep `generated` and `edges` logic, and map `hooks/register.ts` from `['config/routing.json', 'roles/']`.
- `lib/hq/server.mjs` `brain(section)`: sections `team` → `listTeam(opts)`, `flows` → `wiring(opts)`; remove `agents` and `wiring`. `home()`: each running plan gains `roles` from `p.board`: the segment roles (`lane.agents`) of lanes in state `working` or `blocked`, deduplicated, resolved through `loadTeam(RELAY_ROOT)` to `{ role, title, avatar, hex }`.
- `lib/hq/repo.mjs` `planDetail`: add `team` (`{ [name]: { title, avatar, hex } }`), per lane `pieces` (board's, `report` made absolute against the repo root and kept only when the file exists) and `planPieces` the same way.
- `test/hq-brain.test.mjs`: extend the existing test (no new test): `listTeam({ home, relayRoot: ROOT }).team` holds `business-analyst` with `title 'Business Analyst'`, `avatar 'BA'`, `kind 'planner'`, `tier 'strong'` and a non-empty `profile.Never`; `wiring({ relayRoot: ROOT })` has a `feature` flow whose `slots['lane.after'][0]` is `{ piece: 'platform-review', role: 'platform-engineer', avatar: 'PE', gate: 'blocking', … }` and `problems` is `[]`.

### T12: HQ Brain: Team and Flows
- `lib/hq/ui/dom.js`: add `roleTile(member, size?)` (a `.initials` span, text = avatar, `title` = title, `style.background = hex`) and `copyButton(label, text)` (a `.btn` that calls `navigator.clipboard?.writeText(text)` and shows `Copied` for 1.5 s).
- `lib/hq/ui/brain.js`: `TABS` = connectors, keys, skills, `team` (`Team`), `flows` (`Flows`); hashes `#/brain/agents` and `#/brain/wiring` render `team` and `flows`. Update the header comment.
  - **Team:** a `.grid` of cards, one per role: tile, title (strong), name (muted), tags kind and tier, `Claude <model · effort>` and `Codex <model · effort>`, the description, `<details><summary>Profile</summary>` with the four sections (each `h3` + `p` with `white-space: pre-wrap` text), `In flows` chips (`<flow> · <point> · <piece>`), any `problems` as `.error` lines; below, `Other agents` as today; at the top a `copyButton('Copy relay role new', data.roleNew)`.
  - **Flows:** a `.filters` flow selector (state in a module variable); the chassis as six `.point` columns in run order, with fixed chassis labels between them (`spec` → [plan.before] → `architect plans` → `relay lanes` → [plan.after] → per wave: [lane.before] → `implementer` → [lane.after] → `reviewer and fix loop` → `merge and suite` → [wave.after] → `final review` → [final]); each piece is a `.chip.piece` with a left border in its role's hex, the role tile, its title, a `blocking`/`advisory` tag and its `when` (muted). Clicking a piece opens a panel (state in a module variable) with role tile and title, brief, output, slots, gate, read-only, protect, skills, and `copyButton`s for `relay flow add <flow> <piece> --at <point>` (one per slot where it is not placed) and `relay piece new <new-id> --role <role> --slot <point>`. Then `What is generated from what` and `Who uses whom` as today, and `problems` as `.error` lines.
- `lib/hq/ui/app.css`: `.initials.sm` (18 px tile), `.tiles` (inline row, 2 px gap), `.points` (horizontal scroll row), `.point`, `.chassis-step`, `.chip.piece` (border-left 3 px), `.gate-blocking`, `.gate-advisory`, using existing tokens; both dark and light variants readable.
Build DOM only with `h()`; no `innerHTML`.

### T13: HQ board and Home show the team and the pieces
- `lib/hq/ui/plan.js`: the heading shows a `.tag` `flow <id>`; each lane shows `.tiles` of its roles (segment roles, via `data.team`) and one chip per piece with a light by status (pass green, findings yellow, blocked red, skipped and pending grey) and the piece id; the task panel gains `Pieces on this lane`: piece, point, role, status, and an `Open report` button (`openPath`) when `report` is set; under the waves, a `Plan pieces` row from `planPieces` when non-empty.
- `lib/hq/ui/app.js` `runningNow`: after a running plan's title, `.tiles` of `p.roles` via `roleTile`.
- `lib/hq/ui/app.css`: only what these need beyond T12's classes.
Build DOM only with `h()`.

### T14: README: flows, pieces and the team
In `README.md`: add a section `### 10. Flows, pieces and the team` at the end of "Core ideas" (≤ 30 lines: the six points around the chassis, a piece and a flow as files, `feature` and `bugfix`, task `role`/`tags`, the roster table from Global Constraints, the mod's team pane `/relay-team` and HQ's Team and Flows tabs); add `flow`, `piece`, `role` rows to "The `relay` command"; add Business Analyst and Platform Engineer to "Agents"; add `/relay-team` to "Hooks and the mod"; rename HQ's "Agents" / "How relay is wired" mentions in "The Brain" to "Team" / "Flows"; add `#10` to the Contents list.

```relay-plan
{
  "slug": "relay-flows-team",
  "suite": "npm test",
  "tasks": [
    {
      "id": "T1", "title": "Verify the mod events, agent colours and Codex agent keys", "tier": "mid", "code": "prose", "risk": "low",
      "files": ["docs/relay/notes/2026-10-21-flows-team-facts.md"], "deps": [],
      "behaviors": [], "tests": 0,
      "done": "test -s docs/relay/notes/2026-10-21-flows-team-facts.md && grep -q '^## turn.step' docs/relay/notes/2026-10-21-flows-team-facts.md"
    },
    {
      "id": "T2", "title": "Team identity: roles, lib/team.mjs and the role check", "tier": "cheap", "code": "complete", "risk": "medium",
      "files": [
        "lib/team.mjs", "scripts/build.mjs", "config/routing.json",
        "roles/scout.md", "roles/architect.md", "roles/conductor.md", "roles/implementer-fast.md", "roles/implementer.md", "roles/implementer-deep.md", "roles/test-author.md", "roles/reviewer.md", "roles/business-analyst.md", "roles/platform-engineer.md",
        "agents/scout.md", "agents/architect.md", "agents/conductor.md", "agents/implementer-fast.md", "agents/implementer.md", "agents/implementer-deep.md", "agents/test-author.md", "agents/reviewer.md", "agents/business-analyst.md", "agents/platform-engineer.md",
        "codex/agents/relay-scout.toml", "codex/agents/relay-architect.toml", "codex/agents/relay-conductor.toml", "codex/agents/relay-implementer-fast.toml", "codex/agents/relay-implementer.toml", "codex/agents/relay-implementer-deep.toml", "codex/agents/relay-test-author.toml", "codex/agents/relay-reviewer.toml", "codex/agents/relay-business-analyst.toml", "codex/agents/relay-platform-engineer.toml",
        "hooks/register.ts"
      ],
      "deps": ["T1"],
      "behaviors": ["every role has a title, avatar, kind, colour and the four profile sections", "the team gains Business Analyst and Platform Engineer", "platform-engineer spawns are denied at critical budget"],
      "tests": 0,
      "done": "node bin/relay build --check && node --test test/build.test.mjs"
    },
    {
      "id": "T3", "title": "Pieces, flows and their validation in relay build", "tier": "mid", "code": "complete", "risk": "medium",
      "files": [
        "lib/flows.mjs", "scripts/build.mjs", "config/flow.json", "test/build.test.mjs",
        "pieces/acceptance-tests.json", "pieces/reproduce.json", "pieces/requirements.json", "pieces/requirements-check.json", "pieces/platform-review.json",
        "flows/feature.json", "flows/bugfix.json"
      ],
      "deps": ["T2"],
      "behaviors": ["build --check fails for a piece with an unknown role, a piece placed outside its slots, and a role without its profile"],
      "tests": 1,
      "done": "node --test test/build.test.mjs && node bin/relay build --check"
    },
    {
      "id": "T4", "title": "Plans choose a flow; task roles and tags in relay lanes", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/plan.mjs", "lib/lanes.mjs", "scripts/relay-lanes.mjs", "test/lanes.test.mjs"],
      "deps": ["T3"],
      "behaviors": ["a task with role platform-engineer becomes its own segment with that role", "a task with a non-builder role is rejected", "a plan without flow resolves to feature"],
      "tests": 1,
      "done": "node --test test/lanes.test.mjs test/build.test.mjs"
    },
    {
      "id": "T5", "title": "relay flow list, show, at and done", "tier": "mid", "code": "prose", "risk": "high",
      "files": ["scripts/relay-flow.mjs", "bin/relay", "test/flow.test.mjs"],
      "deps": ["T4"],
      "behaviors": ["flow at lists the applicable pieces with stable agent names and writes their briefs", "flow at reports skipped pieces with the reason and ledgers missing requires", "flow done ledgers the fixed piece line", "flow done records blocked and exits 1 when a read-only piece committed", "flow done refuses pass without --protect for a protect piece"],
      "tests": 2,
      "done": "node --test test/flow.test.mjs"
    },
    {
      "id": "T6", "title": "Authoring: relay flow add/remove, piece new, role new", "tier": "mid", "code": "prose", "risk": "low",
      "files": ["scripts/relay-flow.mjs", "scripts/relay-piece.mjs", "scripts/relay-role.mjs", "bin/relay"],
      "deps": ["T5"],
      "behaviors": ["flow add and remove edit a flow file and keep it valid", "piece new and role new scaffold files that relay build accepts"],
      "tests": 0,
      "done": "node --check scripts/relay-flow.mjs && node --check scripts/relay-piece.mjs && node --check scripts/relay-role.mjs && node bin/relay flow list"
    },
    {
      "id": "T7", "title": "Forecast and calibration weigh the pieces", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/forecast.mjs", "lib/calibration.mjs", "test/forecast.test.mjs"],
      "deps": ["T4"],
      "behaviors": ["applicable pieces add agents and work to the forecast"],
      "tests": 0,
      "done": "node --test test/forecast.test.mjs test/whitepaper.test.mjs"
    },
    {
      "id": "T8", "title": "run-lanes runs pieces with one generic rule", "tier": "mid", "code": "complete", "risk": "high",
      "files": ["skills/run-lanes/SKILL.md"], "deps": [],
      "behaviors": ["the conductor runs relay flow at and done at lane.before, lane.after, wave.after and final", "blocking piece findings enter the existing fix loop"],
      "tests": 0,
      "done": "node bin/relay build --check"
    },
    {
      "id": "T9", "title": "The flow chosen at plan time", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["commands/plan.md", "commands/run.md", "lib/hq/launch.mjs", "skills/plan-with-tiers/SKILL.md", "skills/plan-with-tiers/template.md"],
      "deps": [],
      "behaviors": ["/relay:plan picks bugfix for a defect and feature otherwise and runs plan.before and plan.after pieces", "the architect writes flow, task roles and tags"],
      "tests": 0,
      "done": "node --test test/build.test.mjs test/hq-launch.test.mjs && node bin/relay lanes skills/plan-with-tiers/template.md"
    },
    {
      "id": "T10", "title": "The mod tracks the team", "tier": "mid", "code": "prose", "risk": "high",
      "files": ["hooks/register.ts", "hooks/register.test.ts", "scripts/build.mjs", "lib/team.mjs"],
      "deps": ["T1", "T2"],
      "behaviors": ["a relay spawn is tracked as working with role identity, lane and model", "turn.step tokens accumulate per agent and turn.complete marks it done", "the band shows the avatars of working agents and a Team button", "/relay-team shows agents by lane, or the roster"],
      "tests": 1,
      "done": "\"$HOME/Library/Application Support/Claude/claude-code/2.1.304/6bbba6adc37f/claude.app/Contents/MacOS/claude\" plugin test . && node bin/relay build --check"
    },
    {
      "id": "T11", "title": "HQ data: team, flows, the board's pieces", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/board.mjs", "lib/hq/catalog.mjs", "lib/hq/server.mjs", "lib/hq/repo.mjs", "test/hq-brain.test.mjs"],
      "deps": ["T4"],
      "behaviors": ["the Team API returns each role's identity, models, profile and flows", "the Flows API returns each flow's points with pieces", "the board carries the flow and each piece's result from the ledger"],
      "tests": 0,
      "done": "node --test test/hq-brain.test.mjs test/hq-repo.test.mjs test/hq-server.test.mjs test/board.test.mjs"
    },
    {
      "id": "T12", "title": "HQ Brain: Team and Flows", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/ui/brain.js", "lib/hq/ui/dom.js", "lib/hq/ui/app.css"],
      "deps": ["T11"],
      "behaviors": ["Brain shows the team as cards with profiles and a copyable role new command", "Brain shows a flow's six points with piece chips and copyable flow add and piece new commands"],
      "tests": 0,
      "done": "node --check lib/hq/ui/brain.js && node --check lib/hq/ui/dom.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "T13", "title": "HQ board and Home show the team and the pieces", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/ui/plan.js", "lib/hq/ui/app.js", "lib/hq/ui/app.css"],
      "deps": ["T12"],
      "behaviors": ["the plan board shows the flow, lane role avatars and piece result chips", "Home shows the roles working on each running plan"],
      "tests": 0,
      "done": "node --check lib/hq/ui/plan.js && node --check lib/hq/ui/app.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "T14", "title": "README: flows, pieces and the team", "tier": "cheap", "code": "prose", "risk": "low",
      "files": ["README.md"], "deps": [],
      "behaviors": [], "tests": 0,
      "done": "grep -q 'relay flow at' README.md && grep -q '/relay-team' README.md"
    }
  ]
}
```
