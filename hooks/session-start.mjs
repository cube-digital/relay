#!/usr/bin/env node
// SessionStart: inject the using-relay rules (and the budget level when known).
// Works for Claude Code (plugin hook) and Codex (project .codex/hooks.json).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBudget } from '../scripts/relay-budget.mjs';
import { parseArgs } from '../lib/args.mjs';
import { stripFrontmatter } from '../lib/frontmatter.mjs';
import { emitContext, readInput } from '../lib/hookio.mjs';
import { RELAY_ROOT } from '../lib/routing.mjs';

try {
  await readInput().catch(() => ({}));
  const rules = stripFrontmatter(readFileSync(join(RELAY_ROOT, 'skills', 'using-relay', 'SKILL.md'), 'utf8')).trim();
  let budgetLine = '';
  const args=parseArgs(process.argv.slice(2),{booleans:['codex']});
  const budget=readBudget({harness:args.harness,codex:args.codex});
  budgetLine = `\n\nRelay ${budget.harness} budget at session start: ${budget.level} (${budget.text ?? budget.reason}).`;
  emitContext('SessionStart', `<relay-rules>\n${rules}${budgetLine}\n</relay-rules>`);
} catch (err) {
  // Never block a session over the bootstrap.
  process.stderr.write(`relay session-start: ${err.message}\n`);
  process.exit(0);
}
