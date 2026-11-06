# Relay HQ: a command centre for engineering work

**Status:** design approved in conversation on 2026-10-21; this spec is the written version for review.
**Scope:** sub-projects A (command centre, from portfolio to task) and B (Brain: connectors, keys, skills, agents, wiring). The other four sub-projects are listed under [Later sub-projects](#later-sub-projects) and get their own specs.

## 1. Why

Relay automates an engineer's reasoning on a feature: plan, implement, test, review, merge, within the usage budget. What it does not have is one place where an engineer sees all of their work: every project and repository, what each run is doing, what needs a human decision, which agents, skills and connectors exist, and how relay's pieces fit together.

The model is Jay E.'s "agentic OS" (RoboNuggets, Oct 2026), built on four layers: Apps, Routines, Memory, Skills. From it we take:

- a local dashboard that reads files and costs no tokens to look at;
- an attention-first home page;
- skills and actions launched from the dashboard (`claude -p`), with the model and effort chosen per launch;
- a view of every connector the agent can reach, preferring CLI over API over MCP.

We apply all of this to engineering projects instead of content work.

### Success criteria

1. An engineer sees, on one page, everything across all their projects that is waiting on them: blocked lanes, failed suites, red CI, PRs asking for their review, plans finished and ready to merge.
2. From there they reach any task of any plan in three clicks: home → project → plan → task.
3. They can start a plan, a run, a marathon or a skill on Claude Code or Codex from the browser. Every launch shows the exact command and the forecast first, and asks for a confirmation.
4. They can see every connector configured for Claude Code and Codex, every API key those connectors and skills need and whether it is set, every skill with its description, every agent with its model on both harnesses, and how relay's flow and generated files fit together.
5. Looking at any of this costs no tokens. The exceptions are a launch and the account-connector refresh, which say so before they run.

## 2. Constraints

These come from AGENTS.md and the existing design. They are not up for change in this spec.

- **No dependencies.** Plain Node ≥ 20 (`node:http`, `node:child_process`, `node:crypto`). No front-end build step.
- **Both harnesses.** Everything works for Claude Code and Codex. The only Claude-only parts are the `/relay:*` slash commands and, in this version, marathon.
- **Facts on disk, computed by the CLI.** The UI never asks a model what state something is in. Lights come from git, the ledger and the plan, exactly as on today's board.
- **Hooks fail open.** HQ adds nothing to any hook; the existing hooks keep failing open.
- **The mod does not change** in this version (no `hooks/register.ts` edits, so no new `claude plugin test` surface). Mods have no documented way to open a browser URL, so the entry point is the `/relay:hq` command.
- **Existing formats stay.** `board.json`, the ledger, `run.json`, lanes and briefs are read, never rewritten by HQ.
- **No secret values ever leave the server process.** Only key names and their status.
- **UI copy is in English**, like the rest of relay (public repository). The Romanian labels in the review mockups were for the conversation only.

## 3. Decisions made in the conversation

| Question | Decision |
|---|---|
| First sub-project | A + B together |
| Can the centre start things? | Yes, on Claude Code and Codex, with a confirmation dialog |
| What is a "project"? | A named group of repositories (for example a client or product: web, api, infra) |
| Signals on a project card | Relay plans and lights, git local state, GitHub (PRs, CI), recent activity. Per-project token usage is **out**. |
| Architecture | A local server (`relay hq`) on 127.0.0.1 with a JSON API and a dependency-free page |
| Home page | Attention-first dashboard (mockup option C) |
| Drill-down and launch dialog | As in the `hq-drilldown` mockup |
| Brain → Connectors | One widget per connector, filterable by harness. API connections as widgets. API keys in their own section. No project-local connectors (for example a project's database MCP). No explanatory copy. |
| claude.ai account connectors | Read from a session snapshot (`/relay:connectors`), since they are not on disk and a mod cannot list them |
| How a repository gets into HQ | Only when the user adds it (`relay hq add` or **Add repository**); never automatically |

## 4. Architecture

### 4.1 Commands

```text
relay hq [--port N] [--no-open]            start the server, or reuse the running one, and open the browser
relay hq stop                              stop the server
relay hq add <path> [--project <name>]     register a repository, optionally into a project (created if new)
relay hq hide <path> | unhide <path>       keep a repository off the dashboard
relay hq rm <path>                         forget a repository
relay hq connectors --record [--harness claude|codex]  read a connector snapshot (JSON) from stdin and store it
```

In Claude Code:

- `/relay:hq` runs `relay hq`.
- `/relay:connectors` records the session's connectors (see 6.1).

In Codex, `relay hq` runs from a terminal and the connector refresh is a prompt (see 6.1).

### 4.2 Modules

| File | Responsibility | Reads |
|---|---|---|
| `scripts/relay-hq.mjs` | CLI entry: subcommands above, starting and stopping the server | everything below |
| `lib/hq/registry.mjs` | projects, repositories, hidden flags; atomic writes | `<relayHome>/hq/registry.json` |
| `lib/hq/repo.mjs` | one repository's summary: git state, plans with board lights, attention items, lane worktrees on disk, task file paths | git, `docs/relay/plans/`, `.relay/runs/<slug>/`, `.relay/lanes/active.json` |
| `lib/hq/github.mjs` | PRs, CI state, review requests; cached | `gh` |
| `lib/hq/activity.mjs` | timeline across repositories | ledgers, commits on `relay/*` branches, launches |
| `lib/hq/brain.mjs` | connectors, API keys, CLIs, skills, agents, wiring | harness config files (section 6), `roles/`, `skills/`, `commands/`, `config/flow.json`, build outputs |
| `lib/hq/toml.mjs` | the TOML subset `~/.codex/config.toml` uses for `[mcp_servers.*]` | — |
| `lib/hq/launch.mjs` | turns an intent into argv per harness; guards; spawning; status | `config/routing.json`, `commands/*.md`, `<relayHome>/hq/launches/` |
| `lib/hq/server.mjs` | `node:http` server: auth, routing, JSON responses, static UI | the modules above |
| `lib/hq/ui/index.html`, `app.js`, `app.css` | the single-page UI, hash routes, polling | the API |
| `commands/hq.md`, `commands/connectors.md` | the two new Claude Code commands | — |
| `config/flow.json` | relay's pipeline as data (descriptive in this version; see 6.4) | — |

`<relayHome>` is `RELAY_HOME` or `~/.relay`, as in `lib/budget.mjs`.

### 4.3 Data on disk

**`<relayHome>/hq/registry.json`**

```json
{
  "version": 1,
  "projects": [
    { "id": "polaris", "name": "Polaris", "repos": ["/Users/x/Workspaces/polaris-web", "/Users/x/Workspaces/polaris-api"] }
  ],
  "repos": {
    "/Users/x/Workspaces/polaris-web": { "addedAt": "2026-10-21T10:00:00Z", "lastSeenAt": "2026-10-21T14:05:00Z", "hidden": false, "via": "cli" }
  }
}
```

- A repository's key is its main worktree root (`mainRoot`), so lane worktrees never register as separate repositories.
- A repository that belongs to no project shows under **Unassigned**.
- A repository belongs to at most one project.
- A project id is the kebab-case of its name.

**`<relayHome>/hq/server.json`** (mode 0600): `{ "port", "pid", "token", "startedAt" }`.

**`<relayHome>/hq/launches/<id>/`**

- `launch.json`: action, repo, plan, harness, argv, model, effort, permission mode, startedAt, pid.
- `out.log`: stdout and stderr.
- `result.json`: exit code, endedAt, and cost and usage when the harness prints them.

`<id>` is `YYYYMMDD-HHMMSS-<4 hex>`.

**`<relayHome>/hq/connectors.json`**: the latest snapshot per harness:

```json
{
  "claude": { "recordedAt": "2026-10-21T14:00:00Z", "servers": [{ "id": "claude_ai_Linear", "label": "Linear", "labelInferred": false, "tools": 64 }] },
  "codex": { "recordedAt": "2026-10-21T13:10:00Z", "servers": [{ "id": "node_repl", "label": "node_repl", "labelInferred": false, "tools": 3 }] }
}
```

A new recording replaces that harness's entry and leaves the other harness's entry alone.

### 4.4 Registration

Each user decides which repositories HQ shows, so nothing is registered automatically: the session-start hook does not touch the registry. A repository enters HQ only by an explicit action:

- `relay hq add <path> [--project <name>]`;
- **Add repository** in the page: a path plus a project (existing, none, or new), sent as the `add` op of `POST /api/registry`.

**Checks on the path.** It may start with `~/`. It must exist and be inside a git work tree; it is stored as its main worktree root (`mainRoot`). Otherwise the op returns 400 with a short reason.

(Decided after the first build, on 2026-10-21. An earlier version of this spec had session-start register every repository it ran in.)

### 4.5 Data flow

1. The page calls the API with the token (section 8).
2. The server builds responses on request from the modules above.
3. Each repository summary is cached under a key made of the main HEAD sha plus the mtimes of `docs/relay/plans/`, `.relay/board.json` and every `.relay/runs/*/ledger.md`. A cache entry lives at most 5 seconds.
4. GitHub data is fetched lazily per repository and cached for 120 seconds.
5. The visible page polls every 5 seconds, like `board.html`.

### 4.6 API

| Method and path | Returns or does |
|---|---|
| `GET /api/home` | budget, attention items, running launches and runs, projects with one-line summaries, recent activity |
| `GET /api/projects/:id` | the project, its repository summaries, its activity |
| `GET /api/repos/:rid` | one repository summary with its plans |
| `GET /api/repos/:rid/plans/:slug` | the board (from `boardFor`) plus, per lane, the paths of its brief, report and reviews |
| `GET /api/repos/:rid/github` | PRs, CI of the current branch, review requests (lazy) |
| `GET /api/brain/:section` | `connectors`, `keys`, `skills`, `agents` or `wiring` |
| `POST /api/brain/verify` | runs the harnesses' MCP health check (section 6.1) |
| `POST /api/launches/preview` | for an intent: argv, forecast, guard results; starts nothing |
| `POST /api/launches` | the same intent plus `confirm: true`: starts it |
| `GET /api/launches`, `GET /api/launches/:id` | list; one launch with its log tail |
| `POST /api/launches/:id/stop` | stops a launch |
| `POST /api/registry` | `add` (a path, optionally into a project), `create-project`, `rename-project`, `assign` (repo to project or none), `hide`, `unhide`, `remove` |
| `POST /api/open` | opens a file or folder with the OS opener, or in `code` when it is on PATH |

- `:rid` is the first 10 hex characters of the sha1 of the repository path.
- `POST /api/open` accepts only paths inside a registered repository, its lane worktrees or its `.relay/runs/` directory.

## 5. Views

All views share a top bar (`relay hq`, breadcrumb, budget level with 5h and 7d percentages) and a left sidebar:

- **Home**;
- **Projects**: each project, then Unassigned;
- **Brain**;
- **Launches**.

Lights, glyphs and colours are the board's, light and dark.

### 5.1 Home

1. **Waiting on you.** One row per item, newest first, each with an Open button leading to the item:
   - a lane is blocked (red light, with its note, such as "fix round 2/5");
   - a wave's suite failed;
   - a marathon ended BLOCKED;
   - a plan is complete (`plan: complete` in its ledger) and `relay/<slug>/integration` is not yet an ancestor of the repository's current branch;
   - CI is red on a repository's current branch or one of its open PRs;
   - a PR requests the user's review.

   The page renders at once from local facts. The GitHub items join as each repository's GitHub data arrives (section 4.5).
2. **Running now.** Every running launch and every plan whose board status is `running`: repository, plan, progress bar, wave, harness and model when it was launched from HQ, elapsed time.
3. **Projects.** One line per project: repository count, running plans, worst signal.
4. **Activity.** The latest 100 events across repositories.

### 5.2 Project

- **One card per repository:**
  - path, branch, uncommitted file count, ahead/behind its upstream, lane worktrees on disk;
  - its plans, each with status, progress bar and the buttons Board, Run, Marathon, Status and Stop (whichever apply);
  - **+ New plan**;
  - GitHub: open PRs with their CI and review state.
- **A "Move to project" control** on each repository.
- **The project's activity** on the right.

### 5.3 Plan and task

- The plan page is today's board: waves, lanes, tasks, filters, rulings, ledger tail.
- Selecting a task opens its panel:
  - tier, risk, test budget, behaviours, files, done check;
  - the latest review's findings for its lane;
  - buttons for the brief, the report, the review(s), the worktree, and **Open in editor**.

### 5.4 Launch dialog

- **Fields:**
  - harness (Claude Code or Codex);
  - model and effort, defaulting to the `mid` tier from `routing.json` for that harness;
  - permission mode;
  - for a run or marathon, the forecast (`relay forecast`) and the current budget.
- **The exact command**, in a code block, with three buttons: **Start**, **Copy command**, **Cancel**.
- **A hint** when the plan spans more than one 5-hour window: suggest Marathon.
- **Guard results** (section 7.3) disable Start and say why.

### 5.5 Launches

A list of launches: action, repository, harness, model, status, duration, cost. Each opens a page with its log, its result and a Stop button while it runs.

### 5.6 Brain

Tabs: **Connectors**, **API keys**, **Skills**, **Agents**, **How relay is wired**. None of them carries explanatory text. Section 6 defines what feeds each tab.

- **Connectors:**
  - filters: All, Claude, Codex, Needs action;
  - the time of the last account-connector snapshot, with a **Refresh** button;
  - a **Verify** button for the health check;
  - a grid of connector widgets: initials, name, source, tool count when known, status, harness tags;
  - a second grid, **API connections**: services used by key, such as Exa, Parallel or OpenAI, each showing the key variable, its status, and what uses or needs it;
  - a row of **CLI** chips.
- **API keys:**
  - filters: All, Missing, Written in a file;
  - one card per key name: status, where it is set or expected, what needs it.
- **Skills:** a table:
  - name, source (relay, user, a plugin's name, Codex), description, what references it;
  - for Claude, usage count and last use where the local counter has them.
- **Agents:** a table:
  - each relay role: tier, Claude model and effort, Codex model and effort, tools, read-only, maxTurns, source file, generated files;
  - then agents from other plugins and the user's agent folders.
- **How relay is wired:**
  - the pipeline drawn from `config/flow.json`, each step coloured by tier, with CLI steps dashed. Clicking a step shows its role, skills, tools and models;
  - "what is generated from what", with an in-sync or stale mark per output;
  - "who uses whom": command → skill → agent → `relay` subcommand.

## 6. Brain: sources and rules

### 6.1 Connectors

| Source | Harness | Kind | Read how |
|---|---|---|---|
| `~/.claude.json` → `mcpServers` (user scope) | Claude | `mcp-stdio` (has `command`) or `mcp-http` (has `url`) | JSON |
| each installed Claude plugin's `.mcp.json`, or `mcpServers` in its `plugin.json` | Claude | as above; source = the plugin's name | `~/.claude/plugins/installed_plugins.json` gives the install paths |
| `~/.codex/config.toml` → `[mcp_servers.<name>]` | Codex | `command` → stdio, `url` → http | `lib/hq/toml.mjs` |
| `<relayHome>/hq/connectors.json` (session snapshot) | either | `account` for every server not already found on disk | JSON |

- **Out of scope in this version:** project and local scopes (`<repo>/.mcp.json`, `~/.claude.json` → `projects[*].mcpServers`).
- **Two sources, one server.** When a server appears on disk and in a snapshot, they merge into one widget. The disk entry gives the source; the snapshot gives the tool count and "connected".
- **Status values:**
  - `connected`: seen in a snapshot or passed Verify;
  - `configured`: on disk and not verified;
  - `needs-auth`: an http server with neither a key nor a header that a snapshot or Verify reported as needing authentication, shown with the `/mcp` hint;
  - `key-missing`: a key it needs is missing;
  - `unreadable`: its source file failed to parse; the widget names the file.

**The snapshot** (`/relay:connectors`):

- The command tells the model to list the MCP servers whose tools it has in this session: the server part of `mcp__<server>__<tool>` names, plus a tool count per server.
- When the server id is opaque (a UUID, as in the desktop app), the model gives a label inferred from the tools and sets `labelInferred: true`.
- It pipes the JSON to `relay hq connectors --record`.
- The Codex version is the same text sent as a prompt.
- **Which harness recorded it.** Without `--harness`, the CLI decides: `claude` when `CLAUDECODE=1` is in its environment (Claude Code's shell sets it), `codex` when `RELAY_HARNESS=codex` is set (HQ's Codex launches set it) or a `CODEX_*` variable is present. With neither, it exits 64 and asks for `--harness`.
- **Refresh** in the UI launches this command headless, through the normal launch path with its confirmation.
- When a headless run sees fewer connectors than an interactive session (for example connectors added only in the desktop app), the user runs the command once in an open session.
- Each widget shows when its data was recorded.

**Verify** runs `claude mcp list`, and `codex mcp list` when Codex is installed, with a 60-second timeout. It maps lines to servers by name. When the output cannot be parsed, the raw output is shown instead and no status changes.

### 6.2 API keys

**Key names** are environment variable names matching `/(_API_KEY|_TOKEN|_SECRET|_ACCESS_KEY|_ACCESS_KEY_ID)$/`.

**Where keys are set:**
- the environment of the `relay hq` process;
- `env` in `~/.claude/settings.json`;
- `env` blocks of the MCP sources in 6.1.

**What "needs" a key:**
- an MCP config that references it: `${VAR}` in args, url or headers; `env` entries; Codex `bearer_token_env_var` and `env_vars`;
- a SKILL.md (relay, the user's or a plugin's) whose text names it.

**Status:**
- `set`: non-empty where it is expected;
- `missing`: needed, and set nowhere;
- `in-file`: a literal secret written into a config file, such as an `Authorization` header value or an `env` value that is not a reference.

`ANTHROPIC_API_KEY` being set gets a warning, because Claude Code then bills that key instead of the subscription.

**API connections** are key names mapped to services by a small built-in table, for example:
- `EXA` → Exa; `PARALLEL` → Parallel; `OPENAI` → OpenAI; `ANTHROPIC` → Anthropic; `GITHUB` → GitHub;
- `LINEAR` → Linear; `SENTRY` → Sentry; `STRIPE` → Stripe; `SUPABASE` → Supabase; `VERCEL` → Vercel;
- `GEMINI` or `GOOGLE` → Google; `PERPLEXITY`, `FIRECRAWL`, `TAVILY`, `BRAVE`, `SERPER`, `ELEVENLABS`, `REPLICATE`, `HF` → Hugging Face; `AWS` → AWS.

An unknown key keeps its own name.

**Values are read only to compute the status.** They never appear in any response, log or file HQ writes.

### 6.3 Skills, agents, CLIs

- **Skills:**
  - relay's `skills/*/SKILL.md`;
  - `~/.claude/skills/*/SKILL.md`;
  - each installed plugin's `skills/*/SKILL.md`;
  - `~/.codex/skills/*/SKILL.md`.

  Relay itself, installed as a plugin, is shown once, as relay. Usage comes from `skillUsage` in `~/.claude.json` (`usageCount`, `lastUsedAt`). It is undocumented, so the column hides itself when the shape does not match.
- **Agents:**
  - relay's roles, through `loadRoles` and `modelFor`;
  - `~/.claude/agents/*.md`;
  - plugins' `agents/*.md`;
  - `~/.codex/agents/*.toml` (name, description, and model when set).
- **CLIs:** presence on PATH for a fixed list: `gh`, `glab`, `docker`, `supabase`, `vercel`, `aws`, `gcloud`, `az`, `kubectl`, `terraform`, `stripe`, `fly`, `railway`, `netlify`. Only `gh` gets an auth check (`gh auth status`).

### 6.4 Wiring and `config/flow.json`

**Generated files** come from `outputs()` in `scripts/build.mjs`. Each output is compared in-process with the file on disk, so the "in sync" mark matches what `relay build --check` reports.

**References** are a deterministic scan of `commands/*.md`, `skills/*/SKILL.md` and `roles/*.md` for:
- the role names from `roles/`;
- the skill names from `skills/`;
- `relay <subcommand>` for the subcommands in `bin/relay`.

Each match is an edge: file → name.

**`config/flow.json`** describes relay's current pipeline as data:

```json
{
  "$comment": "Relay's pipeline, step by step. Descriptive for now: run-lanes is still the procedure the conductor follows. relay build checks every name.",
  "flows": [
    {
      "id": "feature",
      "label": "From an idea to a reviewed integration branch",
      "steps": [
        { "id": "find", "agent": "scout" },
        { "id": "plan", "agent": "architect", "skills": ["plan-with-tiers"] },
        { "id": "check", "cli": "lanes" },
        {
          "id": "waves", "repeat": "each wave, its lanes in parallel", "coordinator": "conductor", "skills": ["run-lanes"],
          "steps": [
            { "id": "tests-first", "agent": "test-author", "when": "lane risk medium or high with a test budget" },
            { "id": "implement", "agent": "implementer", "tier": "from the task" },
            { "id": "review", "agent": "reviewer", "skills": ["qa-mindset"] },
            { "id": "fix", "agent": "implementer", "when": "review findings, rounds 1-3, same agent" },
            { "id": "escalate", "agent": "implementer-deep", "when": "rounds 4-5" },
            { "id": "merge", "cli": "worktrees" }
          ]
        },
        { "id": "final-review", "agent": "architect" },
        { "id": "learn", "cli": "calibrate" }
      ]
    }
  ]
}
```

**`relay build` validates the file**, and `--check` fails on any problem:
- step ids are unique within a flow;
- every `agent` and `coordinator` is a role in `roles/`;
- every `skills` entry is a folder in `skills/`;
- every `cli` is a subcommand in `bin/relay`;
- a step has exactly one of `agent`, `cli` or `steps`.

The file changes no behaviour in this version. Sub-project C makes it the flow the conductor follows; until then it can lag behind `run-lanes` if one is edited without the other. Both files name each other in a comment to prevent that.

## 7. Launches

### 7.1 Actions

| Action | Claude Code | Codex |
|---|---|---|
| `plan` (repo, goal text) | `/relay:plan <goal>` | body of `commands/plan.md` |
| `run` (repo, plan) | `/relay:run <plan>` | body of `commands/run.md` |
| `marathon` (repo, plan, hours) | `relay marathon <plan> --hours N` | not available in this version |
| `skill` (repo, skill, prompt) | `Use the <skill> skill. <prompt>` | same text |
| `connectors` | `/relay:connectors` | body of `commands/connectors.md` |
| `setup-codex` (repo) | — | `relay setup codex <repo>` (no agent; offered when `.codex/agents/relay-*.toml` is missing) |

**The Codex prompt** for a command is the body of that `commands/*.md` file, after three changes:
- the frontmatter is removed;
- `$ARGUMENTS` is replaced by the arguments;
- `${CLAUDE_PLUGIN_ROOT}` is replaced by the relay root.

The instructions therefore live in one place.

### 7.2 Command lines

- **Claude Code:** `claude -p <prompt> --model <m> --effort <e> --permission-mode <mode> --output-format json`, in the repository's root. The binary comes from `resolveClaudeBin` (`RELAY_CLAUDE_BIN`, as marathon does).
- **Codex:** `codex exec <prompt> -m <m> -c model_reasoning_effort=<e> --sandbox <mode> --json`, in the repository's root. The flags are verified against `codex exec --help` before implementation (section 11).
- **Marathon:** `relay marathon <plan> --hours N`, detached. Marathon manages its own legs.

**Defaults and allowed values:**
- Model and effort come from the `mid` tier for the chosen harness.
- The allowed models are the three tiers' models for that harness.
- The allowed efforts are `low`, `medium`, `high`, `xhigh` and `max` on Claude Code (from `claude --help`), and `low`, `medium` and `high` on Codex (to verify, section 11).
- Permission mode defaults to `auto` on Claude Code and `workspace-write` on Codex.
- `bypassPermissions` (Claude) and `danger-full-access` (Codex) need an extra confirmation checkbox.

**Processes:**
- Every launch is spawned with `detached: true` in its own process group, with stdout and stderr going to `out.log`. On exit, `result.json` is written.
- When the server restarts, a launch is `running` while its pid is alive, and `done`, `failed` or `stopped` once `result.json` says so. A launch with no `result.json` and a dead pid is `lost`.
- Stop sends SIGTERM to the process group, then SIGKILL after 10 seconds, and records `stopped`.

### 7.3 Guards

`preview` evaluates these and `POST /api/launches` refuses on any of them:

- the repository is not registered, or the plan is not a file under its `docs/relay/plans/`;
- the harness binary is missing;
- `run` or `marathon` on a plan that looks alive:
  - an HQ launch for it whose pid is alive;
  - a marathon with phase `running` in its run directory;
  - a ledger with a `start:` line and no `plan: complete`, whose last line is newer than 30 minutes, on a board that is not `blocked`;
- `run` or `marathon` at budget level `critical`. At `tight` there is a warning only, matching relay's rules;
- a model, effort or permission mode outside the allowed values;
- `marathon` with hours outside 1–48.

**Resuming.** A started, unfinished plan (a `start:` line and no `plan: complete`) is not refused when its board is `blocked` or its last ledger line is older than 30 minutes. The run resumes from the ledger, and the dialog says "resumes from the ledger".

## 8. Security

- The server listens on 127.0.0.1 only. The default port is 4747 (or `--port`); if it is taken, the next 10 ports are tried.
- A 32-byte random token is created at every start and stored in `server.json` (0600). The page URL carries it in the fragment (`/#t=<token>`), so it never reaches a log or a Referer. The page keeps it in `sessionStorage` and sends `Authorization: Bearer <token>` on every API call.
- Every request is checked in order:
  1. `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding), else 403;
  2. `Origin`, when present, must be the server's own origin, else 403;
  3. every `/api/*` call needs the token, else 401;
  4. every POST needs `Content-Type: application/json`, else 415.

  No CORS headers are ever sent.
- Static files (`/`, `/app.js`, `/app.css`) are served without the token and contain no data.
- The client sends intents, never commands. argv is built on the server from the action table. User text (goal, prompt) is passed as a single argv element, and nothing runs through a shell.
- `relay hq` with a running server reuses it, by reading `server.json` and checking the pid and port. Otherwise it starts a new one.

## 9. Errors

| Situation | Behaviour |
|---|---|
| A repository cannot be read (git error, invalid plan) | only its card shows the error; the rest of the page renders |
| A registered path no longer exists | the card says "missing on disk" and offers Remove |
| `gh` missing or not authenticated | the GitHub parts show "not connected" |
| A harness config file is invalid | its widgets show `unreadable` with the file name; other sources still load |
| `skillUsage` has an unexpected shape | the usage column is hidden |
| `codex` not installed | Codex launches are disabled, with the reason |
| A launch fails to spawn or exits non-zero | status `failed`, with the tail of `out.log` |
| Adding a path that is missing or outside git | the `add` op returns 400 with the reason; the form shows it inline |
| The port and the next 10 are taken | `relay hq` exits 1 with a clear message |

## 10. Testing

The approach follows qa-mindset: few tests, each able to catch a real bug, using real git repositories through `test/helpers.mjs`, with HOME and `RELAY_HOME` pointed at temporary directories.

1. **Registration.**
   - Running the session-start hook in a repository leaves the registry untouched.
   - The `add` op registers a real repository's main root under a new project, and refuses a directory outside git.
2. **Repository summary.** A real repository has a fixture plan, a ledger whose latest line for lane b says BLOCKED, and a lane branch carrying a task commit. The summary's lights equal `boardFor`'s, and lane b appears as an attention item.
3. **Brain, connectors and keys.** A fake HOME holds `~/.claude.json` (one http server whose header is `${SENTRY_TOKEN}`), one installed plugin with `.mcp.json`, a `~/.codex/config.toml` with one stdio server and one literal `Authorization` header, and `settings.json` with `env`. The widgets carry the right source, harness and status: `key-missing` for Sentry, `in-file` for the literal header. **No secret value from the fixtures appears anywhere in the serialized response.**
4. **Launch command lines.** For `run` and `plan` on both harnesses:
   - the argv is as specified;
   - the Codex prompt equals `commands/run.md` with its frontmatter stripped and its arguments substituted;
   - a goal containing `"; rm -rf ~"` stays a single argv element.
5. **Guards.** A second `run` on a plan with an active launch is refused, and so is a `run` at budget `critical`.
6. **Server security.** A real server on an ephemeral port:
   - no token: 401;
   - a wrong `Host`: 403;
   - a POST without JSON: 415;
   - a correct request: 200.
7. **Launch lifecycle.** With `RELAY_CLAUDE_BIN` pointing at a stub script, the launch goes running, then done, and `result.json` is written. Stop on a sleeping stub ends it, with status `stopped`.
8. **Flow validation.** `relay build --check` fails when `config/flow.json` names a role or skill that does not exist.
9. **TOML subset.** The parser reads the `[mcp_servers.*]` shapes used in test 3 (dotted tables, strings, arrays, inline tables) and reports an unreadable file instead of throwing.

The UI has no automated browser tests. Before calling it done, the views are checked by hand in a browser against a real registry (home, a project, a plan with a task open, the launch dialog, each Brain tab), in light and dark.

Before finishing: `npm test` and `node bin/relay build --check`. `claude plugin validate .` runs because two new commands are added. `claude plugin test .` is not needed, since the mod is unchanged.

## 11. To verify at the start of implementation

These are facts this spec relies on that could not be checked on the design machine:

- **Codex flags.** Codex was not installed where this was designed; check each of these against `codex exec --help`:
  - `codex exec` takes `-m`, `-c model_reasoning_effort=…`, `--sandbox …` and `--json`;
  - the accepted reasoning-effort values;
  - that `codex mcp list` exists;
  - which `CODEX_*` variable its shell sets.
- **Account connectors in headless Claude.** Whether `claude -p` sees the claude.ai account connectors.
- **Plugin layout.** The shape of `~/.claude/plugins/installed_plugins.json` and the location of each plugin's `.mcp.json`.

## 12. Out of scope for this version

- Per-project token usage.
- The context cost of each MCP server: a mod cannot measure it, and `/context` shows it in a session.
- Project-local connectors.
- Changes to the mod (an HQ button on the band).
- Marathon on Codex.
- A shared or team server.
- Editing anything from Brain (it is read-only).

## Later sub-projects

Each gets its own spec, plan and implementation, and shows up in HQ through the sidebar.

- **C. Flows as building blocks.** `config/flow.json` becomes what the conductor follows. A new step or role is added to a flow without editing `run-lanes`.
- **D. The team.** Roles with an identity, covering the people a real project team would have:
  - business analyst;
  - architect;
  - systems or platform engineer;
  - reviewer;
  - QA;
  - possibly security.

  Each has a persona, a colour and an avatar, plus a mod pane showing who is working on what, on which model, at what cost.
- **E. The project contract.** An architecture contract the architect enforces and the reviewer checks, a canonical test dataset, and a business-requirements appendix with ids that tasks trace to and reviews validate.
- **F. Routines.** Scheduled engineering routines: active or passive, capped, visible in HQ.
