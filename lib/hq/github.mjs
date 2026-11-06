// GitHub signals for HQ: open PRs with CI and review state, branch CI and review
// requests, read through the gh CLI and cached 120 s per repository.

import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const TTL_MS = 120_000;
const BAD_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const BAD_STATES = new Set(['FAILURE', 'ERROR']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED']);
const cache = new Map();

export function ciState(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  if (rollup.some((i) => BAD_CONCLUSIONS.has(i?.conclusion) || BAD_STATES.has(i?.state))) return 'fail';
  if (rollup.some((i) => (i?.__typename === 'CheckRun' && i.status !== 'COMPLETED') || PENDING_STATES.has(i?.state))) return 'pending';
  return 'pass';
}

const exec = (file, args, cwd) => run(file, args, { cwd, timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
const ghJson = async (args, cwd) => JSON.parse((await exec('gh', args, cwd)).stdout || 'null');

function reasonFor(err) {
  if (err?.code === 'ENOENT') return 'gh is not installed';
  const stderr = String(err?.stderr ?? '');
  if (/auth login|not logged in|authenticat/i.test(stderr)) return 'gh is not authenticated';
  if (/no git remotes|none of the git remotes|not a git repository|could not determine/i.test(stderr)) return 'no GitHub remote';
  const first = stderr.split('\n').find((l) => l.trim()) ?? '';
  return `gh failed: ${first}`.slice(0, 200);
}

async function fetchGithub(path, rid) {
  const fetchedAt = new Date().toISOString();
  const repoName = basename(path);
  try {
    const branch = (await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], path)).stdout.trim();
    const list = await ghJson(['pr', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title,url,headRefName,isDraft,reviewDecision,statusCheckRollup,author'], path);
    const asked = await ghJson(['pr', 'list', '--state', 'open', '--limit', '20', '--search', 'review-requested:@me', '--json', 'number,title,url,author'], path);
    const prs = (list ?? []).map((p) => ({
      number: p.number, title: p.title, url: p.url, branch: p.headRefName, draft: p.isDraft,
      review: p.reviewDecision || null, ci: ciState(p.statusCheckRollup), author: p.author?.login ?? null,
    }));
    const reviewRequests = (asked ?? []).map((p) => ({ number: p.number, title: p.title, url: p.url, author: p.author?.login ?? null }));
    let branchCi = prs.find((p) => p.branch === branch)?.ci;
    if (!branchCi) {
      branchCi = 'none';
      try {
        const runs = await ghJson(['run', 'list', '--branch', branch, '--limit', '1', '--json', 'status,conclusion'], path);
        const last = Array.isArray(runs) ? runs[0] : undefined;
        if (last) {
          if (last.status !== 'completed') branchCi = 'pending';
          else if (last.conclusion === 'success') branchCi = 'pass';
          else if (last.conclusion === 'skipped' || last.conclusion === 'neutral') branchCi = 'none';
          else branchCi = 'fail';
        }
      } catch { /* branch CI is best effort once PRs were readable */ }
    }
    const attention = [];
    if (branchCi === 'fail') attention.push({ id: `${rid}:ci-red:branch`, kind: 'ci-red', rid, repoName, plan: null, lane: null, text: `CI is red on ${branch}`, at: fetchedAt, href: null });
    for (const p of prs) if (p.ci === 'fail') attention.push({ id: `${rid}:ci-red:pr${p.number}`, kind: 'ci-red', rid, repoName, plan: null, lane: null, text: `CI is red on PR #${p.number}: ${p.title}`, at: fetchedAt, href: p.url });
    for (const p of reviewRequests) attention.push({ id: `${rid}:review-requested:pr${p.number}`, kind: 'review-requested', rid, repoName, plan: null, lane: null, text: `PR #${p.number} asks for your review: ${p.title}`, at: fetchedAt, href: p.url });
    return { connected: true, reason: null, fetchedAt, branch, branchCi, prs, reviewRequests, attention };
  } catch (err) {
    return { connected: false, reason: reasonFor(err), fetchedAt, attention: [] };
  }
}

export function githubFor(path, { rid } = {}) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchGithub(path, rid);
  cache.set(path, { at: Date.now(), promise });
  return promise;
}
