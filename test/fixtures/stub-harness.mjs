#!/usr/bin/env node
// A stand-in for `claude -p` / `codex exec` in the relay HQ launch tests. Prints a
// claude-style JSON result. STUB_SLEEP_MS waits first, STUB_PID_FILE records the
// pid, STUB_EXIT sets the exit code. The final message ends with a RELAY_LEG line;
// STUB_CODEX=1 prints it as a codex-style item.completed event instead.

import { writeFileSync } from 'node:fs';

if (process.env.STUB_PID_FILE) writeFileSync(process.env.STUB_PID_FILE, String(process.pid));
const ms = Number(process.env.STUB_SLEEP_MS ?? 0);
if (ms) await new Promise((r) => setTimeout(r, ms));
const final = 'all done\nRELAY_LEG: DONE — x';
if (process.env.STUB_CODEX) process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: final.replace('DONE — x', 'PAUSED — y') } }) + '\n');
else process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: final, total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } }) + '\n');
process.exit(Number(process.env.STUB_EXIT ?? 0));
