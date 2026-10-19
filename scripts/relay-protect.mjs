// relay protect <add|remove|list> [paths...]
// Maintains <main checkout>/.relay/protected-tests.txt, which the protect-tests
// hook enforces in every worktree of the repository.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureExcluded, mainRoot } from '../lib/git.mjs';

export function main([cmd, ...paths]) {
  const root = mainRoot(process.cwd());
  if (!root) {
    console.error('✗ run inside a git repository');
    return 1;
  }
  const file = join(root, '.relay', 'protected-tests.txt');
  const current = existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : [];
  if (cmd === 'list' || !cmd) {
    console.log(current.length ? current.join('\n') : '(no protected tests)');
    return 0;
  }
  if (!['add', 'remove'].includes(cmd) || !paths.length) {
    console.error('usage: relay protect <add|remove|list> [repo-relative paths or globs...]');
    return 64;
  }
  const norm = paths.map((p) => p.replace(/^\.\//, ''));
  const next = cmd === 'add' ? [...new Set([...current, ...norm])] : current.filter((p) => !norm.includes(p));
  mkdirSync(join(root, '.relay'), { recursive: true });
  ensureExcluded(root, ['.relay/']);
  writeFileSync(file, '# acceptance tests implementers may not change (relay protect-tests hook)\n' + next.join('\n') + '\n');
  console.log(`${next.length} protected path(s)`);
  return 0;
}
