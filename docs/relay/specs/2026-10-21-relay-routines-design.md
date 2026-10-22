# Relay routines: scheduled engineering checks, run by the harness you choose

**Status:** design approved in conversation on 2026-10-21; this spec is the written version for review.
**Scope:** sub-project F of the relay HQ roadmap (see `docs/relay/specs/2026-10-21-relay-hq-design.md`, "Later sub-projects"). It builds on HQ (A+B) and on flows and the team (C+D, `docs/relay/specs/2026-10-21-relay-flows-team-design.md`).

## 1. Why

Engineers repeat the same checks by hand:

- which PRs are waiting on whom;
- which branches and lane worktrees are left over after a run;
- what the agents shipped this week.

Jay E.'s agentic OS calls these **routines**: tasks that run on a schedule. They come in two kinds:

- **passive** routines ping only when they find something new;
- **active** routines hand over an output to review.

They are capped, and one routine suggests new routines from what you keep doing by hand.

Relay adds its own rule: a routine is relay CLI work first, at zero tokens. A model is used only where judgment is needed, on bounded data and a fixed tier.

### Success criteria

1. **An engineer chooses where each routine runs.** They enable a routine on the harness they pick, Claude or Codex; relay never picks one.
2. **What it covers:** a project, a repository, or all repositories they added to HQ.
3. **`pr-hygiene`** runs at zero tokens and reports only what is new since its last run: stale PRs, PRs asking for their review, approved but unmerged PRs, relay branches and lane worktrees left after a finished plan, old merged local branches. It never deletes or changes anything.
4. **`weekly-report`** writes a deterministic report of the week across projects. It adds at most three suggested routines, derived from repeated manual launches, using one bounded judgment step.
5. **HQ shows the routines:**
   - a week grid of runs;
   - each routine's findings and reports;
   - new findings in "Waiting on you";
   - an Enable dialog.
6. **Every routine has caps:** runs per week, and a limit on the data given to a model. Routines do not read the usage budget in this version (decided after review, 2026-10-21).

## 2. Constraints

From AGENTS.md and the earlier specs; not up for change here.

- **No dependencies.** Plain Node ≥ 20.
- **Both harnesses.** Codex and Claude Code run the same prompt. Only the way a routine is registered differs (section 5).
- **The user decides.** Nothing is enabled automatically, and no harness is preselected. A routine covers only repositories the user added to HQ.
- **Routines only propose.** They never delete, close, comment or push. They print the exact command for the user to run.
- **Facts on disk, computed by the CLI.** Findings come from `gh`, `git` and relay's own files, never from a model's say-so.
- **No explanatory copy in the UI** (users are engineers).
- **Writes into another tool's folder stay inside relay's own names.** In Codex that is only `~/.codex/automations/relay-*`.

## 3. Decisions made in the conversation

| Question | Decision |
|---|---|
| Routines in this version | `pr-hygiene` (passive) and `weekly-report` with routine suggestions (active). Dependency audit and main-branch health come next, as templates. |
| Who triggers routines | The harnesses' own schedulers: Codex automations and Claude desktop scheduled tasks |
| Which harness | Whatever the user selects for each routine. There is no default. |
| How a routine is built | Relay CLI checks scheduled by the harness. The scheduled session only runs `relay routine run` and relays its output. A `prompt` routine type exists for routines written only in words. |

## 4. Routines, files and the CLI

### 4.1 Templates

Relay ships routine templates in `routines/<id>.json`:

```json
{
  "id": "pr-hygiene",
  "title": "PR and branch hygiene",
  "kind": "passive",
  "type": "check",
  "check": "pr-hygiene",
  "schedule": { "days": ["mon", "tue", "wed", "thu", "fri"], "at": "09:00" },
  "options": { "staleDays": 3, "branchAgeDays": 14 },
  "cap": { "runsPerWeek": 7 }
}
```

