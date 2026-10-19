// relay ledger <plan.md> ["line to append"] [--rulings]
// The ledger is the orchestrator's memory on disk: it survives compaction.
// Conventions: "Task T3: complete (commits a1b2c3d..d4e5f6a, review clean)",
// "Lane b: fix round 2/5 (1 addressed, 1 open: ...)", "Ruling: <what> — <why> — <cost if wrong>".

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { parsePlan } from '../lib/plan.mjs';
import { runDir } from './relay-lanes.mjs';

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['rulings'] });
  const [planPath, ...words] = args._;
  if (!planPath) {
    console.error('usage: relay ledger <plan.md> ["line"] [--rulings]');
    return 64;
  }
  const plan = parsePlan(readFileSync(planPath, 'utf8'));
  const dir = runDir(planPath, plan.slug);
  const path = join(dir, 'ledger.md');
  if (words.length) {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(path)) appendFileSync(path, `# relay ledger — plan: ${resolve(planPath)}\n`);
    appendFileSync(path, `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${words.join(' ')}\n`);
    return 0;
  }
  if (!existsSync(path)) {
    console.log('(empty ledger)');
    return 0;
  }
  const lines = readFileSync(path, 'utf8').split('\n');
  console.log((args.rulings ? lines.filter((l) => l.includes('Ruling:')) : lines).join('\n').trim());
  return 0;
}
