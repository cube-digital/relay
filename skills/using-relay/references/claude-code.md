# Claude Code dispatch and resources

Use `relay:<role>` agents through the active Agent dispatch tool. Relay's mod routes tiers and caps against the account budget; name lane agents as printed by worktree sync so the mod assigns their worktrees. Without the mod, include `Work only in <absolute-worktree>; cd there first.` and request the model/effort from the Claude routing table using supported dispatch fields.

Resolve the plugin root from the real SKILL.md path or `${CLAUDE_PLUGIN_ROOT}` when available. Invoke helpers as `node "<absolute-relay-root>/bin/relay" ...`; resolve reviewer, template and skill references from that root. No npm link is required. Use `--harness claude` for budget, forecast, calibrate, ledger and marathon when both harnesses are installed.

The Agent tool can run the conductor in the background when supported. Without background support, coordinate through run-lanes in the current task; don't promise a detached task. Give workers file ownership and tell them others are working and their changes must be preserved. Report output is the only permitted write for read-only review/scout roles. Native plugin hooks load through Claude's plugin system; do not install Codex project hooks for a Claude session.
