// HQ repository summary: git state, plans with their board lights, and what needs
// attention. Read-only: it never writes board.json, the ledger or any run file.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { git, mainRoot } from '../git.mjs';
import { parsePlan } from '../plan.mjs';
import { loadTeam } from '../team.mjs';
import { RELAY_ROOT } from '../routing.mjs';
import { boardFor } from '../../scripts/relay-board.mjs';
import { appendLedger } from '../../scripts/relay-ledger.mjs';

const TTL_MS = 5000;
const cache = new Map(); // path → { key, at, value }

export function ridOf(path) {
  return createHash('sha1').update(path).digest('hex').slice(0, 10);
}

export function clearRepoCache() {
  cache.clear();
}

const mtime = (p) => {
  try {
    return String(statSync(p).mtimeMs);
  } catch {
    return '-';
  }
};

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
};

const planFiles = (path) => {
  const dir = join(path, 'docs', 'relay', 'plans');
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => join(dir, f));
  } catch {
    return [];
  }
};

const ledgerFiles = (path) => {
  const dir = join(path, '.relay', 'runs');
  try {
    return readdirSync(dir).map((d) => join(dir, d, 'ledger.md'));
  } catch {
    return [];
  }
};

function cacheKey(path) {
  const parts = [git(['rev-parse', 'HEAD'], path, { allowFail: true }) ?? '-', mtime(join(path, 'docs', 'relay', 'plans'))];
  for (const f of [...planFiles(path), join(path, '.relay', 'board.json'), join(path, '.relay', 'lanes', 'active.json'), ...ledgerFiles(path)]) parts.push(mtime(f));
  return parts.join('|');
}

function gitState(path) {
  const out = (args) => git(args, path, { allowFail: true });
  const status = out(['status', '--porcelain']);
  const upstream = out(['rev-parse', '--abbrev-ref', '@{upstream}']) || null;
  let ahead = null;
  let behind = null;
  if (upstream) {
    const counts = out(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
    const m = counts && /^(\d+)\s+(\d+)$/.exec(counts.trim());
    if (m) [behind, ahead] = [Number(m[1]), Number(m[2])];
  }
  return {
    branch: out(['rev-parse', '--abbrev-ref', 'HEAD']) ?? null,
    head: out(['rev-parse', 'HEAD']) ?? null,
    dirty: status === undefined ? null : status.split('\n').filter(Boolean).length,
    ahead,
    behind,
    upstream,
  };
}

function worktreesOf(path, root) {
  const out = git(['worktree', 'list', '--porcelain'], path, { allowFail: true });
  if (!out) return [];
  const list = [];
  for (const block of out.split(/\n\n+/)) {
    const wt = /^worktree (.+)$/m.exec(block)?.[1];
    if (!wt || wt === root || wt === path || !existsSync(wt)) continue;
    const branch = /^branch (.+)$/m.exec(block)?.[1]?.replace(/^refs\/heads\//, '') ?? null;
    if (!/^relay\/[^/]+\/lane-/.test(branch ?? '')) continue; // only relay lane worktrees
    list.push({ path: wt, branch });
  }
  return list;
}

function codexSetupOf(path) {
  try {
    return readdirSync(join(path, '.codex', 'agents')).some((f) => /^relay-.*\.toml$/.test(f));
  } catch {
    return false;
  }
}

// "- 2026-10-21 14:05 ..." → ISO of the last entry (ledger times are UTC)
function lastLedgerAt(ledgerPath) {
  if (!existsSync(ledgerPath)) return null;
  const lines = readFileSync(ledgerPath, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^- (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(lines[i]);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))).toISOString();
  }
  return null;
}

function failedWaves(ledgerPath) {
  const merged = new Map();
  if (!existsSync(ledgerPath)) return merged;
  for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
    const m = /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: \[[^\]]*\])? wave (\d+): merged\b(.*)$/.exec(line);
    if (m) merged.set(Number(m[1]), /suite fail/i.test(m[2]));
  }
  return merged;
}

