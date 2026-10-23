# Codex dispatch and resources

Use the active harness tools; do not invent a tool or parameter the session does not expose. Custom agents are named `relay-<role>`; when the tool supports a custom agent type, name it explicitly. Resolve roles and templates from the absolute installed Relay root determined from the skill's real path. If custom agent types are unavailable, read the bundled role and put its instructions in the spawned task. Never read `roles/reviewer.md` relative to the target project.

Read `<relay-root>/config/routing.json` to select the Codex model and effort for each tier. Always request that model and effort on spawn using the active tool's supported fields. The native spawn hook applies budget caps; profiles intentionally contain no model/effort keys that could override the request. The project `[agents]` defaults backstop omitted choices. Do not change the parent session model or personal settings.

## Clean worker dispatch (V2)

Start each new Relay worker with `fork_turns: "none"`, supplying only the task, absolute brief/report paths, file ownership and necessary interface facts. Read the bundled role or select its available custom agent type. Set `model` and `reasoning_effort` explicitly from the Codex routing table on this clean spawn.

In the active collaboration API, model/effort overrides are valid only with `fork_turns: "none"`. An omitted `fork_turns` or `fork_turns: "all"` inherits the parent model and effort and cannot accept those overrides. Do not combine a full-history fork with overrides, and do not rely on an override being accepted there. Resume an existing worker for related fixes to preserve its useful local context.

Every lane prompt starts `Work only in <absolute-worktree>; cd there first.` Give each worker explicit file ownership, tell it that others are working and their changes must be preserved, and provide an absolute report path. Use the active collaboration wait/resume facilities; if background threads are unavailable, coordinate in the current task. Never promise an independent background run that the available tools cannot support.

Invoke helpers as `node "<absolute-relay-root>/bin/relay" ...`. Add `--harness codex` to budget, forecast, calibrate, ledger, and marathon commands. For a different Codex executable set `RELAY_CODEX_BIN` to its absolute path. For cross-harness review use the bundled absolute reviewer role path. A read-only sandbox cannot write an in-project report; use supported output-file capture (`codex exec -o <report>`) or return the review to the coordinator for saving.

Native plugin installation supplies skills and trusted command hooks. Run `setup codex <project> --plugin` from the bundled CLI for project agents and defaults, then start a new session. Do not install fallback project hooks alongside native plugin hooks. Hook trust is a user decision in `/hooks`; setup and doctor cannot infer or grant it.
