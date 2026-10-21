// The pr-hygiene check: stale and approved PRs, leftovers of finished plans, old merged branches.
// Read-only: it runs git and gh to look, and prints commands for the user instead of running them.

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { git, realPath } from '../git.mjs';

const run = promisify(execFile);
const day = 86_400_000;
// every name and path in a pasteable command goes in single quotes
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const LEDGER_LINE = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: \[[^\]]*\])? (.*)$/;
const HEADER = /^# relay ledger — plan: (.+)$/m;
const PROTECTED = new Set(['main', 'master', 'develop', 'trunk']);

export async function check({ repos, options = {}, now }) {
  const staleDays = options.staleDays ?? 3;
  const branchAgeDays = options.branchAgeDays ?? 14;
  const t = now instanceof Date ? now.getTime() : Number(now ?? Date.now());
  const findings = [];
  const notes = [];
  let ghDown = null;

  for (const r of repos) {
    const rid = r.rid;
    const repoName = r.name;
    const add = (kind, key, text, { href = null, command = null } = {}) =>
      findings.push({ id: `${rid}:${kind}:${key}`, kind, repo: r.path, repoName, text, href, command });
    if (!existsSync(r.path)) {
      notes.push(`${repoName}: missing on disk`);
      continue;
    }
    try {
      if (!ghDown) await prRows(r, { staleDays, t, add, notes, setDown: (m) => { ghDown = m; } });
      finishedPlans(r, add);
      oldBranches(r, { branchAgeDays, t, add });
    } catch (err) {
      notes.push(`${repoName}: ${err.message}`);
    }
  }

  if (ghDown) {
    findings.push({
      id: 'gh:gh-not-connected:gh', kind: 'gh-not-connected', repo: null, repoName: 'gh', text: ghDown, href: null,
      command: ghDown === 'gh is not installed' ? null : 'gh auth login',
    });
  }
  return { findings, notes };
}

async function gh(args, cwd) {
  const { stdout } = await run('gh', args, { cwd, timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout || '[]');
}

async function prRows(r, { staleDays, t, add, notes, setDown }) {
  const days = (ms) => Math.floor(ms / day);
  try {
    const prs = await gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,url,isDraft,reviewDecision,createdAt,updatedAt,latestReviews'], r.path);
    for (const pr of prs) {
      if (!pr.isDraft && pr.reviewDecision !== 'APPROVED' && t - Date.parse(pr.createdAt) > staleDays * day) {
        add('pr-stale', pr.number, `PR #${pr.number} waits ${days(t - Date.parse(pr.createdAt))}d for review: ${pr.title}`, { href: pr.url });
      }
      if (pr.reviewDecision === 'APPROVED') {
        const times = (pr.latestReviews ?? []).filter((x) => x.state === 'APPROVED').map((x) => Date.parse(x.submittedAt)).filter(Number.isFinite);
        const approvedAt = times.length ? Math.max(...times) : Date.parse(pr.updatedAt);
        if (t - approvedAt > staleDays * day) {
          add('pr-approved-unmerged', pr.number, `PR #${pr.number} approved ${days(t - approvedAt)}d ago, not merged: ${pr.title}`, { href: pr.url });
        }
      }
    }
    const asked = await gh(['pr', 'list', '--state', 'open', '--limit', '50', '--search', 'review-requested:@me', '--json', 'number,title,url'], r.path);
    for (const pr of asked) add('review-requested', pr.number, `PR #${pr.number} asks for your review: ${pr.title}`, { href: pr.url });
  } catch (err) {
    const stderr = String(err.stderr ?? '');
    if (err.code === 'ENOENT') setDown('gh is not installed');
    else if (/auth login|not logged in|authenticat/i.test(stderr)) setDown('gh is not signed in');
    else if (err.killed || err.signal === 'SIGTERM') notes.push(`${r.name}: gh timed out`);
    else if (/no git remotes|none of the git remotes|could not determine/i.test(stderr)) notes.push(`${r.name}: no GitHub remote`);
    else notes.push(`${r.name}: gh failed: ${(stderr.split('\n')[0] || err.message || '').slice(0, 120)}`);
  }
}

function finishedPlans(r, add) {
  const runs = join(r.path, '.relay', 'runs');
  if (!existsSync(runs)) return;
  for (const slug of readdirSync(runs)) {
    let text;
    try {
      text = readFileSync(join(runs, slug, 'ledger.md'), 'utf8');
    } catch {
      continue;
    }
    const done = text.split('\n').some((l) => /^plan: complete\b/.test(l.match(LEDGER_LINE)?.[3] ?? ''));
    if (!done) continue;
    const integration = `relay/${slug}/integration`;
    if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${integration}`], r.path, { allowFail: true }) !== undefined
      && git(['merge-base', '--is-ancestor', integration, 'HEAD'], r.path, { allowFail: true }) !== undefined) {
      const branches = (git(['for-each-ref', '--format=%(refname:short)', `refs/heads/relay/${slug}/`], r.path, { allowFail: true }) ?? '').split('\n').filter(Boolean);
      if (branches.length) {
        add('relay-branches', slug, `${branches.length} branches of finished plan ${slug}`, { command: `git -C ${shq(r.path)} branch -D ${branches.map(shq).join(' ')}` });
      }
    }
    const wts = [];
    let cur = null;
    for (const line of (git(['worktree', 'list', '--porcelain'], r.path, { allowFail: true }) ?? '').split('\n')) {
      if (line.startsWith('worktree ')) cur = line.slice(9);
      else if (cur && line.startsWith(`branch refs/heads/relay/${slug}/lane-`)) wts.push(cur);
    }
    if (wts.length) {
      const planPath = text.match(HEADER)?.[1]?.trim();
      const base = `${realPath(join(r.path, '.claude', 'worktrees'))}/relay-${slug}-`;
      const clean = planPath && existsSync(planPath) && wts.every((w) => realPath(w).startsWith(base));
      const command = clean
        ? `relay worktrees clean ${shq(planPath)} # plan ${slug}`
        : wts.map((w) => `git -C ${shq(r.path)} worktree remove ${shq(w)}`).join(' && ');
      add('relay-worktrees', slug, `${wts.length} lane worktrees of finished plan ${slug}`, { command });
    }
  }
}

function oldBranches(r, { branchAgeDays, t, add }) {
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD'], r.path, { allowFail: true });
  const origin = (git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], r.path, { allowFail: true }) ?? '').replace(/^origin\//, '');
  const out = git(['for-each-ref', '--merged', 'HEAD', '--format=%(refname:short)%09%(committerdate:unix)', 'refs/heads/'], r.path, { allowFail: true }) ?? '';
  for (const line of out.split('\n').filter(Boolean)) {
    const [branch, unix] = line.split('\t');
    if (branch === current || branch.startsWith('relay/') || PROTECTED.has(branch) || branch === origin) continue;
    const age = t - Number(unix) * 1000;
    if (age > branchAgeDays * day) {
      add('branch-merged-old', branch, `${branch} is merged and ${Math.floor(age / day)}d old`, { command: `git -C ${shq(r.path)} branch -d ${shq(branch)}` });
    }
  }
}
