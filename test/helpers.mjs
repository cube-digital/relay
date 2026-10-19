import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = join(ROOT, 'test', 'fixtures');

export function tempRepo(files = { 'README.md': '# demo\n' }) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'relay test');
  git('config', 'commit.gpgsign', 'false');
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, git };
}

export function copyFixture(name, repoDir, rel = `docs/relay/plans/${name}`) {
  const to = join(repoDir, rel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(FIXTURES, name), to);
  return to;
}

export function runHook(script, input, env = {}) {
  const res = spawnSync('node', [join(ROOT, 'hooks', script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

export function runCli(args, { cwd = ROOT, env = {} } = {}) {
  const res = spawnSync('node', [join(ROOT, 'bin', 'relay'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}
