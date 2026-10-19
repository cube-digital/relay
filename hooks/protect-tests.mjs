#!/usr/bin/env node
// PreToolUse on edit tools and shell commands.
// Acceptance tests written from the spec (by the test-author role) are listed in
// <main checkout>/.relay/protected-tests.txt. Implementers may not edit, weaken,
// skip or delete them to get green: they report BLOCKED with evidence instead.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { relayDir, worktreeRoot } from '../lib/git.mjs';
import { matchesAny } from '../lib/glob.mjs';
import { literalPrefix, protectedMessage, shellWritesTo } from '../lib/guards.mjs';
import { allow, block, commandOf, editedPaths, readInput } from '../lib/hookio.mjs';

try {
  const input = await readInput();
  const cwd = input.cwd || process.cwd();
  const dir = relayDir(cwd);
  const listPath = dir && join(dir, 'protected-tests.txt');
  if (!listPath || !existsSync(listPath)) allow();
  const globs = readFileSync(listPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!globs.length) allow();
  const root = worktreeRoot(cwd) ?? cwd;
  const rel = (p) => relative(root, isAbsolute(p) ? p : resolve(cwd, p)).split('\\').join('/');

  for (const p of editedPaths(input.tool_input)) {
    const r = rel(p);
    if (matchesAny(r, globs)) block(protectedMessage(r));
  }

  const command = commandOf(input.tool_input);
  if (command) {
    for (const g of globs) {
      const literal = literalPrefix(g);
      if (literal.length > 3 && shellWritesTo(command, literal)) block(protectedMessage(g));
    }
  }
  allow();
} catch (err) {
  process.stderr.write(`relay protect-tests: ${err.message}\n`);
  process.exit(0);
}
