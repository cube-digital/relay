// relay ledger <plan.md> ["line to append"] [--rulings]
// The ledger is the orchestrator's memory on disk: it survives compaction.
// Conventions: "Task T3: complete (commits a1b2c3d..d4e5f6a, review clean)",
// "Lane b: fix round 2/5 (1 addressed, 1 open: ...)", "Ruling: <what> — <why> — <cost if wrong>",
// "wave 2: merged @ 1a2b3c4, suite pass".
// Every line is stamped with the time and, when a fresh reading exists, the usage
// windows: "[5h 23.4% resets 16:30 · 7d 41%]" (UTC). relay calibrate turns those stamps into forecasts.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { isStale, readSnapshot, snapshotPath } from '../lib/budget.mjs';
import { resolveHarness } from '../lib/harness.mjs';
import { formatStamp } from '../codex-math/lib/calibration.mjs';
import { parsePlan } from '../lib/plan.mjs';
import { refreshBoard } from './relay-board.mjs';
import { runDir } from './relay-lanes.mjs';
import { refreshBudget } from './relay-budget.mjs';

// A stamp is a measurement: only a reading from the last few minutes is written.
export const STAMP_FRESH_MINUTES = 20;

export function ledgerPath(planPath) {
  const plan = parsePlan(readFileSync(planPath, 'utf8'));
  return join(runDir(planPath, plan.slug), 'ledger.md');
}

export function usageStamp(snapshot, staleAfterMinutes, now = Date.now()) {
  if (!snapshot || isStale(snapshot, staleAfterMinutes, now)) return '';
  if (snapshot.windows) return formatStamp(snapshot);
  const parts = [];
  if (snapshot.fiveHour) {
    // the reset time (UTC, like the line's own time) lets calibration drop waves that cross it
    const reset = Date.parse(snapshot.fiveHour.resetsAt ?? '');
    const hhmm = Number.isFinite(reset) ? ` resets ${new Date(reset).toISOString().slice(11, 16)}` : '';
    parts.push(`5h ${snapshot.fiveHour.percentUsed}%${hhmm}`);
  }
  if (snapshot.sevenDay) parts.push(`7d ${snapshot.sevenDay.percentUsed}%`);
  return parts.length ? ` [${parts.join(' · ')}]` : '';
}

export function formatLine(text, { now = new Date(), snapshot, staleAfterMinutes = STAMP_FRESH_MINUTES } = {}) {
  const when = now.toISOString().slice(0, 16).replace('T', ' ');
  return `- ${when}${usageStamp(snapshot, staleAfterMinutes, now.getTime())} ${text}\n`;
}

export function appendLedger(planPath, text, options = {}) {
  const plan = parsePlan(readFileSync(planPath, 'utf8'));
  const dir = runDir(planPath, plan.slug);
  const path = join(dir, 'ledger.md');
  mkdirSync(dir, { recursive: true });
  if (!existsSync(path)) appendFileSync(path, `# relay ledger — plan: ${resolve(planPath)}\n`);
  const snapshot = Object.hasOwn(options, 'snapshot')
    ? options.snapshot
    : readSnapshot(snapshotPath(resolveHarness(options)));
  const line = formatLine(text, { snapshot });
  appendFileSync(path, line);
  refreshBoard(planPath, { harness: resolveHarness(options) });
  return line;
}

export async function main(argv) {
  const args = parseArgs(argv, { booleans: ['rulings', 'codex'] });
  const [planPath, ...words] = args._;
  if (!planPath) {
    console.error('usage: relay ledger <plan.md> ["line"] [--rulings]');
    return 64;
  }
  if (words.length) {
    const harness = resolveHarness({ harness: args.harness, codex: args.codex });
    const options = { harness };
    if (harness === 'codex') {
      const budget = await refreshBudget({ harness, codexBin: args['codex-bin'] });
      // A failed refresh must not re-stamp the pre-wave reading as a fresh
      // end-of-wave measurement. The ledger entry itself still succeeds.
      options.snapshot = budget.refreshError ? null : budget.snapshot;
      if (budget.refreshError) console.error(`relay ledger: usage stamp omitted (${budget.refreshError})`);
    }
    appendLedger(planPath, words.join(' '), options);
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
