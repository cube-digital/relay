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

test('run, plan and skills invoke relay as defined on both harnesses, and user text stays one element', () => {
  const repo = registeredRepo();
  const env = { RELAY_CLAUDE_BIN: STUB, RELAY_CODEX_BIN: STUB, PATH: process.env.PATH };
  const cmd = (intent) => buildCommand(normalizeIntent({ repo, ...intent }), { env, sessionId: 'SID' });
  const commandText = (name, args) => stripFrontmatter(readFileSync(join(ROOT, 'commands', `${name}.md`), 'utf8')).replaceAll('$ARGUMENTS', args).replaceAll('${CLAUDE_PLUGIN_ROOT}', ROOT).trim();
  const c = routing.tiers.mid.claude;
  const x = routing.tiers.mid.codex;

  const absPlan = join(repo, PLAN);
  const run = cmd({ action: 'run', plan: PLAN, harness: 'claude' });
  assert.deepEqual(run.argv, ['-p', `/relay:run --unattended ${absPlan}`, '--plugin-dir', ROOT, '--session-id', 'SID', '--model', c.model, '--effort', c.effort, '--permission-mode', 'auto', '--output-format', 'json']);
  assert.equal(run.cwd, repo);
  const codexRun = cmd({ action: 'run', plan: PLAN, harness: 'codex' });
  assert.deepEqual(codexRun.argv, ['exec', commandText('run', `--unattended ${absPlan}`), '-m', x.model, '-c', `model_reasoning_effort=${x.effort}`, '--sandbox', 'workspace-write', '--json']);
  assert.doesNotMatch(codexRun.argv[1], /^---|\$ARGUMENTS|\$\{CLAUDE_PLUGIN_ROOT\}/);

  const goal = 'billing export"; rm -rf ~';
  const plan = cmd({ action: 'plan', goal, harness: 'claude' });
  assert.equal(plan.argv[1], `/relay:plan --unattended ${goal}`);
  assert.equal(plan.argv.length, 14);
  assert.equal(cmd({ action: 'plan', goal, flow: 'bugfix', harness: 'claude' }).argv[1], `/relay:plan --unattended --flow bugfix ${goal}`);
  const codexPlan = cmd({ action: 'plan', goal, harness: 'codex' });
  assert.equal(codexPlan.argv[1], commandText('plan', `--unattended ${goal}`));
  assert.equal(codexPlan.argv.length, 9);
  assert.equal(codexPlan.argv.filter((a) => a.includes(goal)).length, 1);
  // the mode HQ relies on is defined in the commands themselves
  for (const text of [codexRun.argv[1], codexPlan.argv[1]]) assert.match(text, /\*\*Unattended\.\*\*/);

  // relay's skills are plugin skills on Claude; Codex names a skill with $
  assert.equal(cmd({ action: 'skill', skill: 'qa-mindset', prompt: 'check lane b', harness: 'claude' }).argv[1], '/relay:qa-mindset check lane b');
  assert.equal(cmd({ action: 'skill', skill: 'pdf', harness: 'claude' }).argv[1], '/pdf');
  assert.equal(cmd({ action: 'skill', skill: 'qa-mindset', prompt: 'check lane b', harness: 'codex' }).argv[1], '$qa-mindset check lane b');
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
