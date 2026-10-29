<!-- generated-by: gsd-doc-writer -->
# Getting started with Relay

Relay provides architecture design, implementation workflows, and independent teaching and system reconstruction. Choose Claude Code or Codex, then use the entry point for your task. Installation and discovery depend on the host you actually run.

## Prerequisites

- **Node.js >=20** for the CLI and command hooks, plus **Git** for repository work.
- **Claude Code** or **Codex** with the plugin, agent and hook capabilities you intend to use.
- A project directory and host permissions for the chosen work. Research keeps project code read-only; implementation needs the relevant write permissions.

Relay has no package dependencies. Its repository tests use Node's built-in test runner. No dependency installation is needed for the checks below. See [package.json](../../package.json) for the runtime requirement and scripts.

## Check a source checkout

1. Clone Relay and enter its root:

   ```bash
   git clone https://github.com/cube-digital/relay.git
   cd relay
   ```

2. Check the runtime, repository tests and generated files:

   ```bash
   node --version
   npm test
   node bin/relay build --check
   ```

These commands inspect the checkout. They do not install its plugin into a host. Read the [testing guide](../testing/README.md) for what each check proves and the current recorded results.

Use `node bin/relay ...` only from the Relay source root. In another project, use `node "/absolute/path/to/installed/relay/bin/relay" ...`. Replace that placeholder with the installed root from plugin details or skill discovery. A global `relay` command is optional.

## Install for Claude Code

1. Add the marketplace and plugin from a terminal:

   ```bash
   claude plugin marketplace add cube-digital/relay
   claude plugin install relay@relay
   ```

2. Restart Claude Code or use `/reload-plugins`. Inspect `/plugin` for Relay and its mod. The mod supplies model routing, usage readings and lane working directories. Check its actual status on your host.

3. From the target Git repository, apply project settings and read the budget:

   ```bash
   node "/absolute/path/to/installed/relay/bin/relay" setup claude --write-project
   node "/absolute/path/to/installed/relay/bin/relay" budget --harness claude
   ```

   Setup merges `worktree.baseRef: "head"` and `subagentPromptCacheTtl: "1h"` into project settings. It does not grant host permissions. After usage data arrives, the budget command can read the mod's snapshot.

