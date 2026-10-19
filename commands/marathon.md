---
description: Run a relay plan unattended for hours, across usage windows, from this session. Also status and stop.
argument-hint: "<plan.md> <hours> [terminal] | status [plan.md] | stop [plan.md] [now]"
allowed-tools: Bash(relay *) Bash(ls *) Bash(osascript *) Bash(git rev-parse *)
disable-model-invocation: true
---
Arguments: $ARGUMENTS

When no plan is given, run `ls -t docs/relay/plans` on its own and use the first file; say which. `relay` is on your PATH: run it by name, one command per call.

- `status [plan]`: run `relay marathon <plan> --status` and show the output unchanged.
- `stop [plan] [now]`: run `relay marathon <plan> --stop`, adding `--now` when asked; show the output.
- `<plan> <hours> [terminal] [flags]`: start a marathon.
  1. Run `relay marathon <plan> --hours <hours> --dry-run` with any extra flags. Show the forecast. If it refuses (uncommitted changes, invalid plan, already running), stop and say what to fix.
  2. Start it. Default: the same command without `--dry-run`, with the Bash tool as a background task (`run_in_background`), never in the foreground. With `terminal` (macOS), or when your Bash tool cannot run in the background: open it in its own Terminal window so it does not depend on this session, using absolute paths:
     `osascript -e 'tell application "Terminal" to do script "cd <repo root> && RELAY_CLAUDE_BIN=<claude path from the dry run> ${CLAUDE_PLUGIN_ROOT}/bin/relay marathon <absolute plan path> --hours <hours>"'`
     (repo root from `git rev-parse --show-toplevel`; quote paths that contain spaces). On other systems, give the user that `relay marathon` line to run under tmux instead.
  3. Tell the user in three lines where it runs. Background task: keep Claude Code open and the computer awake; closing the session stops it, and starting it again continues from the ledger. Terminal window: it survives closing Claude Code, as long as the computer stays awake. Either way, `/relay:marathon status` shows where it is and `/relay:marathon stop` ends it after the current leg.
  4. Do not poll. When you learn a background task has finished, run `relay marathon <plan> --status` and `relay ledger <plan> --rulings`, then report the outcome, the waves merged, what is left and the rulings worth a human look. If the plan completed, run `relay calibrate <plan>`.
