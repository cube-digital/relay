// relay budget [--harness claude|codex] [--codex] [--json] [--exit-code]
// Codex refreshes account limits through bounded official stdio JSON-RPC, then
// falls back to its own cache/rollout. Claude retains the mod's existing cache.
// --exit-code: 0 normal, 10 tight, 20 critical, 30 unknown/stale.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { describeWindows, isStale, levelFor, parseCodexSnapshot, readSnapshot, snapshotPath, writeSnapshot } from '../lib/budget.mjs';
import { resolveHarness } from '../lib/harness.mjs';
import { readCodexLimits } from '../lib/codex-rpc.mjs';
import { loadRouting } from '../lib/routing.mjs';

const CODES = { normal: 0, tight: 10, critical: 20, unknown: 30 };

function newestRollout(dir) {
  let best;
  const walk = (d, depth) => {
    if (depth > 5 || !existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p, depth + 1);
      else if (/^rollout-.*\.jsonl$/.test(name) && (!best || s.mtimeMs > best.mtimeMs)) best = { path: p, mtimeMs: s.mtimeMs };
    }
  };
  walk(dir, 0);
  return best?.path;
}

export function readBudget(options = {}) {
  const harness = resolveHarness(options);
  const routing = loadRouting();
  let snap = readSnapshot(snapshotPath(harness));
  if (harness === 'codex') {
    // Account cache wins when fresh; rollout fallback is best-effort and never Claude's cache.
    if (!snap || isStale(snap, routing.budget.staleAfterMinutes)) {
      try {
        const file = newestRollout(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'));
        const rollout = file ? parseCodexSnapshot(readFileSync(file, 'utf8')) : undefined;
        if (rollout && (!snap || Date.parse(rollout.updatedAt) > Date.parse(snap.updatedAt))) snap = rollout;
      } catch {}
    }
  }
  if (!snap || isStale(snap, routing.budget.staleAfterMinutes)) {
    return { harness, level: 'unknown', reason: snap ? 'stale reading' : 'no reading yet', snapshot: snap };
  }
  return { harness, level: levelFor(snap, routing.budget), snapshot: snap, text: describeWindows(snap) };
}

export async function refreshBudget(options = {}) {
  const harness = resolveHarness(options);
  let refreshError;
  if (harness === 'codex') {
    try {
      const snapshot = await readCodexLimits(options);
      const path = snapshotPath(harness);
      const existing = readSnapshot(path);
      if (!existing || Date.parse(snapshot.updatedAt) >= Date.parse(existing.updatedAt) || !Number.isFinite(Date.parse(existing.updatedAt))) writeSnapshot(snapshot, path);
    } catch (err) { refreshError = err.message; }
  }
  const result = readBudget({ ...options, harness });
  return refreshError ? { ...result, refreshError } : result;
}

export async function main(argv) {
  const args = parseArgs(argv, { booleans: ['json', 'codex', 'exit-code'] });
  const res = await refreshBudget({ harness: args.harness, codex: Boolean(args.codex), codexBin: args['codex-bin'] });
  if (args.json) console.log(JSON.stringify(res, null, 2));
  else if (res.level === 'unknown') console.log(`budget: unknown (${res.reason}) — act as "tight" until a reading arrives`);
  else console.log(`budget: ${res.level} — ${res.text} [${res.snapshot.source}]`);
  return args['exit-code'] ? CODES[res.level] : 0;
}
