// relay budget [--json] [--codex] [--exit-code]
// Claude Code: reads ~/.relay/budget.json, which relay's mod writes from the
// session's own rate-limit readings. Codex (--codex, experimental): reads the
// newest rollout file under ~/.codex/sessions; the format is unofficial.
// --exit-code: 0 normal, 10 tight, 20 critical, 30 unknown/stale.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { describeWindows, isStale, levelFor, parseCodexRateLimits, readSnapshot } from '../lib/budget.mjs';
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

export function readBudget({ codex = false } = {}) {
  const routing = loadRouting();
  let snap;
  if (codex) {
    const file = newestRollout(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'));
    snap = file ? { source: 'codex-rollout (unofficial)', ...parseCodexRateLimits(readFileSync(file, 'utf8')) } : undefined;
  } else {
    snap = readSnapshot();
  }
  if (!snap || isStale(snap, routing.budget.staleAfterMinutes)) {
    return { level: 'unknown', reason: snap ? 'stale reading' : 'no reading yet', snapshot: snap };
  }
  return { level: levelFor(snap, routing.budget), snapshot: snap, text: describeWindows(snap) };
}

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['json', 'codex', 'exit-code'] });
  const res = readBudget({ codex: Boolean(args.codex) });
  if (args.json) console.log(JSON.stringify(res, null, 2));
  else if (res.level === 'unknown') console.log(`budget: unknown (${res.reason}) — act as "tight" until a reading arrives`);
  else console.log(`budget: ${res.level} — ${res.text} [${res.snapshot.source}]`);
  return args['exit-code'] ? CODES[res.level] : 0;
}
