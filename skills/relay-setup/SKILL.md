---
name: relay-setup
description: Use when installing Relay in a project, completing native plugin onboarding, or diagnosing routing, discovery and hooks.
---

Resolve this SKILL.md to its absolute real path. Relay's installed root is two directories above its containing directory. Run every helper as `node "<absolute-relay-root>/bin/relay" ...`. No PATH installation is needed. Read the matching harness reference in `<relay-root>/skills/using-relay/references/`.

Write instructions as strict STE-style drafts. Use short sentences, clear actors, and consistent terms. Keep code, commands, paths, identifiers, output markers, quotations, and evidence exact. For teacher explanations, adapt the words and detail to the learner. Use examples, analogies, and diagrams when they help.

Read `<absolute-relay-root>/skills/using-relay/references/language-guide.md` and `<absolute-relay-root>/skills/using-relay/references/software-glossary.md`. Substitute the resolved installed root for `<absolute-relay-root>` in actual reads. If the references are unavailable, keep the inline policy. Report unavailable language guidance. Do not claim that the full language review passed. Do not load an unrelated coding workflow as a fallback. Load these references directly. Do not run the `using-relay` workflow to load language rules.

# Relay setup

Show the concrete project settings changes before applying them unless installation/setup is already authorized. Never change personal/global settings as part of project setup.

## Codex

For native plugin onboarding, run the bundled CLI `setup codex <absolute-project> --plugin`. It installs project agent definitions. It adds project `[agents]` defaults only when absent. Existing configuration is preserved. Review the printed missing defaults. Native hooks come from the plugin manifest. Do not also install project hooks. Start a new session, inspect `/hooks` and let the user approve trust. Setup cannot grant trust.

Fallback without native plugin hooks: run `setup codex <absolute-project>` to install project agents, hooks and `.agents/skills/` discovery links. Do not combine this with native plugin hooks. Existing differing hook files are preserved and a separate merge candidate is written. A malformed hook/config file must be repaired before setup proceeds.

Run `doctor --harness codex --project <absolute-project>` for read-only executable, resources, agent discovery and hook configuration diagnostics. `--codex-bin <absolute-executable>` or `RELAY_CODEX_BIN` handles an app-bundled executable absent from PATH. Doctor reports trust as unknown. Verify it in `/hooks`. `budget --harness codex` reads the account's actual windows. Unknown usage means act as tight.

For a local marketplace use `codex plugin marketplace add <absolute-relay-root>` and `codex plugin add relay@relay`. Keep the marketplace name `relay` across Git and local sources. Switch a registered source by removing and re-adding that marketplace. Use `--ref` for a Git branch or tag. Installation copies into Codex's plugin cache. Source edits are not live. Refresh/reinstall the plugin and start a new chat after changes. Hook-bearing plugins currently use manual/local desktop installation. Follow the host's native trust flow.

## Claude Code

`setup claude` prints recommendations; `setup claude --write-project` merges project `worktree.baseRef: "head"` and `subagentPromptCacheTtl: "1h"`. Confirm the plugin/mod is active in `/plugin`, then run `budget --harness claude` and `lanes "<relay-root>/skills/plan-with-tiers/template.md"`.

## Routing and long runs

Edit `config/routing.json` or `roles/`, then run the bundled `build`. Never hand-edit generated agents or hooks. Use the shared relay-marathon skill for unattended runs and pass the active `--harness`. Keep the computer awake. Use an independent terminal when the session cannot own a background process.
