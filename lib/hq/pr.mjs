// Open PR: push the integration branch to origin, then gh pr create against the current branch.
// Title from the plan's goal, body from the ledger. gh is RELAY_GH_BIN or gh on PATH.

import { execFileSync } from 'node:child_process';
import { git } from '../git.mjs';
import { boardFor } from '../../scripts/relay-board.mjs';
import { clearRepoCache, integrationState, planFileOf } from './repo.mjs';
import { reviewOf } from './review.mjs';
import { onPath } from './sources.mjs';

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const TITLE_MAX = 200;
const firstLine = (s) => String(s ?? '').split('\n').find((l) => l.trim())?.trim().slice(0, 200) ?? '';

export const ghBin = (env = process.env) => env.RELAY_GH_BIN || onPath('gh', env);

export function prBody({ slug, flow, review }) {
  const lines = [`Relay plan \`${slug}\` (${flow ?? 'feature'}).`, '', '## Waves'];
  lines.push(...(review.waves.length ? review.waves.map((w) => `- ${w}`) : ['- none recorded']), '', '## Tests');
  lines.push(review.tests ? `+${review.tests.added} -${review.tests.removed}` : 'not recorded', '', '## Rulings');
  lines.push(...(review.rulings.length ? review.rulings.map((r) => `- ${r}`) : ['- none']));
  if (review.deferred.length) lines.push('', '## Deferred findings', ...review.deferred.map((d) => `- ${d}`));
  return lines.join('\n');
}

function prepare(path, slug, env) {
  const abs = planFileOf(path, slug);
  const r = boardFor(abs);
  if (r.errors) throw fail(409, r.errors.join('; '));
  if (r.board.status !== 'complete') throw fail(409, `plan "${slug}" is not complete`);
  const branch = `relay/${r.board.slug}/integration`;
  const { hasInt, merged } = integrationState(path, r.board);
  if (!hasInt) throw fail(409, `${branch} does not exist`);
  if (merged) throw fail(409, `${branch} is already merged`);
  if (git(['remote', 'get-url', 'origin'], path, { allowFail: true }) === undefined) throw fail(409, 'the repository has no origin remote');
  const gh = ghBin(env);
  if (!gh) throw fail(409, 'gh is not installed');
  try {
    execFileSync(gh, ['auth', 'status'], { cwd: path, env, stdio: 'ignore', timeout: 15000 });
  } catch {
    throw fail(409, 'gh is not signed in');
  }
  const base = git(['rev-parse', '--abbrev-ref', 'HEAD'], path, { allowFail: true });
  if (!base || base === 'HEAD') throw fail(409, 'HEAD is detached; check out the base branch first');
  const title = (String(r.board.goal ?? '').split('\n')[0].trim() || slug).slice(0, TITLE_MAX);
  return { gh, branch, base, title, body: prBody({ slug, flow: r.board.flow, review: reviewOf(r.board, r.dir, { repo: path }) }) };
}

export function prPreview(path, slug, { env = process.env } = {}) {
  const { branch, base, title, body } = prepare(path, slug, env);
  return { branch, base, title, body };
}

export function openPr(path, slug, { env = process.env } = {}) {
  const { gh, branch, base, title, body } = prepare(path, slug, env);
  try {
    execFileSync('git', ['push', '-u', 'origin', branch], { cwd: path, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  } catch (err) {
    throw fail(502, `git push failed: ${firstLine(err.stderr)}`);
  }
  let out;
  try {
    out = execFileSync(gh, ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body], { cwd: path, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  } catch (err) {
    throw fail(502, `gh pr create failed: ${firstLine(err.stderr)}`);
  }
  const url = out.split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l)).pop();
  if (!url) throw fail(502, 'gh printed no pull request URL');
  clearRepoCache();
  return { ok: true, url, branch, base };
}
