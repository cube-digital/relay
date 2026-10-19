#!/usr/bin/env node
// SessionStart: inject the using-relay rules (and the budget level when known).
// Works for Claude Code (plugin hook) and Codex (project .codex/hooks.json).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeWindows, isStale, levelFor, readSnapshot } from '../lib/budget.mjs';
import { stripFrontmatter } from '../lib/frontmatter.mjs';
import { emitContext, readInput } from '../lib/hookio.mjs';
import { loadRouting, RELAY_ROOT } from '../lib/routing.mjs';

try {
  await readInput().catch(() => ({}));
  const rules = stripFrontmatter(readFileSync(join(RELAY_ROOT, 'skills', 'using-relay', 'SKILL.md'), 'utf8')).trim();
  let budgetLine = '';
  const routing = loadRouting();
  const snap = readSnapshot();
  if (snap && !isStale(snap, routing.budget.staleAfterMinutes)) {
    budgetLine = `\n\nRelay budget at session start: ${levelFor(snap, routing.budget)} (${describeWindows(snap)}).`;
  }
  emitContext('SessionStart', `<relay-rules>\n${rules}${budgetLine}\n</relay-rules>`);
} catch (err) {
  // Never block a session over the bootstrap.
  process.stderr.write(`relay session-start: ${err.message}\n`);
  process.exit(0);
}
