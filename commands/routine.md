---
description: Enable, disable or refresh a relay routine as a Claude desktop scheduled task.
argument-hint: "enable <routine> (--project <id> | --repo <path> | --all) [--days mon,…] [--at HH:MM] | disable <instance> | refresh"
allowed-tools: Bash(relay routine*), mcp__scheduled-tasks__create_scheduled_task, mcp__scheduled-tasks__update_scheduled_task, mcp__scheduled-tasks__list_scheduled_tasks
disable-model-invocation: true
---
Arguments: `$ARGUMENTS`. `relay` is on your PATH; run it by name. Show every relay output unchanged, in a code block.

First check that you have the scheduled-tasks tool. If you do not, reply with exactly one line, `Scheduled tasks need the Claude desktop app: run /relay:routine $ARGUMENTS in a desktop session.`, and stop; a pending routine stays pending.

**enable**: run `relay routine enable <the rest of the arguments> --harness claude`. If it exits non-zero, stop. The instance id is on the `pending:` line. Call the scheduled-tasks create call with exactly the `taskId`, `title`, `description`, `prompt` and `cronExpression` of the JSON after `RELAY_PROPOSAL: `. When it succeeds, run `relay routine confirm <instance> --task-id <the id of the created task>`. Reply with one line: the instance, its schedule, and that it runs while the app is open.

**disable**: run `relay routine show <instance> --json` and take `instance.taskId`. When it is set, disable that task with the scheduled-tasks update call (`enabled: false`). Then run `relay routine disable <instance>`. Reply with one line.

**refresh**: run `relay routine refresh`. For each `RELAY_UPDATE: ` line, call the scheduled-tasks update call with its `taskId` and `prompt`, then run `relay routine confirm <instance> --task-id <taskId>`. Reply with one line: how many tasks were refreshed.

Do nothing else.
