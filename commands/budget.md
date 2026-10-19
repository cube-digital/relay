---
description: Show the 5-hour and weekly usage level relay is routing by — normal, tight or critical.
allowed-tools: Bash(relay *)
disable-model-invocation: true
---
Run `relay budget` and show its output unchanged, in a code block, then one line on what relay does at that level: normal routes by plan tier; tight keeps Opus for the final review only; critical finishes the current wave, writes a handoff and starts nothing new; unknown acts as tight.