function attentionFor({ rid, repoName, slug, board, dir, integrationMerged, hasInt, branch }) {
  const items = [];
  const at = lastLedgerAt(join(dir, 'ledger.md'));
  const add = (kind, text, extra = '', task) =>
    items.push({ id: `${rid}:${kind}:${slug}:${extra}`, kind, rid, repoName, plan: slug, lane: kind === 'lane-blocked' ? extra : null, text, at, href: `#/repos/${rid}/plans/${slug}${task ? `/tasks/${task}` : ''}` });
  const failed = failedWaves(join(dir, 'ledger.md'));
  for (const w of board.waves) {
    if (failed.get(w.wave)) {
      add('suite-failed', `wave ${w.wave}: the suite failed`, String(w.wave));
      continue;
    }
    for (const l of w.lanes) if (l.state === 'blocked') add('lane-blocked', `lane ${l.id} blocked: ${l.note}`, l.id, l.tasks[0]?.id);
  }
  const m = board.marathon;
  if (m?.endedAt && String(m.stopReason ?? '').startsWith('blocked')) add('marathon-blocked', `marathon ended BLOCKED: ${m.stopReason}`);
  if (board.status === 'complete' && hasInt && !integrationMerged) add('ready-to-merge', `complete; relay/${slug}/integration is not merged into ${branch}`);
  return items;
}

function integrationState(path, board) {
  const intBranch = `relay/${board.slug}/integration`;
  const hasInt = git(['rev-parse', '--verify', '--quiet', `refs/heads/${intBranch}`], path, { allowFail: true }) !== undefined;
  const merged = hasInt && (board.markedMerged || git(['merge-base', '--is-ancestor', intBranch, 'HEAD'], path, { allowFail: true }) !== undefined);
  return { hasInt, merged };
}

