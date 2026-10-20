---
description: The plan's roadmap as traffic lights — grey planned, yellow in progress, green done, red blocked — here and as a page in your browser.
argument-hint: "[plan.md]"
allowed-tools: Bash(relay *) Bash(ls *)
disable-model-invocation: true
---
Plan: $ARGUMENTS (when empty, run `ls -t docs/relay/plans` on its own and use the first file; say which).

Run `relay board <plan> --html --open` (on your PATH; run it by name) and show its output unchanged, in a code block. Then two lines at most: the roadmap page opened in the browser and reloads itself while the run goes; `/relay-board` opens the same board in a pane here, and a band above the prompt shows it while a run is going. Do not change anything.
