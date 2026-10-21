import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { stripFrontmatter } from '../lib/frontmatter.mjs';
import { buildCommand, evaluateGuards, normalizeIntent, startFromIntent } from '../lib/hq/launch.mjs';
import { startLaunch, stopLaunch } from '../lib/hq/launches.mjs';
import { addRepo } from '../lib/hq/registry.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { copyFixture, ROOT, runCli, tempRepo } from './helpers.mjs';

const home = mkdtempSync(join(tmpdir(), 'relay-hq-intent-'));
process.env.RELAY_HOME = home;
const STUB = join(ROOT, 'test', 'fixtures', 'stub-harness.mjs');
chmodSync(STUB, 0o755);
const PLAN = 'docs/relay/plans/plan-basic.md';
const routing = loadRouting();

function registeredRepo() {
  const { dir } = tempRepo();
  copyFixture('plan-basic.md', dir);
  return addRepo(dir);
}

test('run and plan become the specified argv on both harnesses, and user text stays one element', () => {
  const repo = registeredRepo();
  const env = { RELAY_CLAUDE_BIN: STUB, RELAY_CODEX_BIN: STUB, PATH: process.env.PATH };
  const cmd = (intent) => buildCommand(normalizeIntent({ repo, ...intent }), { env, sessionId: 'SID' });
  const c = routing.tiers.mid.claude;
  const x = routing.tiers.mid.codex;

  const run = cmd({ action: 'run', plan: PLAN, harness: 'claude' });
  const absPlan = join(repo, PLAN);
  const runPrompt = run.argv[1];
  assert.match(runPrompt, /^Use the relay run-lanes skill/);
  assert.ok(runPrompt.includes(join(ROOT, 'skills', 'run-lanes', 'SKILL.md')) && runPrompt.includes(`relay ledger ${absPlan}`) && runPrompt.includes('relay budget') && runPrompt.includes('relay calibrate') && runPrompt.includes('plan: complete') && runPrompt.includes('RELAY_LEG: DONE | PAUSED | BLOCKED'));
  assert.match(runPrompt, /never hand the run to a background agent/);
  assert.deepEqual(run.argv, ['-p', runPrompt, '--session-id', 'SID', '--model', c.model, '--effort', c.effort, '--permission-mode', 'auto', '--output-format', 'json']);
  assert.equal(run.cwd, repo);
  const codexRun = cmd({ action: 'run', plan: PLAN, harness: 'codex' });
  assert.deepEqual(codexRun.argv, ['exec', runPrompt, '-m', x.model, '-c', `model_reasoning_effort=${x.effort}`, '--sandbox', 'workspace-write', '--json']);
  assert.doesNotMatch(codexRun.argv[1], /^---|\$ARGUMENTS|\$\{CLAUDE_PLUGIN_ROOT\}/);

  const goal = 'billing export"; rm -rf ~';
  const plan = cmd({ action: 'plan', goal, harness: 'claude' });
  const planMd = stripFrontmatter(readFileSync(join(ROOT, 'commands', 'plan.md'), 'utf8')).replaceAll('$ARGUMENTS', goal).replaceAll('${CLAUDE_PLUGIN_ROOT}', ROOT).trim();
  assert.match(plan.argv[1], /^This is a non-interactive run/);
  assert.ok(plan.argv[1].endsWith(planMd));
  assert.doesNotMatch(plan.argv[1], /\/relay:plan/);
  assert.equal(plan.argv[1], cmd({ action: 'plan', goal, harness: 'codex' }).argv[1]);
  assert.equal(plan.argv.length, 12);
  const codexPlan = cmd({ action: 'plan', goal, harness: 'codex' });
  assert.equal(codexPlan.argv.length, 9);
  assert.equal(codexPlan.argv.filter((a) => a.includes(goal)).length, 1);
});

test('a run is refused while a launch is active or the ledger just moved, resumes a blocked plan, and is refused at budget critical', async () => {
  const repo = registeredRepo();
  const env = { RELAY_CLAUDE_BIN: STUB, PATH: process.env.PATH };
  const intent = { action: 'run', repo, plan: PLAN, harness: 'claude' };
  assert.deepEqual(evaluateGuards(normalizeIntent(intent), { env }).errors, []);

  const first = startLaunch({ ...intent, bin: STUB, argv: ['-p', 'x'], cwd: repo, model: 'sonnet', effort: 'medium', permissionMode: 'auto', env: { STUB_SLEEP_MS: '60000' } });
  try {
    assert.match(evaluateGuards(normalizeIntent(intent), { env }).errors.join('\n'), /already running/);
    assert.throws(() => startFromIntent({ ...intent, confirm: true }, { env }), (e) => e.status === 409);
  } finally {
    await stopLaunch(first.id);
  }

  const ledger = (line) => assert.equal(runCli(['ledger', join(repo, PLAN), line], { cwd: repo }).code, 0);
  ledger('start: 6 tasks, 4 lanes, 2 waves');
  assert.match(evaluateGuards(normalizeIntent(intent), { env }).errors.join('\n'), /already running/, 'a fresh ledger on a board that is not blocked looks alive');
  ledger('Lane b: T4 BLOCKED, needs a decision on the README section');
  const resumed = evaluateGuards(normalizeIntent(intent), { env });
  assert.deepEqual(resumed.errors, []);
  assert.ok(resumed.resume);
  assert.ok(resumed.warnings.includes('resumes from the ledger'));

  writeFileSync(join(home, 'budget.json'), JSON.stringify({ updatedAt: new Date().toISOString(), fiveHour: { percentUsed: 90, resetsAt: new Date(Date.now() + 3_600_000).toISOString() } }));
  assert.match(evaluateGuards(normalizeIntent(intent), { env }).errors.join('\n'), /critical/);
});