```json
{
  "id": "weekly-report",
  "title": "Weekly report",
  "kind": "active",
  "type": "check",
  "check": "weekly-report",
  "schedule": { "days": ["fri"], "at": "16:00" },
  "options": { "days": 7, "suggestWeeks": 4, "suggestMinRepeats": 3 },
  "judgment": { "tier": "cheap", "maxInputChars": 6000, "ask": "Propose at most 3 new relay routines (id, kind, schedule, what it checks, which repeated action it replaces) from the repeated launches below. Answer \"none\" when nothing repeats." },
  "cap": { "runsPerWeek": 2 }
}
```

**Fields:**

- **`kind`:**
  - `passive` reports only findings that are new since the instance's last run;
  - `active` writes a report on every run.
- **`type`:**
  - `check` runs the module `lib/routines/<check>.mjs`;
  - `prompt` is a routine written in words (4.4).
- **`schedule`:** the suggested days (`mon`…`sun`) and local time `HH:MM`. Enable can override both.
- **`options`:** passed to the check. Enable can override them.
- **`judgment`** (optional): the one step that needs a model. It sets the tier, the data limit and the question.
- **`cap.runsPerWeek`:** run refuses beyond this count within the current ISO week.

`relay build --check` validates every template:
- unknown keys;
- a missing check module;
- days or time out of range;
- a `judgment.tier` that is not in `config/routing.json`.

### 4.2 Enabled routines

An enabled routine is an **instance**, recorded in `<relayHome>/routines/enabled.json`:

```json
{
  "version": 1,
  "instances": [
    {
      "id": "pr-hygiene@polaris",
      "routine": "pr-hygiene",
      "harness": "codex",
      "scope": { "project": "polaris" },
      "schedule": { "days": ["mon", "tue", "wed", "thu", "fri"], "at": "09:00" },
      "options": {},
      "relayCli": "/Users/x/.claude/plugins/cache/relay/relay/0.2.0/bin/relay",
      "registration": { "state": "active", "codexPath": "~/.codex/automations/relay-pr-hygiene-polaris" },
      "enabledAt": "2026-10-21T10:00:00Z"
    }
  ]
}
```

- **The instance id** is `<routine>@<scope>`, where `<scope>` is the project id, the repository's folder name, or `all`.
- **The same template can be enabled more than once**, with different scopes.
- **`scope`** is `{ "project": id }`, `{ "repo": path }` or `{ "all": true }`. `all` means every non-hidden repository in the HQ registry at run time.
- **`registration.state`** is `pending` (a Claude routine not created yet), `active` or `disabled`.

### 4.3 State on disk

Each instance keeps its data in `<relayHome>/routines/<instance>/`:

- **`state.json`:** `{ seen: { <findingId>: firstSeenAt }, lastRunAt, weekRuns: { week, count } }`. It is written atomically. When it is damaged, a copy is kept as `state.json.bad`, the run starts from an empty state, and it reports `state reset` once.
- **`runs/<timestamp>.json`:** `{ startedAt, endedAt, outcome, findings, new, skipped }`.
- **`reports/<YYYY-MM-DD>.md`:** the report of an active routine.
- **`lock`:** present while a run is going. A second run of the same instance exits with `already running`.

**Findings** have stable ids, `<rid>:<kind>:<key>` (for example `a1b2c3d4e5:pr-stale:41`).

- **New:** an id that is not in `seen`.
- **Resolved:** an id that is in `seen` but missing from this run. It is dropped from `seen`, so it counts as new if it comes back.

### 4.4 The CLI

```text
relay routine list                                  templates and your instances: harness, schedule, next run, last result
relay routine show <routine|instance>
relay routine enable <routine> --harness claude|codex (--project <id> | --repo <path> | --all) [--days mon,…] [--at HH:MM]
relay routine confirm <instance> --task-id <id>     record the Claude scheduled task created for a pending instance
relay routine disable <instance>
relay routine run <instance> [--dry-run]            checks, diff, report; prints the summary the session relays
relay routine note <instance>                       append the session's judgment (stdin) to the latest report
relay routine new <id> --prompt "<text>" --kind passive|active [--days …] [--at …]
relay routine history <instance>
relay routine refresh                               rewrite registrations whose relay path is stale
```

