import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCli, tempRepo } from './helpers.mjs';

const PLAN = `# Demo Plan

**Goal:** exercise flows.

## Tasks

### T1: Infra
x

### T2: Source
x

### T3: Docs
x

\`\`\`relay-plan
{
  "slug": "demo",
  "suite": "true",
  "tasks": [
    { "id": "T1", "title": "Infra", "tier": "mid", "risk": "low", "files": ["infra/main.tf"], "tests": 0, "done": "true" },
    { "id": "T2", "title": "Source", "tier": "mid", "risk": "medium", "files": ["src/a.mjs"], "behaviors": ["does a"], "tests": 1, "done": "true" },
    { "id": "T3", "title": "Docs", "tier": "cheap", "code": "complete", "risk": "low", "files": ["docs/x.md"], "tests": 0, "done": "true" }
  ]
}
\`\`\`
`;

function setup() {
  const { dir, git } = tempRepo({ 'README.md': '# demo\n', 'docs/relay/plans/demo.md': PLAN });
  const env = { RELAY_HOME: mkdtempSync(join(tmpdir(), 'relay-home-')) };
  const plan = join(dir, 'docs/relay/plans/demo.md');
  const run = join(dir, '.relay', 'runs', 'demo');
  const cli = (...args) => runCli(['flow', ...args], { cwd: dir, env });
  return { dir, git, env, plan, run, cli, ledger: () => readFileSync(join(run, 'ledger.md'), 'utf8') };
}

test('flow at resolves applicable pieces with stable agents and briefs, and ledgers skipped requires', () => {
  const { plan, run, cli, ledger } = setup();

  const a = cli('at', plan, 'lane.after', '--lane', 'a', '--json');
  assert.equal(a.code, 0, a.stderr);
  const outA = JSON.parse(a.stdout);
  assert.equal(outA.pieces.length, 1);
  assert.equal(outA.pieces[0].piece, 'platform-review');
  assert.equal(outA.pieces[0].agent, 'lane-a-platform-review');
  writeFileSync(outA.pieces[0].report, '# report\n'); // the reviewer writes it later
  assert.equal(realpathSync(outA.pieces[0].report), join(realpathSync(run), 'lane-a.platform-review.md'));
  assert.match(readFileSync(outA.pieces[0].brief, 'utf8'), /## What to do/);

  const again = JSON.parse(cli('at', plan, 'lane.after', '--lane', 'a', '--json').stdout);
  assert.equal(again.pieces[0].agent, 'lane-a-platform-review');
  assert.equal(again.pieces[0].brief, outA.pieces[0].brief);

  const c = JSON.parse(cli('at', plan, 'lane.before', '--lane', 'c', '--json').stdout);
  assert.deepEqual(c.pieces, []);
  assert.deepEqual(c.skipped.map((s) => [s.piece, s.kind]), [['acceptance-tests', 'when']]);

  const b = JSON.parse(cli('at', plan, 'lane.before', '--lane', 'b', '--json').stdout);
  assert.deepEqual(b.pieces.map((p) => p.piece), ['acceptance-tests']);

  const fin = JSON.parse(cli('at', plan, 'final', '--json').stdout);
  assert.deepEqual(fin.skipped.map((s) => [s.piece, s.kind]), [['requirements-check', 'requires']]);
  assert.match(fin.skipped[0].reason, /requires docs\/relay\/requirements\/demo\.md missing/);
  assert.match(ledger(), /piece requirements-check: skipped \(requires docs\/relay\/requirements\/demo\.md missing\)/);
  cli('at', plan, 'final', '--json');
  assert.equal(ledger().match(/piece requirements-check: skipped/g).length, 1, 'a re-run does not repeat the skip line');

  assert.equal(cli('at', plan, 'nowhere').code, 64);
});

test('flow done ledgers the piece line, blocks a read-only piece that committed, and demands --protect', () => {
  const { dir, git, plan, cli, ledger } = setup();
  git('branch', 'relay/demo/lane-a');

  assert.equal(cli('at', plan, 'lane.after', '--lane', 'a').code, 0);
  const ok = cli('done', plan, 'platform-review', '--lane', 'a', '--status', 'pass', '--report', 'r.md');
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ledger(), /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: \[[^\]]*\])? piece platform-review lane a: pass \(r\.md\)$/m);

  assert.equal(cli('at', plan, 'lane.after', '--lane', 'a').code, 0);
  git('checkout', '-q', 'relay/demo/lane-a');
  writeFileSync(join(dir, 'oops.txt'), 'x');
  git('add', '-A');
  git('commit', '-qm', 'oops: edit');
  git('checkout', '-q', 'main');
  const bad = cli('done', plan, 'platform-review', '--lane', 'a', '--status', 'pass', '--report', 'r.md');
  assert.equal(bad.code, 1);
  assert.match(ledger(), /piece platform-review lane a: blocked \(r\.md\) committed: oops: edit$/m);

  const prot = cli('done', plan, 'acceptance-tests', '--lane', 'b', '--status', 'pass', '--report', 't.md');
  assert.equal(prot.code, 1);
  assert.doesNotMatch(ledger(), /piece acceptance-tests/);
});
