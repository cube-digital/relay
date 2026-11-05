// What a finished plan leaves for its review: tests added and removed (from git between the
// run's origin and its integration branch, else from the lane reports), rulings, deferred
// findings, the merged waves with the last suite result, and the final review. Read-only.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../git.mjs';

const LEDGER_LINE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?: \[[^\]]*\])? (.*)$/;
const TESTS_LINE = /\btests:\s*\+(\d+)\s*[-−](\d+)/;
const DEFERRED = /\bdeferred(?: minors?)?:\s*(.+)$/i;
const WAVE_MERGED = /^wave \d+: merged\b/;
const MAX_TEXT = 20000;

// [{ at: 'YYYY-MM-DD HH:MM' (UTC), text }] of a run directory's ledger, oldest first.
export function ledgerOf(dir) {
  const path = join(dir, 'ledger.md');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => LEDGER_LINE.exec(l))
    .filter(Boolean)
    .map((m) => ({ at: m[1], text: m[2] }));
}

// { added, removed } summed over lane-<id>.report.md, the last "tests: +N -M" line of each; null when no report has one.
export function testsOf(dir) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => /^lane-[a-z]+\.report\.md$/.test(f));
  } catch {
    return null;
  }
  let found = false;
  let added = 0;
  let removed = 0;
  for (const f of files) {
    const last = readFileSync(join(dir, f), 'utf8').split('\n').map((l) => TESTS_LINE.exec(l)).filter(Boolean).pop();
    if (!last) continue;
    found = true;
    added += Number(last[1]);
    removed += Number(last[2]);
  }
  return found ? { added, removed } : null;
}

const TEST_FILE = /(^|\/)(tests?|__tests__|specs?)\/|[._-](test|spec)\.[cm]?[jt]sx?$|_(test|spec)\.(go|py|rb|exs?)$|(^|\/)test_[^/]*\.py$|Tests?\.(java|kt|cs|swift)$/;
const TEST_DECL = [
  /^\s*(?:test|it)(?:\.(?:only|skip|todo|fixme|fail|failing|concurrent|serial))*(?:\s*\(|\.each\b)/, // JS, TS
  /^\s*(?:async\s+)?def\s+test\w*\s*\(/, // Python
  /^\s*func\s+(?:Test|test)\w*\s*\(/, // Go, Swift
  /^\s*#\[(?:[\w:]+::)?test\]/, // Rust
  /^\s*@(?:Test|ParameterizedTest)\b/, // JVM
  /^\s*\[(?:Test|Fact|Theory|TestMethod)\b/, // .NET
  /^\s*(?:it|test|specify)\s+['"]/, // Ruby
  /^\s*(?:public\s+)?function\s+test\w*\s*\(/, // PHP
];
const gitCounts = new Map();

// { added, removed } test declarations in the test files changed between the run's origin and
// relay/<slug>/integration; null without a repository, an origin or the branch.
export function testsFromGit(repo, dir, slug) {
  if (!repo || !slug) return null;
  let origin;
  try {
    origin = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).origin;
  } catch {
    return null;
  }
  if (!origin) return null;
  const tip = git(['rev-parse', '--verify', '--quiet', `refs/heads/relay/${slug}/integration`], repo, { allowFail: true });
  if (!tip) return null;
  const key = `${repo}\0${origin}\0${tip}`;
  if (gitCounts.has(key)) return gitCounts.get(key);
  const files = (git(['diff', '--name-only', '--no-ext-diff', origin, tip], repo, { allowFail: true }) ?? '').split('\n').filter((f) => TEST_FILE.test(f));
  const counts = { added: 0, removed: 0 };
  if (files.length) {
    const diff = git(['diff', '-U0', '--no-color', '--no-ext-diff', origin, tip, '--', ...files], repo, { allowFail: true });
    if (diff === undefined) return null;
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      const sign = line[0];
      if ((sign === '+' || sign === '-') && TEST_DECL.some((re) => re.test(line.slice(1)))) counts[sign === '+' ? 'added' : 'removed'] += 1;
    }
  }
  gitCounts.set(key, counts);
  return counts;
}

// repo: the repository path; with it the tests are counted from git.
export function reviewOf(board, dir, { repo } = {}) {
  const entries = ledgerOf(dir);
  const deferred = entries.map((e) => DEFERRED.exec(e.text)?.[1]?.trim()).filter(Boolean);
  const waves = entries.filter((e) => WAVE_MERGED.test(e.text)).map((e) => e.text);
  const last = waves[waves.length - 1];
  const final = join(dir, 'final.findings.md');
  return {
    tests: testsFromGit(repo, dir, board.slug) ?? testsOf(dir),
    rulings: board.rulings ?? [],
    deferred,
    openFindings: deferred.length,
    waves,
    suite: last ? (/suite fail/i.test(last) ? 'fail' : 'pass') : null,
    finalFindings: existsSync(final) ? readFileSync(final, 'utf8').slice(0, MAX_TEXT) : null,
    reports: ['final.review.md', 'final.findings.md'].map((f) => join(dir, f)).filter((p) => existsSync(p)),
  };
}
