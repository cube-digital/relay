# Codex dispatch and resources

Use the active harness tools. Do not invent a tool or parameter the session does not expose. Custom agents are named `relay-<role>`. When the tool supports a custom agent type, name it explicitly. Resolve roles and templates from the absolute installed Relay root determined from the skill's real path. If custom agent types are unavailable, read the bundled role and put its instructions in the spawned task. Never read `roles/reviewer.md` relative to the target project.

Codex routing lives in `<relay-root>/codex-math/config/codex-routing.json`: cheap `gpt-6-luna`/`low`, mid `gpt-6.1-sol`/`medium`, strong `gpt-6-astra`/`high`, standard speed. Agent definitions carry no model or effort, because a model in an agent TOML overrides the spawn request (observed, Codex 0.163.0). Request model and effort on every clean spawn with the active tool's supported fields. The native spawn hook applies budget caps. `agent_type: relay-<role>` exists only after `setup codex` registers the roles in the project `.codex/config.toml`. When it is missing, use the fallback above and request the tier's model and effort explicitly. Project `[agents]` defaults backstop omitted choices. Do not change the parent session model or personal settings.

## Clean worker dispatch (V2)

Start each new Relay worker with `fork_turns: "none"`, supplying only the task, absolute brief/report paths, file ownership and necessary interface facts. Read the bundled role or select its available custom agent type. Set `model` and `reasoning_effort` explicitly from the Codex routing table on this clean spawn.

In the active collaboration API, model/effort overrides are valid only with `fork_turns: "none"`. An omitted `fork_turns` or `fork_turns: "all"` inherits the parent model and effort and cannot accept those overrides. Do not combine a full-history fork with overrides, and do not rely on an override being accepted there. Resume an existing worker for related fixes to preserve its useful local context.

Every lane prompt starts `Work only in <absolute-worktree>; cd there first.` Give each worker explicit file ownership, tell it that others are working and their changes must be preserved, and provide an absolute report path. Use the active collaboration wait/resume facilities. If background threads are unavailable, coordinate in the current task. Never promise an independent background run that the available tools cannot support.

Invoke helpers as `node "<absolute-relay-root>/bin/relay" ...`. Add `--harness codex` to budget, forecast, calibrate, ledger, and marathon commands. For a different Codex executable set `RELAY_CODEX_BIN` to its absolute path. For cross-harness review use the bundled absolute reviewer role path. A read-only sandbox cannot write an in-project report. Use supported output-file capture (`codex exec -o <report>`) or return the review to the coordinator for saving.

## Budget and concurrency

`relay budget --harness codex` reads the account's actual windows. A 5-hour primary window is tight at 60% and critical at 85%. A secondary window under seven days is tight at 80% and critical at 95%. Any window of seven days or more (the weekly window, and the only window on Pro) is tight at 80% and critical at 95%. No reading, or a stale one, is `unknown`. Act as tight. Under a cap the hook lowers speed first, then effort, then model.

A Codex session runs at most three child agents at once by default. The fourth spawn fails with `agent thread limit reached`. A finished agent holds its slot until it is closed. Under Codex, `relay lanes`, `forecast` and `worktrees sync` plan at most three lanes per wave.

Coordinate lanes from the root session. A conductor child takes one slot. Close test-authors and reviewers when their results are recorded. Close a lane agent when its review is clean. When every slot is busy and a lane needs review, use the out-of-process review (`codex exec --sandbox read-only -o <review path> ...`). It takes no slot. Do not retry a failed spawn in a loop. Wait for an agent, close it, then spawn.

## Installation guidance

Use this section only when setup is requested. Native plugin installation supplies skills and trusted command hooks. Run `setup codex <project> --plugin` from the bundled CLI for project agents and defaults, then start a new session. Do not install fallback project hooks alongside native plugin hooks. Hook trust is a user decision in `/hooks`. Setup and doctor cannot infer or grant it.

## Architecture design

Invoke `$relay-design` through skill discovery, or use native `relay-architect`. The entry skill acts as the interactive architect in the current conversation. Direct native design requests read the design references from the installed root. Preserve the architect's existing plan and final-review responsibilities.

For optional helpers, follow `skills/relay-design/references/research.md` from the installed root. Use actual capacity, the existing budget and routing table, clean spawns, and the supported custom-type fallback above. Supply `mode=research-only` or `mode=design-review`, a bounded task, and no recursive delegation. An allowlist or role instruction does not create unavailable web or dispatch tools. Do not install hooks or change settings as part of design.

## Teaching and research

Invoke `$relay-teach` or `$relay-reverse-engineer` through skill discovery. A native `relay-teacher` or `relay-reverse-engineer` also works independently. Entry skills act as the interactive lead. Do not create a lead child automatically. Follow the shared engine under `<absolute-relay-root>/skills/research-and-explain/`.

Use only active tools and supported parameters. Before a permitted research helper spawn, check budget and actual global capacity. Use `fork_turns: 'none'`. Select model and reasoning effort from the existing routing table. Supply the absolute installed root in every role brief. Include a bounded question, evidence scope, existing evidence, focus, `mode=research-only`, report-only write scope, optional exact report path, and no recursive delegation or implementation.

If custom types are unavailable, read the source role from the installed root. Pass its instructions through the active tool's supported fallback. Do not invent model override fields. Do not claim that a fallback agent receives role-name-specific hook recognition. Preserve explicit dispatch precedence and hook budget caps. Do not change the parent model or personal settings.

Host tool allowlists and sandboxes are ceilings. Roles restrict writes further. Codex TOMLs are agent definitions. They do not set a new sandbox or tool policy. A read-only sandbox can prevent an assigned report write. Return evidence or let the caller use supported output capture. Do not escalate write rights for convenience.
