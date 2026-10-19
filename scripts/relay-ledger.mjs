// relay ledger <plan.md> ["line to append"] [--rulings]
// The ledger is the orchestrator's memory on disk: it survives compaction.
// Conventions: "Task T3: complete (commits a1b2c3d..d4e5f6a, review clean)",
// "Lane b: fix round 2/5 (1 addressed, 1 open: ...)", "Ruling: <what> — <why> — <cost if wrong>",
// "wave 2: merged @ 1a2b3c4, suite pass".
// Every line is stamped with the time and, when a fresh reading exists, the usage
// windows: "[5h 23.4% · 7d 41%]". relay calibrate turns those stamps into forecasts.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { isStale, readSnapshot } from '../lib/budget.mjs';
import { parsePlan } from '../lib/plan.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { runDir } from './relay-lanes.mjs';

export function ledgerPath(planPath) {
  const plan = parsePlan(readFileSync(planPath, 'utf8'));
  return join(runDir(planPath, plan.slug), 'ledger.md');
}

export function usageStamp(snapshot, staleAfterMinutes, now = Date.now()) {
  if (!snapshot || isStale(snapshot, staleAfterMinutes, now)) return '';
  const parts = [];
  if (snapshot.fiveHour) parts.push(`5h ${snapshot.fiveHour.percentUsed}%`);
  if (snapshot.sevenDay) parts.push(`7d ${snapshot.sevenDay.percentUsed}%`);
  return parts.length ? ` [${parts.join(' · ')}]` : '';
}

export function formatLine(text, { now = new Date(), snapshot, staleAfterMinutes = 360 } = {}) {
  const when = now.toISOString().slice(0, 16).replace('T', ' ');
  return `- ${when}${usageStamp(snapshot, staleAfterMinutes, now.getTime())} ${text}\n`;
}

export function appendLedger(planPath, text) {
  const plan = parsePlan(readFileSync(planPath, 'utf8'));
  const dir = runDir(planPath, plan.slug);
  const path = join(dir, 'ledger.md');
  mkdirSync(dir, { recursive: true });
  if (!existsSync(path)) appendFileSync(path, `# relay ledger — plan: ${resolve(planPath)}\n`);
  const line = formatLine(text, { snapshot: readSnapshot(), staleAfterMinutes: loadRouting().budget.staleAfterMinutes });
  appendFileSync(path, line);
  return line;
}

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['rulings'] });
  const [planPath, ...words] = args._;
  if (!planPath) {
    console.error('usage: relay ledger <plan.md> ["line"] [--rulings]');
    return 64;
  }
  if (words.length) {
    appendLedger(planPath, words.join(' '));
    return 0;
  }
  const path = ledgerPath(planPath);
  if (!existsSync(path)) {
    console.log('(empty ledger)');
    return 0;
  }
  const lines = readFileSync(path, 'utf8').split('\n');
  console.log((args.rulings ? lines.filter((l) => l.includes('Ruling:')) : lines).join('\n').trim());
  return 0;
}