For a temporary source-checkout session, run `claude --plugin-dir /absolute/path/to/relay` from the target project. See [README installation](../../README.md#installation) for team scope, updates and removal.

## Install for Codex

1. Register a local Relay checkout and install its plugin:

   ```bash
   codex plugin marketplace add /absolute/path/to/relay
   codex plugin add relay@relay
   ```

   Keep the marketplace name `relay`. Installation copies the payload into the host's plugin cache. Refresh or reinstall it after source changes, then start a new chat.

2. Find the installed root in plugin details. Use that copy for native plugin setup:

   ```bash
   node "/absolute/path/to/installed/relay/bin/relay" setup codex /absolute/path/to/project --plugin
   node "/absolute/path/to/installed/relay/bin/relay" doctor --harness codex --project /absolute/path/to/project
   node "/absolute/path/to/installed/relay/bin/relay" budget --harness codex
   ```

   `--plugin` installs project agent definitions. It supplies `[agents]` defaults when the project config is absent. Existing config is preserved; review any printed missing defaults and `.relay-pending` agent files. Native hooks come from the plugin manifest.

3. Start a new Codex session for agent discovery. Inspect `/hooks` and approve the hooks you trust. Setup cannot grant trust or sandbox permissions. Doctor reports trust as unknown; inspect it in the host.

If Codex is absent from `PATH`, use its absolute executable path. Relay's diagnostics and budget reads also accept `--codex-bin /absolute/path/to/codex` or `RELAY_CODEX_BIN`. See the [configuration guide](../configuration/README.md).

### Codex fallback without native plugin hooks

Choose this separate path when native Relay plugin hooks are not enabled:

```bash
node "/absolute/path/to/relay/bin/relay" setup codex /absolute/path/to/project
```

This installs project agents, project hooks and `.agents/skills/` links. Existing differing hooks are preserved with a separate merge candidate. Review that candidate, start a new session and inspect `/hooks`. Use one Relay hook installation at a time. When migrating to native hooks, remove only Relay's project-hook entries and preserve other hooks. See [setup instructions](../../skills/relay-setup/SKILL.md).

## First architecture design

Use the shared design skill to explore a problem with the existing architect:

| Host | Request |
|---|---|
| Claude Code | `/relay:relay-design Design a durable import pipeline from requirements.md` |
| Codex | `$relay-design Design a durable import pipeline from requirements.md` |

Substitute your requirements or describe the problem directly. Ask for a comparison in chat or a saved architecture document. The architect researches alternatives, challenges assumptions, and explains one concrete flow before adding technical detail. It can work independently of teaching and reverse engineering.

When you want implementation planning, give the saved design to `/relay:plan` or `$relay-plan`. Planning preserves accepted decisions and adds tasks, checks, and documentation updates. See the [architecture design guide](architecture-design.md) for research, review, and document maintenance.

## First implementation request

In the target project's chat, request a plan:

| Host | Request |
|---|---|
| Claude Code | `/relay:plan Add CSV export for invoices` |
| Codex | `$relay-plan Add CSV export for invoices` |

Read the returned spec, plan, assumptions and forecast. Then run that exact plan path:

| Host | Request |
|---|---|
| Claude Code | `/relay:run docs/relay/plans/<returned-plan>.md` |
| Codex | `$relay-run docs/relay/plans/<returned-plan>.md` |

The run produces a reviewed integration branch such as `relay/<slug>/integration`. Review its report and recorded decisions. You decide whether to merge it into your branch. See the [README workflows](../../README.md#workflows-step-by-step) for lanes, reviews and long runs.

## Turn an existing plan into tickets

Use the same shared skill in either host:

| Host | Request |
|---|---|
| Claude Code | `/relay:to-tickets docs/relay/plans/<plan>.md` |
| Codex | `$relay-to-tickets docs/relay/plans/<plan>.md` |

You can also ask: "Turn this plan into tickets that a developer or agent can implement."
The skill accepts a specification or agreed conversation too. Each ticket includes
its purpose, deliverable, relevant decisions, scope, acceptance criteria,
verification, source references, and blockers. It does not require another plan.

The default output is reviewable drafts in chat. To save files, ask for local
tickets; the default directory is `docs/relay/tickets/<feature-slug>/`. To publish
issues, name the tracker and project. Source decisions remain intact, unresolved
decisions are explicit, and ticket preparation does not start implementation.
See the [skill](../../skills/relay-to-tickets/SKILL.md) and
[ticket template](../../skills/relay-to-tickets/ticket-template.md).

## First teaching or reconstruction request

Use these independently in the current conversation:

| Host | Teach | Reconstruct |
|---|---|---|
| Claude Code | `/relay:relay-teach Explain the cache hit path in src/cache.ts; max-helpers=0. Just explain.` | `/relay:relay-reverse-engineer Reconstruct src/cache.ts using docs/cache-intent.md; max-helpers=0.` |
| Codex | `$relay-teach Explain the cache hit path in src/cache.ts; max-helpers=0. Just explain.` | `$relay-reverse-engineer Reconstruct src/cache.ts using docs/cache-intent.md; max-helpers=0.` |

Substitute paths that exist in your project. Native role names are `relay:teacher` and `relay:reverse-engineer` in Claude Code, or `relay-teacher` and `relay-reverse-engineer` in Codex. A handoff between them is optional.

Direct roles use the caller's installed root, available plugin metadata or skill discovery. A copied project TOML or target checkout does not identify that root. If the root is unavailable, supply the installed skill or root location. Required bundled guidance must be readable before dependent work proceeds. If custom role types are unavailable, use only the active tool's supported fallback with the installed source role. Host tools and sandboxes still apply.

See the [teaching and reverse-engineering guide](teaching-and-reverse-engineering.md) for focus, explanation depth, evidence and helper limits.

## Common setup issues

| Symptom | Check or correction |
|---|---|
| CLI or hooks fail on an older runtime | Check `node --version`; use Node.js >=20. |
| Codex cannot find agents after setup | Start a new session. Check project config and any pending files with `doctor --harness codex --project <path>`. |
| Hooks are configured but inactive | Inspect host trust in `/hooks`. Files and doctor output cannot grant it. |
| Codex setup reports duplicate Relay hooks | Choose native or fallback hooks, then preserve unrelated hooks while removing duplicates. |
| Budget is `unknown` | Check the executable, snapshot age and host usage source. Treat unknown as tight. |

## Next steps

- [Architecture design](architecture-design.md) explains collaborative design and the planning handoff.
- [Architecture](../architecture/overview.md) and [configuration](../configuration/README.md) explain source ownership and routing.
- [Development](development.md), [testing](../testing/README.md) and [contributing](../../CONTRIBUTING.md) cover changes and verification.
- [Teaching and reverse engineering](teaching-and-reverse-engineering.md) explains the independent research paths.
