---
description: Show a relay plan's blueprint — which tasks share a lane, which lanes run in parallel, wave by wave.
argument-hint: "[plan.md]"
allowed-tools: Bash(relay *) Bash(ls *)
disable-model-invocation: true
---
Plan: $ARGUMENTS (when empty, run `ls -t docs/relay/plans` on its own and use the first file; say which).

Run `relay lanes <plan>` (on your PATH; run it by name) and show its output to the user unchanged, in a code block. If it reports errors, list each with the plan line to change. Do not run or write anything else.
