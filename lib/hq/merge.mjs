// Merge locally: the integration branch goes into the current branch with a merge commit.
// Nothing is pushed. On a conflict the merge is aborted, so the repository is left as it was.

import { git } from '../git.mjs';
import { boardFor } from '../../scripts/relay-board.mjs';
import { appendLedger } from '../../scripts/relay-ledger.mjs';
import { clearRepoCache, integrationState, planFileOf } from './repo.mjs';

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const MAX_COMMITS = 200;

function mergeable(path, slug) {
  const abs = planFileOf(path, slug);
  const r = boardFor(abs);
  if (r.errors) throw fail(409, r.errors.join('; '));
  if (r.board.status !== 'complete') throw fail(409, `plan "${slug}" is not complete`);
  const branch = `relay/${r.board.slug}/integration`;
  const { hasInt, merged } = integrationState(path, r.board);
  if (!hasInt) throw fail(409, `${branch} does not exist`);
  if (merged) throw fail(409, `${branch} is already merged`);
  const into = git(['rev-parse', '--abbrev-ref', 'HEAD'], path, { allowFail: true });
  if (!into || into === 'HEAD') throw fail(409, 'HEAD is detached; check out a branch first');
  return { abs, branch, into };
}

const isDirty = (path) => (git(['status', '--porcelain', '--untracked-files=no'], path) ?? '').trim().length > 0;

export function mergePreview(path, slug) {
  const { branch, into } = mergeable(path, slug);
  const log = git(['log', '--oneline', '-n', String(MAX_COMMITS), `${into}..${branch}`], path) ?? '';
  return { branch, into, commits: log.split('\n').filter(Boolean), dirty: isDirty(path) };
}

export function mergeLocally(path, slug) {
  const { abs, branch, into } = mergeable(path, slug);
  if (isDirty(path)) throw fail(409, 'the working tree has uncommitted changes');
  if (git(['merge', '--no-ff', '--no-edit', branch], path, { allowFail: true }) === undefined) {
    const conflicts = (git(['diff', '--name-only', '--diff-filter=U'], path, { allowFail: true }) ?? '').split('\n').filter(Boolean);
    if (git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], path, { allowFail: true }) !== undefined) git(['merge', '--abort'], path, { allowFail: true });
    clearRepoCache();
    throw fail(409, conflicts.length ? 'the merge has conflicts; nothing changed' : 'git merge failed; nothing changed', { conflicts });
  }
  const sha = git(['rev-parse', '--short', 'HEAD'], path);
  appendLedger(abs, `plan: merged (merged locally in HQ into ${into} @ ${sha})`);
  clearRepoCache();
  return { ok: true, branch, into, sha };
}