**What `relay routine run` prints:**

1. Always a first line of a fixed shape:
   ```text
   RELAY_ROUTINE: <instance> · <n> new · <report path>
   RELAY_ROUTINE: <instance> · nothing new
   RELAY_ROUTINE: <instance> · skipped · <reason>
   ```
2. Then at most 20 lines, one per new finding, each with its link or command.
3. Then, for a routine with `judgment`, a block starting with `For you:`. It holds the question and data bounded to `maxInputChars`, and ends with the exact `relay routine note <instance>` command to pipe the answer into.

**When the judgment block is left out:** only when the run was started from HQ's Run now (section 7). The report then says `suggestions come with the scheduled run`. Routines do not read the usage budget in this version.

**A `prompt` routine** has no check module. Its run prints the first line, then `For you:` with the routine's text, and the session's answer is stored with `note`. A passive prompt routine is asked to answer `nothing new` when nothing changed. Its `cap.runsPerWeek` defaults to 7.

## 5. Enabling a routine on a harness

### 5.1 The scheduled prompt

The prompt is the same for both harnesses. `<cli>` is the instance's `relayCli`:

> Run `node <cli> routine run <instance>` in a shell and reply with its output, unchanged. If the output ends with a "For you:" block, do what it asks and pipe your answer to `node <cli> routine note <instance>`. Do nothing else.

**`relayCli`** is the absolute path of the `bin/relay` that ran `enable` (a plugin install or a checkout).

- `relay routine list` marks an instance `stale path` when the file no longer exists, for example after a plugin update.
- `relay routine refresh` rewrites the prompt of every stale Codex registration.
- For a stale Claude task it prints the `/relay:routine refresh` step instead.

### 5.2 Codex

`relay routine enable … --harness codex` writes `~/.codex/automations/relay-<instance-slug>/automation.toml`, in the format Codex uses for its own automations, and an empty `memory.md` beside it.

```toml
version = 1
id = "relay-pr-hygiene-polaris"
kind = "cron"
name = "relay · PR and branch hygiene · Polaris"
prompt = "<the scheduled prompt>"
status = "ACTIVE"
rrule = "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR"
model = "<codex model of judgment.tier, or of cheap>"
reasoning_effort = "<its effort>"
execution_environment = "local"
target = { type = "projectless" }
cwds = ["<each repository in scope>"]
created_at = <ms>
updated_at = <ms>
```

- **Model and effort** come from the `codex` column of `config/routing.json`, for `judgment.tier` or else `cheap`.
- **`<instance-slug>`** is the instance id with `@` replaced by `-`.
- **Codex never installed** (`~/.codex/automations` missing): `enable` fails with that reason and writes nothing.
- **`disable`** removes only that `relay-…` folder. Relay never touches another automation.

### 5.3 Claude

Claude desktop scheduled tasks are created through the app's scheduled-tasks tool inside a session, not from the CLI.

1. `relay routine enable … --harness claude` records the instance as `pending`. It prints a proposal JSON: `taskId` (`relay-<instance-slug>`), `title`, `description`, `cronExpression` (5 fields, local time, from days and time) and `prompt`.
2. The new command `/relay:routine enable <routine> <scope flags>` runs step 1. It calls the scheduled-tasks tool's create call with the proposal, then records the created task id with `relay routine confirm <instance> --task-id <id>`.
3. `/relay:routine disable <instance>` disables the task through the same tool, then runs `relay routine disable <instance>`.
4. When the session has no scheduled-tasks tool (for example `claude` in a terminal), the command says so and stops. The instance stays `pending`, and HQ shows the command to run in the desktop app.

