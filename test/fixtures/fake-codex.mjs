#!/usr/bin/env node
// Process-boundary fixture for Codex exec JSONL and read-only app-server usage.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
const file = process.env.FAKE_CODEX_SCENARIO;
const scenario = JSON.parse(readFileSync(file, 'utf8'));
const argv = process.argv.slice(2);
if (argv[0] === 'app-server') {
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') console.log(JSON.stringify({ id: msg.id, result: {} }));
    if (msg.method === 'account/rateLimits/read') {
      const limits = existsSync(file + '.budget') ? JSON.parse(readFileSync(file + '.budget', 'utf8')) : scenario.initialBudget ?? { primary: { usedPercent: 10, windowDurationMins: 10080 } };
      if (scenario.resetAfterRead && limits.primary?.usedPercent >= 95) writeFileSync(file + '.budget', JSON.stringify({ primary: { usedPercent: 10, windowDurationMins: limits.primary.windowDurationMins } }));
      console.log(JSON.stringify({ id: msg.id, result: { rateLimits: limits } }));
    }
  }
  process.exit(0);
}
appendFileSync(file + '.argv', JSON.stringify(argv) + '\n');
writeFileSync(file + '.pid', String(process.pid));
const count = existsSync(file + '.count') ? Number(readFileSync(file + '.count', 'utf8')) : 0;
writeFileSync(file + '.count', String(count + 1));
const step = scenario.steps[Math.min(count, scenario.steps.length - 1)];
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'codex-thread-1' }));
if (step.sleepMs) await new Promise(resolve => setTimeout(resolve, step.sleepMs));
for (const line of step.ledger ?? []) {
  mkdirSync(dirname(scenario.ledger), { recursive: true });
  appendFileSync(scenario.ledger, `- 2026-10-23 12:00 ${line}\n`);
}
if (step.budget) writeFileSync(file + '.budget', JSON.stringify(step.budget));
console.log(JSON.stringify(step.error ? { type: 'turn.failed', error: { message: step.error } } : { type: 'item.completed', item: { type: 'agent_message', text: step.result ?? '' } }));
if (!step.error) console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } }));
process.exit(step.exit ?? 0);
