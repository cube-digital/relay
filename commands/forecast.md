---
description: Forecast a relay plan before running it — agents, worktrees, parallel lanes, usage windows and hours.
argument-hint: "[plan.md]"
allowed-tools: Bash(relay *) Bash(ls *)
disable-model-invocation: true
---
Plan: $ARGUMENTS (when empty, run `ls -t docs/relay/plans` on its own and use the first file; say which).

Run `relay forecast <plan>` (on your PATH; run it by name) and show its output to the user unchanged, in a code block. Then at most three lines: whether the run fits one 5-hour window or how many it spans, whether it fits what is left of the weekly limit, and, if the rates say PLACEHOLDER, that `/relay:calibrate <plan>` after the first real run makes them real.