**`enable` warns about two Claude limits:**
- runs use the app's default model, because the task cannot set one;
- runs happen while the app is open, and a missed run starts at the next launch.

## 6. The two routines

### 6.1 `pr-hygiene` (passive, zero tokens)

For each repository in scope:

| Finding kind | Source | What it proposes |
|---|---|---|
| `pr-stale` | an open, non-draft PR whose review decision is not approved and that is older than `staleDays` (`gh pr list --state open --json …`) | the PR link |
| `review-requested` | an open PR requesting the user's review (`gh pr list --search "review-requested:@me"`) | the PR link |
| `pr-approved-unmerged` | an approved PR not merged for more than `staleDays` | the PR link |
| `relay-branches` | `relay/<slug>/*` branches of a plan whose ledger says `plan: complete`, and whose integration branch is an ancestor of the repository's current branch | the exact `git branch -D …` command |
| `relay-worktrees` | lane worktrees (`git worktree list`, branches `relay/<slug>/lane-*`) of a complete plan | `relay worktrees clean <plan>` |
| `branch-merged-old` | a local branch, not `relay/*`, merged into the current branch, whose last commit is older than `branchAgeDays` | the exact `git branch -d …` command |

**When `gh` is missing or not signed in,** the PR rows are replaced by one finding, `gh-not-connected`. Because its id is stable, it is reported once.

**Each `gh` call has a 15-second timeout.** A repository that times out is noted in the run and does not fail the routine.

### 6.2 `weekly-report` (active, one judgment step)

**The deterministic report,** `reports/<date>.md`, covers the last `options.days` days, by project and then by repository:

