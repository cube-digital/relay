---
name: relay-marathon
description: Use to run a relay plan unattended for hours, across usage windows, from this session. Also status and stop.
---
# Relay marathon

Resolve this SKILL.md to its absolute real path; the installed Relay root is two directories above its containing directory. Read `<relay-root>/skills/using-relay/references/<harness>.md` (`codex` or `claude-code`). In all instructions, `relay <args>` means `node "<absolute-relay-root>/bin/relay" <args>`; substitute the resolved path on every call. Resolve all bundled skills, templates and roles from that same root. Never require a `relay` command on PATH or look for bundled files in the target project.

Arguments: the user’s arguments

When no plan is given, run `ls -t docs/relay/plans` on its own and use the first file; say which.

- `status [plan]`: run `relay marathon <plan> --status` and show the output unchanged.
- `stop [plan] [now]`: run `relay marathon <plan> --stop`, adding `--now` when asked; show the output.
- `<plan> <hours> [terminal] [flags]`: start a marathon.
  1. Run `relay marathon <plan> --hours <hours> --dry-run` with any extra flags. Show the forecast. If it refuses (uncommitted changes, invalid plan, already running), stop and say what to fix.
  2. Start it. Default: the same command without `--dry-run`, with the active harness’s supported background process facility, never in the foreground. With `terminal` (macOS), or when the active shell tool cannot detach a process: open it in its own Terminal window so it does not depend on this session, using absolute paths:
     Build the shell command with `cd <absolute-repo>` followed by `node "<absolute-relay-root>/bin/relay" marathon <absolute-plan> --hours <hours> --harness <codex|claude>`. Set `RELAY_CODEX_BIN` or `RELAY_CLAUDE_BIN` to the absolute executable from the dry run when needed. Quote each shell argument, then escape the complete command for AppleScript's string before passing it to `osascript` (`tell application "Terminal" to do script ...`). On other systems, give the fully resolved command to run under tmux.
  3. Tell the user in three lines where it runs. Background task: keep the active session open and the computer awake; closing the session stops it, and starting it again continues from the ledger. Terminal window: it survives closing the active session, as long as the computer stays awake. Either way, `/relay:marathon status` shows where it is and `/relay:marathon stop` ends it after the current leg.
  4. Do not poll. When you learn a background task has finished, run `relay marathon <plan> --status` and `relay ledger <plan> --rulings`, then report the outcome, the waves merged, what is left and the rulings worth a human look. If the plan completed, run `relay calibrate <plan>`.
