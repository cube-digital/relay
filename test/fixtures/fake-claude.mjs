#!/usr/bin/env node
// A stand-in for `claude -p` used by the marathon tests. Reads a scenario file
// (FAKE_CLAUDE_SCENARIO) listing one step per invocation. Each step may append
// ledger lines, write a budget snapshot, and returns a claude-style JSON result.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const scenario = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_SCENARIO, 'utf8'));
const counterPath = process.env.FAKE_CLAUDE_SCENARIO + '.count';
const n = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;
writeFileSync(counterPath, String(n + 1));
const step = scenario.steps[Math.min(n, scenario.steps.length - 1)];

// record the exact argv so tests can assert on flags, and the pid so tests can
// check that a stopped marathon did not leave this process running
appendFileSync(process.env.FAKE_CLAUDE_SCENARIO + '.argv', JSON.stringify(process.argv.slice(2)) + '\n');
writeFileSync(process.env.FAKE_CLAUDE_SCENARIO + '.pid', String(process.pid));
if (step.sleepMs) await new Promise((r) => setTimeout(r, step.sleepMs));

for (const line of step.ledger ?? []) {
  mkdirSync(dirname(scenario.ledger), { recursive: true });
  appendFileSync(scenario.ledger, `- 2026-10-19 12:${String(n).padStart(2, '0')} ${line}\n`);
}
if (step.budget) {
  mkdirSync(dirname(scenario.budget), { recursive: true });
  writeFileSync(scenario.budget, JSON.stringify({ updatedAt: new Date().toISOString(), ...step.budget }));
}
process.stdout.write(JSON.stringify({ type: 'result', session_id: `s${n + 1}`, is_error: Boolean(step.is_error), result: step.result ?? '', total_cost_usd: step.cost ?? 0.5 }) + '\n');
process.exit(step.exit ?? 0);
