import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export function git(args, cwd, { allowFail = false, maxBuffer = 64 * 1024 * 1024 } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  } catch (err) {
    if (allowFail) return undefined;
    const stderr = err.stderr?.toString().trim();
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

// Resolve aliases even for a destination whose last components do not exist yet.
export function canonicalPath(path) {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch (err) {
    if (!['ENOENT', 'ENOTDIR'].includes(err.code)) throw err;
    const parent = dirname(absolute);
    if (parent === absolute) throw err;
    return join(canonicalPath(parent), basename(absolute));
  }
}

export function worktreeRoot(cwd) {
  const root = git(['rev-parse', '--show-toplevel'], cwd, { allowFail: true });
  return root ? canonicalPath(root) : undefined;
}

// The main checkout, also when cwd is inside a linked worktree.
export function mainRoot(cwd) {
  const common = git(['rev-parse', '--git-common-dir'], cwd, { allowFail: true });
  if (!common) return undefined;
  const abs = isAbsolute(common) ? common : resolve(cwd, common);
  return dirname(canonicalPath(abs));
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
