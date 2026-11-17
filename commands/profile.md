---
description: Use when showing how Relay routes this session's model: the model and effort of each role, the extra fix round, and the text Relay adds for the model.
argument-hint: "[--model <id>]"
allowed-tools: Bash(node *scripts/relay.mjs profile*)
disable-model-invocation: true
---
Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/relay.mjs" profile $ARGUMENTS`. Show its output unchanged, in a code block. Then add one line: on route `fable-lead`, the architect and the sixth fix round run on Fable and the other roles keep their tiers; on route `default`, Relay routes by plan tier. Do not change the model or the effort of this session yourself: a change mid-session reads the whole conversation again without the cache.
