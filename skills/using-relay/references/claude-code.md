# Claude Code dispatch and resources

Use `relay:<role>` agents through the active Agent dispatch tool. Relay's mod routes tiers and caps against the account budget. Name lane agents as printed by worktree sync so the mod assigns their worktrees. Without the mod, include `Work only in <absolute-worktree>; cd there first.` and request the model/effort from the Claude routing table using supported dispatch fields.

Resolve the plugin root from the real SKILL.md path or `${CLAUDE_PLUGIN_ROOT}` when available. Invoke helpers as `node "<absolute-relay-root>/bin/relay" ...`. Resolve reviewer, template and skill references from that root. No npm link is required. Use `--harness claude` for budget, forecast, calibrate, ledger and marathon when both harnesses are installed.

For implementation work, the Agent tool can run the conductor in the background when supported. Without background support, coordinate through run-lanes in the current task. Don't promise a detached task. Supply the absolute installed Relay root in every role brief when task context is supported. Give workers file ownership and tell them others are working and their changes must be preserved. Report output is the only permitted write for read-only review/scout roles. Native plugin hooks load through Claude's plugin system. Do not install Codex project hooks for a Claude session.

## Teaching and research

Invoke `/relay:relay-teach` or `/relay:relay-reverse-engineer` through plugin skill discovery. Native `relay:teacher` and `relay:reverse-engineer` work independently. Follow the shared engine under `<absolute-relay-root>/skills/research-and-explain/`. Entry skills act as the interactive lead in the current conversation. Do not create a lead child automatically.

Direct child roles use only available listed local/web tools. Their allowlist has no Agent tool. They research serially and do not use nested delegation. An interactive main-session lead may dispatch research-only helpers only when the active Agent tool and actual global capacity permit. Follow the shared budget and helper ceiling. Supply the installed root, bounded question, source scope, existing evidence, focus, `mode=research-only`, report-only write scope, optional exact report path, and no recursive delegation or implementation.

If a custom role type is unavailable, pass the installed source role through the active tool's supported fallback. Do not invent tool capabilities or model fields. Tool allowlists and sandboxes are ceilings. Role instructions restrict writes further. Write only an assigned report within actual permissions. If the sandbox prevents it, return evidence for caller capture. Do not escalate write rights for convenience.
