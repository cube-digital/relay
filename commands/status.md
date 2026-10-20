---
description: Where a relay plan's run is — ledger, lanes, budget, and the marathon if one is running.
argument-hint: "[plan.md]"
allowed-tools: Bash(relay *) Bash(ls *)
disable-model-invocation: true
---
Plan: $ARGUMENTS (when empty, run `ls -t docs/relay/plans` on its own and use the first file; say which).

Run, one per call: `relay board <plan>`, `relay budget`, `relay marathon <plan> --status`. Show the board's output unchanged, in a code block. Then at most five lines: what is in progress or blocked and why (from the lane notes), rulings so far, the budget level, and whether a marathon is running or waiting for a reset. For details run `relay ledger <plan>`. Do not dispatch or change anything.