- plans started (ledger `start:` lines) and completed (`plan: complete`);
- tasks turned green (task commits on `relay/*` branches with dates in the window);
- rulings (`Ruling:` lines), listed;
- lanes blocked now (from each plan's board);
- piece results (`piece … : findings|blocked` lines);
- HQ launches in the window: action, harness, model, outcome;
- findings opened and resolved by the user's other routine instances.

**The judgment step,** "suggest routines":

- **The data:**
  - HQ launches over the last `suggestWeeks` weeks, grouped by action, skill and repository, for groups with at least `suggestMinRepeats` launches, with their weekdays and hours;
  - the list of existing templates and instances.
- **The limit:** both are cut to `maxInputChars`.
- **The answer** is appended to the report under `## Suggested routines` through `relay routine note`.
- **In HQ,** each suggestion shows a button that copies the matching `relay routine new … --prompt …`. The user decides.

## 7. Seeing routines in HQ

- **Top navigation:** Home · Projects · Brain · **Routines** · Launches.
- **The Routines page:**
  - **A week grid.** Days are columns, with one row per instance:
    - a marker at each scheduled time, with a harness badge;
    - this week's runs as dots: grey for nothing new, amber for new findings, red for failed;
    - the next run highlighted.
  - **The instance list:**
    - title, with the project avatar when scoped to a project;
    - harness, schedule, next run, and "needs the app open" on Claude;
    - last result, new findings, and runs this week against the cap;
    - Run now, Disable, History.
  - **Templates and the user's prompt routines,** each with **Enable**.
  - **Filters:** All, Passive, Active, Pending.
- **Run now** runs `relay routine run <instance>` on the HQ server, through the launch machinery with its log. The checks cost no tokens. The judgment block is left out, and the report says suggestions come with the scheduled run.
- **The Enable dialog** asks for:
  - the routine;
  - the **harness, with none preselected**;
  - project, repository or all;
  - days and time.

  It shows the exact effect before confirming:
  - **Codex:** the automation path, model and effort; HQ writes it (a POST guarded like launches: token, intents only);
  - **Claude:** the `/relay:routine enable …` command to copy into a desktop-app session.
- **An instance's page:**
  - findings, new first, each with its link or command to copy and **Dismiss**, which marks it seen;
  - the run history;
  - active reports, rendered as a safe text subset (headings, lists, tables, code, `https` links; never raw HTML);
  - on `weekly-report`, the suggestion buttons.
- **Home:**
  - "Waiting on you" gains new findings of passive routines, in amber with the routine name, until they are dismissed or resolved;
  - Activity gains routine runs.
- **Notifications** are the harnesses' own:
  - the Claude app notifies when a scheduled task finishes;
  - Codex shows its automation runs.

  Relay sends no notification of its own in this version.

## 8. Errors

| Situation | Behaviour |
|---|---|
| `enable` without `--harness` | exit 64: choose `--harness claude` or `--harness codex` |
| `--harness codex` without `~/.codex/automations` | nothing is written; the reason is printed |
| Claude session without the scheduled-tasks tool | the instance stays `pending`; HQ shows the command to run in the desktop app |
| Over `cap.runsPerWeek` | `RELAY_ROUTINE: … · skipped · cap <n>/week reached`, exit 0 |
| A second run while one is going | `already running`, exit 0 |
| `gh` missing or not signed in | one `gh-not-connected` finding |
| A scoped repository is no longer in HQ, or is hidden | skipped, noted in the run |
| `relayCli` path missing | `list` marks `stale path`; `refresh` fixes Codex registrations |
| Damaged `state.json` | kept as `state.json.bad`; the run starts empty and reports `state reset` once |
| `note` with no pending judgment | exit 1 with the reason |

## 9. To verify at the start of implementation

- **Codex** picks up an automation written by relay in `~/.codex/automations/relay-*/automation.toml`:
  - which fields it requires;
  - the `status` values (for example a paused state);
  - whether the app watches the folder or needs a restart.

  The format is the one seen on disk, and it is not documented.
- **Claude** desktop sessions have the scheduled-tasks tool, and its create, update and delete calls behave as this spec assumes.

## 10. Testing

The approach follows qa-mindset: few tests, each able to catch a real bug, using real git repositories through `test/helpers.mjs`, with `HOME` and `RELAY_HOME` in temporary directories.

1. **`pr-hygiene`** on a repository with a completed plan (ledger `plan: complete`, merged integration branch, a leftover lane branch and worktree):
   - it reports `relay-branches` and `relay-worktrees` with their commands;
   - a second run prints `nothing new`;
   - removing the worktree drops that finding from `seen`;
   - with `gh` not on `PATH`, `gh-not-connected` is reported once.
2. **`weekly-report`** from a fixture ledger and HQ launches:
   - the report lists the completed plan, the rulings and the launches;
   - the `For you:` block is present on a scheduled run, within `maxInputChars`, and absent from an HQ Run now, whose report says why.
3. **`enable --harness codex`** with a fake `HOME`:
   - `automation.toml` has the rrule, the Codex `cheap` model and effort, the scope's `cwds`, and the absolute relay path in the prompt;
   - `disable` removes only the `relay-…` folder, and a user automation beside it is untouched;
   - `enable` without `--harness` exits 64.
4. **`enable --harness claude`:**
   - prints the proposal (local cron, prompt) and records `pending`;
   - `confirm --task-id` makes it `active`.
5. **Cap and lock:** with the week's count at the cap, `run` prints `skipped`. A run while `lock` is held prints `already running`.
6. **HQ:**
   - the routines API lists instances with their next run;
   - Run now executes the check;
   - a new passive finding appears in `/api/home` attention.

`relay build --check` covers the templates: an unknown check and a bad schedule fail.

The views are checked by hand in a browser, dark and light. Before finishing:

- `npm test`;
- `node bin/relay build --check`;
- `claude plugin validate .` (a command is added).

## 11. Out of scope

- The dependency and security audit, and main-branch health routines. They are the next templates.
- Relay's own notifications (Slack, the operating system).
- Measuring the tokens of scheduled harness sessions.
- Claude cloud routines.
- launchd or cron scheduling.
- Changing an instance's schedule from HQ beyond disable and enable.
- Windows.
