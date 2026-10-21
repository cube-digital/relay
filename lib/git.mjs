import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export function git(args, cwd, { allowFail = false, maxBuffer = 64 * 1024 * 1024 } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  } catch (err) {
    if (allowFail) return undefined;
    const stderr = err.stderr?.toString().trim();
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

export function worktreeRoot(cwd) {
  return git(['rev-parse', '--show-toplevel'], cwd, { allowFail: true });
}

// Git reports canonical paths (/private/var/... on macOS); a path that reaches us
// through a symlink (/var/...) only compares equal to them once resolved.
export function realPath(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// p relative to the checkout at root, however p reaches it. Only the part above the
// checkout is resolved, so symlinks inside it keep the names the globs are written in.
export function repoPath(root, p) {
  const real = realPath(root);
  for (let a = p; ; a = dirname(a)) {
    if (realPath(a) === real) return relative(a, p);
    if (dirname(a) === a) return relative(root, p);
  }
}

// The main checkout, also when cwd is inside a linked worktree.
export function mainRoot(cwd) {
  const common = git(['rev-parse', '--git-common-dir'], cwd, { allowFail: true });
  if (!common) return undefined;
  const abs = isAbsolute(common) ? common : resolve(cwd, common);
  return dirname(abs);
}

export function relayDir(cwd) {
  const root = mainRoot(cwd);
  return root ? join(root, '.relay') : undefined;
}

// Keep relay's scratch out of `git status` without touching the user's .gitignore.
export function ensureExcluded(root, patterns) {
  const common = git(['rev-parse', '--git-common-dir'], root);
  const infoDir = join(isAbsolute(common) ? common : resolve(root, common), 'info');
  const exclude = join(infoDir, 'exclude');
  mkdirSync(infoDir, { recursive: true });
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  const missing = patterns.filter((p) => !current.split('\n').includes(p));
  if (missing.length) appendFileSync(exclude, (current && !current.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
}
