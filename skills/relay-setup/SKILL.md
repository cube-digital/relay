---
name: relay-setup
description: Use when installing Relay in a project, completing native plugin onboarding, or diagnosing routing, discovery and hooks.
---
# Relay setup

Resolve this SKILL.md to its absolute real path. Relay's installed root is two directories above its containing directory. Run every helper as `node "<absolute-relay-root>/bin/relay" ...`; no PATH installation is needed. Read the matching harness reference in `<relay-root>/skills/using-relay/references/`.

Show the concrete project settings changes before applying them unless installation/setup is already authorized. Never change personal/global settings as part of project setup.

## Codex

Native plugin onboarding: run the bundled CLI `setup codex <absolute-project> --plugin`. It installs project agent profiles and, only if absent, project `[agents]` defaults. Existing configuration is preserved; review the printed missing defaults. Native hooks come from the plugin manifest; do not also install project hooks. Start a new session, inspect `/hooks` and let the user approve trust. Setup cannot grant trust.

Fallback without native plugin hooks: run `setup codex <absolute-project>` to install project agents, hooks and `.agents/skills/` discovery links. Do not combine this with native plugin hooks. Existing differing hook files are preserved and a separate merge candidate is written. A malformed hook/config file must be repaired before setup proceeds.

Run `doctor --harness codex --project <absolute-project>` for read-only executable, resources, agent discovery and hook configuration diagnostics. `--codex-bin <absolute-executable>` or `RELAY_CODEX_BIN` handles an app-bundled executable absent from PATH. Doctor reports trust as unknown; verify it in `/hooks`. `budget --harness codex` reads the account's actual windows; unknown usage means act as tight.

For a local marketplace use `codex plugin marketplace add <absolute-relay-root>` and `codex plugin add relay@relay-local`. The local marketplace is named `relay-local` to avoid the remote marketplace name. Installation copies into Codex's plugin cache; source edits are not live. Refresh/reinstall the local plugin and start a new chat after changes. Hook-bearing plugins currently use manual/local desktop installation; follow the host's native trust flow.

## Claude Code

`setup claude` prints recommendations; `setup claude --write-project` merges project `worktree.baseRef: "head"` and `subagentPromptCacheTtl: "1h"`. Confirm the plugin/mod is active in `/plugin`, then run `budget --harness claude` and `lanes "<relay-root>/skills/plan-with-tiers/template.md"`.

## Routing and long runs

Edit `config/routing.json` or `roles/`, then run the bundled `build`; never hand-edit generated agents or hooks. Use the shared relay-marathon skill for unattended runs and pass the active `--harness`. Keep the computer awake; use an independent terminal when the session cannot own a background process.
