// A fingerprint of "this test command on this exact code": execution cwd, command, HEAD,
// the tracked diff, and untracked files (path + size + mtime). Same fingerprint
// means a rerun can only repeat the previous result (flaky tests aside).

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalPath, git, worktreeRoot } from './git.mjs';

// A command runs tests when one of its segments (split on && || ; |) starts
// with a test runner, after env assignments and wrappers like npx / uv run.
const RUNNERS = [
  /^node\s+(?:(?:--(?:import|require|loader|conditions)\s+\S+|--[\w-]+(?:=\S+)?|-r\s+\S+)\s+)*--test(?:[=\s]|$)/,
  /^pytest\b/,
  /^unittest\b/,
  /^(jest|vitest|mocha|ava)\b/,
  /^playwright\s+test\b/,
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?test\b(?!:)/,
  /^bun\s+test\b/,
  /^deno\s+test\b/,
  /^go\s+test\b/,
  /^cargo\s+(test|nextest)\b/,
  /^(\.\/)?(mvnw?|gradlew?)\b.*\b(test|verify|check)\b/,
  /^dotnet\s+test\b/,
  /^(bundle\s+exec\s+)?rspec\b/,
  /^(\S*\/)?phpunit\b/,
  /^mix\s+test\b/,
  /^swift\s+test\b/,
  /^ctest\b/,
  /^make\s+(test|check)\b/,
  /^(tox|nox)\b/,
];

const WRAPPERS = [
  /^\(+\s*/,
  /^\w+=\S*\s+/,
  /^(time|env|exec|nice)\s+/,
  /^(npx|bunx|pnpx)\s+(--?\S+\s+)*/,
  /^(uv|poetry|pipenv|hatch|rye|pdm)\s+run\s+/,
  /^(pnpm|yarn)\s+exec\s+/,
  /^python3?\s+-m\s+/,
  /^cd\s+\S+\s*$/,
];

const WATCH = /(--watch\b|--watchAll\b|\s-w\b)/;

function stripWrappers(segment) {
  let s = segment.trim();
  for (;;) {
    const before = s;
    for (const w of WRAPPERS) s = s.replace(w, '');
    if (s === before) return s;
  }
}

export function isTestCommand(command) {
  if (!command || WATCH.test(command)) return false;
  return command
    .replace(/\\\r?\n/g, ' ')
    .split(/&&|\|\||;|\||\r?\n/)
    .map(stripWrappers)
    .some((seg) => RUNNERS.some((re) => re.test(seg)));
}

export function normalizeCommand(command) {
  return command.replace(/\s+/g, ' ').trim();
}

export function fingerprint(cwd, command) {
  const root = worktreeRoot(cwd);
  if (!root) return undefined;
  const hash = createHash('sha256');
  hash.update(canonicalPath(cwd));
  hash.update('\0' + normalizeCommand(command));
  hash.update('\0' + (git(['rev-parse', 'HEAD'], root, { allowFail: true }) ?? 'no-head'));
  hash.update('\0' + (git(['diff', 'HEAD', '--binary', '--no-ext-diff'], root, { allowFail: true }) ?? ''));
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], root, { allowFail: true }) ?? '';
  for (const rel of untracked.split('\0').filter(Boolean).sort()) {
    try {
      const s = statSync(join(root, rel));
      hash.update(`\0${rel}:${s.size}:${s.mtimeMs}`);
    } catch {
      hash.update(`\0${rel}:gone`);
    }
  }
  return { root, value: hash.digest('hex') };
}