function planSummaries(path, rid, repoName, branch) {
  const files = planFiles(path)
    .map((abs) => ({ abs, m: statSync(abs).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  const plans = [];
  const attention = [];
  for (const { abs } of files) {
    const file = abs.slice(path.length + 1);
    const slug = basename(abs, '.md');
    let r;
    try {
      r = boardFor(abs);
    } catch (err) {
      plans.push({ file, slug, error: err.message });
      continue;
    }
    if (r.errors) {
      plans.push({ file, slug, error: r.errors.join('; ') });
      continue;
    }
    const { board, dir } = r;
    const { hasInt, merged: integrationMerged } = integrationState(path, board);
    plans.push({ slug: board.slug, file, title: board.goal, status: board.status, totals: board.totals, green: board.green, currentWave: board.currentWave, waveCount: board.waveCount, marathon: board.marathon, board, integrationMerged });
    attention.push(...attentionFor({ rid, repoName, slug: board.slug, board, dir, integrationMerged, hasInt, branch }));
  }
  return { plans, attention };
}

function build(path) {
  const rid = ridOf(path);
  const name = basename(path);
  const base = { rid, path, name, plans: [], attention: [], worktrees: [] };
  if (!existsSync(path)) return { ...base, missing: true };
  try {
    const root = mainRoot(path) ?? path;
    const state = gitState(path);
    const { plans, attention } = planSummaries(path, rid, name, state.branch);
    return { rid, path, name, missing: false, error: null, git: state, worktrees: worktreesOf(path, root), codexSetup: codexSetupOf(path), plans, attention };
  } catch (err) {
    return { ...base, error: err.message };
  }
}

export function repoSummary(path) {
  try {
    const key = cacheKey(path);
    const hit = cache.get(path);
    if (hit && hit.key === key && Date.now() - hit.at < TTL_MS) return structuredClone(hit.value);
    const value = build(path);
    cache.set(path, { key, at: Date.now(), value });
    return structuredClone(value);
  } catch (err) {
    return { rid: ridOf(path), path, name: basename(path), error: err.message, plans: [], attention: [], worktrees: [] };
  }
}

function reportInside(abs, roots) {
  try {
    const real = realpathSync(abs);
    return roots.some((r) => {
      try {
        const rr = realpathSync(r);
        return real === rr || real.startsWith(rr + sep);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function planFileOf(path, slug) {
  const abs = planFiles(path).find((f) => {
    try {
      return parsePlan(readFileSync(f, 'utf8')).slug === slug;
    } catch {
      return false;
    }
  });
  if (!abs) throw Object.assign(new Error(`no plan "${slug}" in this repository`), { status: 404 });
  return abs;
}

// Records that a finished plan landed (a squash merge leaves no ancestor to detect).
export function markMerged(path, slug) {
  const abs = planFileOf(path, slug);
  const r = boardFor(abs);
  if (r.errors) throw Object.assign(new Error(r.errors.join('; ')), { status: 409 });
  if (r.board.status !== 'complete') throw Object.assign(new Error(`plan "${slug}" is not complete`), { status: 409 });
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], path, { allowFail: true }) ?? 'HEAD';
  const sha = git(['rev-parse', '--short', 'HEAD'], path, { allowFail: true }) ?? '?';
  appendLedger(abs, `plan: merged (marked in HQ into ${branch} @ ${sha})`);
  clearRepoCache();
  return { ok: true };
}

export function planDetail(path, slug) {
  const abs = planFileOf(path, slug);
  const r = boardFor(abs);
  const rid = ridOf(path);
  const root = mainRoot(path) ?? path;
  if (r.errors) throw Object.assign(new Error(r.errors.join('; ')), { status: 409 });
  const runDirPath = r.dir;
  const exists = (p) => (existsSync(p) ? p : null);
  const active = readJson(join(root, '.relay', 'lanes', 'active.json'));
  let files = [];
  try {
    files = readdirSync(runDirPath);
  } catch {}
  const lanes = {};
  const withReport = (pieces) =>
    (pieces ?? []).map((p) => {
      // the path comes from ledger text: only read a report inside the repository or its .relay/runs/
      const abs = p.report ? resolve(path, p.report) : null;
      return { ...p, report: abs && reportInside(abs, [path, root, join(root, '.relay', 'runs')]) ? abs : null };
    });
  const team = Object.fromEntries(loadTeam(RELAY_ROOT).map((m) => [m.name, { title: m.title, avatar: m.avatar, kind: m.kind, hex: m.hex }]));
  for (const w of r.board.waves) {
    for (const l of w.lanes) {
      const reviews = files
        .filter((f) => f === `lane-${l.id}.review.md` || (f.startsWith(`lane-${l.id}.fix-`) && f.endsWith('.review.md')))
        .map((f) => join(runDirPath, f))
        .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
      const newest = reviews[reviews.length - 1];
      // The reviewer writes findings next to the package it was given: .review.md -> .findings.md.
      const findings = files
        .filter((f) => f === `lane-${l.id}.findings.md` || (f.startsWith(`lane-${l.id}.fix-`) && f.endsWith('.findings.md')))
        .map((f) => join(runDirPath, f))
        .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
      const newestFindings = findings[findings.length - 1];
      const wt = active?.slug === slug ? active.lanes?.[l.id]?.worktree : null;
      lanes[l.id] = {
        pieces: withReport(l.pieces),
        brief: exists(join(runDirPath, `lane-${l.id}.brief.md`)),
        report: exists(join(runDirPath, `lane-${l.id}.report.md`)),
        reviews,
        findings,
        latestReview: newest ? { path: newest } : null,
        latestFindings: newestFindings ? { path: newestFindings, text: readFileSync(newestFindings, 'utf8').slice(0, 20000) } : null,
        worktree: wt && existsSync(wt) ? wt : null,
      };
    }
  }
  const { hasInt, merged } = integrationState(path, r.board);
  return { rid, repo: basename(path), file: abs.slice(path.length + 1), board: r.board, readyToMerge: r.board.status === 'complete' && hasInt && !merged, team, planPieces: withReport(r.board.planPieces), runDir: runDirPath, lanes, final: exists(join(runDirPath, 'final.review.md')) };
}
