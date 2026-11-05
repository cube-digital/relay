---
description: Open relay HQ, the command centre for all your projects (what is waiting on you, runs, plans down to the task, launches, the Brain), in your browser.
argument-hint: "[--port N]"
allowed-tools: Bash(node *scripts/relay.mjs hq*)
disable-model-invocation: true
---
Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/relay.mjs" hq $ARGUMENTS`. Show its output unchanged, in a code block. Then write one line: HQ is open in the browser, it reads files on disk so looking costs no tokens, and `relay hq stop` ends it. Do nothing else.
