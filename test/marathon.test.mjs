import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { classifyLeg, decideNext, parseClaudeJson, parseCodexJson, parseResetTime } from '../lib/marathon.mjs';
import { alive, describeMarathon, legArgs, resolveClaudeBin } from '../scripts/relay-marathon.mjs';
import { copyFixture, ROOT, runCli, tempRepo } from './helpers.mjs';

const FAKE = join(ROOT, 'test', 'fixtures', 'fake-claude.mjs');

async function waitFor(check, ms = 10_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

// A marathon started the way Claude Code starts a background task: a child
// process we do not wait on.
function startMarathon(args, { cwd, env }) {
  const child = spawn('node', [join(ROOT, 'bin', 'relay'), 'marathon', ...args], { cwd, env: { ...process.env, RELAY_HARNESS: 'claude', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise((res) => child.on('close', (code) => res({ code, out })));
  return { child, exited };
}

function committedPlanRepo() {
  const home = mkdtempSync(join(tmpdir(), 'relay-home-'));
  const { dir, git } = tempRepo();
  const planPath = copyFixture('plan-basic.md', dir);
  git('add', '-A');
  git('commit', '-qm', 'plan');
  return { home, dir, planPath, ledger: join(dir, '.relay', 'runs', 'billing-export', 'ledger.md'), state: join(dir, '.relay', 'runs', 'billing-export', 'marathon.json') };
}

const NOW = new Date('2026-10-19T12:00:00Z');

test('reset times in limit messages resolve to the next such moment', () => {
  const t = (s) => parseResetTime(s, NOW);
  assert.equal(Date.parse(t('You\'ve hit your session limit · resets 3:45pm')) > NOW.getTime(), true);
  assert.equal(new Date(t('resets 3:45pm')).getMinutes(), 45);
  const past = t('resets 1am');
  assert.equal(Date.parse(past) > NOW.getTime(), true, 'a time already past today rolls to tomorrow');
  const mon = new Date(t('resets Mon 12:00am'));
  assert.equal(mon.getDay(), 1);
  assert.equal(t('no reset here'), undefined);
});

test('a leg is classified from its result, the ledger and the budget', () => {
  const budget = { level: 'critical', fiveHour: { percentUsed: 90, resetsAt: '2026-10-19T15:00:00Z' } };
  assert.equal(classifyLeg({ result: { result: 'all good\nRELAY_LEG: DONE — merged' }, ledgerGrew: true, now: NOW }).kind, 'done');
  assert.equal(classifyLeg({ result: {}, planComplete: true, now: NOW }).kind, 'done');
  assert.equal(classifyLeg({ result: { result: 'RELAY_LEG: BLOCKED — plan contradicts spec' }, now: NOW }).kind, 'blocked');
  const lim = classifyLeg({ result: { is_error: true, result: "You've hit your session limit · resets 3:45pm" }, budget, now: NOW });
  assert.equal(lim.kind, 'limit');
  assert.equal(lim.resetsAt, '2026-10-19T15:00:00Z', 'the budget snapshot wins over the parsed text');
  const paused = classifyLeg({ result: { result: 'RELAY_LEG: PAUSED — budget critical' }, budget, now: NOW });
  assert.equal(paused.kind, 'paused');
  assert.equal(paused.resetsAt, '2026-10-19T15:00:00Z');
  assert.equal(classifyLeg({ result: { result: 'ran out of turns' }, ledgerGrew: true, now: NOW }).kind, 'progress');
  assert.equal(classifyLeg({ result: { result: 'nothing' }, ledgerGrew: false, now: NOW }).kind, 'stalled');
  assert.equal(classifyLeg({ result: { is_error: true, result: 'boom' }, now: NOW }).kind, 'error');
});

test('decideNext stops at the deadline, on blocks and on stalls, otherwise waits or continues', () => {
  const deadline = new Date('2026-10-19T20:00:00Z');
  const base = { now: NOW, deadline, legsRun: 1, maxLegs: 24, stalledStreak: 0 };
  assert.equal(decideNext({ ...base, outcome: { kind: 'done' } }).action, 'stop');
  assert.equal(decideNext({ ...base, outcome: { kind: 'blocked', reason: 'x' } }).action, 'stop');
  assert.equal(decideNext({ ...base, outcome: { kind: 'progress' } }).action, 'continue');
  const w = decideNext({ ...base, outcome: { kind: 'limit', resetsAt: '2026-10-19T15:00:00Z', reason: 'limit' } });
  assert.deepEqual([w.action, w.until], ['wait', '2026-10-19T15:00:00Z']);
  assert.equal(decideNext({ ...base, outcome: { kind: 'limit', resetsAt: '2026-10-20T15:00:00Z' } }).action, 'stop', 'a reset after the deadline ends the run');
  assert.equal(decideNext({ ...base, outcome: { kind: 'paused' } }).action, 'wait', 'no reset time known: wait 30 minutes and look again');
  assert.equal(decideNext({ ...base, outcome: { kind: 'stalled' }, stalledStreak: 2 }).action, 'stop');
  assert.equal(decideNext({ ...base, outcome: { kind: 'progress' }, legsRun: 24 }).action, 'stop');
});

test('claude JSON output is found even with noise around it', () => {
  assert.equal(parseClaudeJson('warning: x\n{"type":"result","session_id":"s1","result":"ok"}\n').session_id, 's1');
  assert.equal(parseClaudeJson('plain text'), undefined);
});

test('leg arguments follow the unattended pattern', () => {
  const a = legArgs({ prompt: 'p', model: 'sonnet', permissionMode: 'auto', maxTurns: 10 });
  assert.ok(a.includes('--permission-prompts') && a[a.indexOf('--permission-prompts') + 1] === 'none');
  assert.ok(!a.includes('--dangerously-skip-permissions'));
  assert.ok(legArgs({ prompt: 'p', model: 'sonnet', permissionMode: 'bypassPermissions', maxTurns: 1 }).includes('--dangerously-skip-permissions'));
  const id = a[a.indexOf('--session-id') + 1];
  assert.match(id, /^[0-9a-f-]{36}$/, 'each leg is its own session, never the parent session it was started from');
});

test('the marathon loop runs legs, waits for the window and stops when the plan completes', () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-home-'));
  const { dir, git } = tempRepo();
  const planPath = copyFixture('plan-basic.md', dir);
  git('add', '-A');
  git('commit', '-qm', 'plan');
  const scenarioPath = join(home, 'scenario.json');
  const ledger = join(dir, '.relay', 'runs', 'billing-export', 'ledger.md');
  const soon = new Date(Date.now() + 60_000).toISOString();
  writeFileSync(
    scenarioPath,
    JSON.stringify({
      ledger,
      budget: join(home, 'budget.json'),
      steps: [
        { ledger: ['start: 6 tasks', 'wave 1: merged @ aaa, suite pass'], budget: { fiveHour: { percentUsed: 88, resetsAt: soon } }, result: 'wave 1 done\nRELAY_LEG: PAUSED — budget critical' },
        { ledger: ['wave 2: merged @ bbb, suite pass', 'plan: complete (relay/billing-export/integration @ bbb)'], budget: { fiveHour: { percentUsed: 12 } }, result: 'RELAY_LEG: DONE — merged' },
      ],
    }),
  );
  const env = { RELAY_HOME: home, RELAY_CLAUDE_BIN: join(ROOT, 'test', 'fixtures', 'fake-claude.mjs'), FAKE_CLAUDE_SCENARIO: scenarioPath, RELAY_MARATHON_FAST: '1' };
  const r = runCli(['marathon', planPath, '--hours', '4', '--max-turns', '50'], { cwd: dir, env });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /forecast for billing-export/);
  assert.match(r.stdout, /leg 1: paused/);
  assert.match(r.stdout, /waiting until/);
  assert.match(r.stdout, /leg 2: done/);
  assert.match(r.stdout, /marathon stop: plan complete/);
  const state = JSON.parse(readFileSync(join(dir, '.relay', 'runs', 'billing-export', 'marathon.json'), 'utf8'));
  assert.equal(state.legs.length, 2);
  assert.deepEqual(state.legs.map((l) => l.outcome), ['paused', 'done']);
  assert.equal(state.legs[0].sessionId, 's1');
  const argv = readFileSync(scenarioPath + '.argv', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(argv[0].includes('--permission-mode') && argv[0].includes('--max-turns'));
  assert.match(argv[1][1], /leg 2 of an unattended marathon/);
  const ids = argv.map((a) => a[a.indexOf('--session-id') + 1]);
  assert.notEqual(ids[0], ids[1], 'two legs, two sessions');
});

test('the marathon refuses a dirty checkout and stops after two stalled legs', () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-home-'));
  const { dir, git } = tempRepo();
  const planPath = copyFixture('plan-basic.md', dir);
  const dirty = runCli(['marathon', planPath, '--hours', '1'], { cwd: dir, env: { RELAY_HOME: home } });
  assert.equal(dirty.code, 1);
  assert.match(dirty.stderr, /uncommitted changes/);
  git('add', '-A');
  git('commit', '-qm', 'plan');
  const scenarioPath = join(home, 'scenario.json');
  writeFileSync(scenarioPath, JSON.stringify({ ledger: join(dir, '.relay/runs/billing-export/ledger.md'), budget: join(home, 'budget.json'), steps: [{ result: 'nothing happened' }] }));
  const env = { RELAY_HOME: home, RELAY_CLAUDE_BIN: join(ROOT, 'test', 'fixtures', 'fake-claude.mjs'), FAKE_CLAUDE_SCENARIO: scenarioPath, RELAY_MARATHON_FAST: '1' };
  const r = runCli(['marathon', planPath, '--hours', '1'], { cwd: dir, env });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /two legs in a row made no progress/);
  const dry = runCli(['marathon', planPath, '--hours', '1', '--dry-run'], { cwd: dir, env });
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /dry run\. Leg 3 would run/);
});

test('status reads only the marathon files and says what is happening', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  assert.match(describeMarathon({ state: undefined }).text, /no marathon has run/);
  const base = { slug: 'x', pid: 42, deadline: '2026-10-19T20:00:00Z', options: { model: 'sonnet', permissionMode: 'auto' }, legs: [{ leg: 1, outcome: 'paused', reason: 'budget critical', costUsd: 2, budget: { fiveHour: 86, sevenDay: 30 } }] };
  const leg = describeMarathon({ state: { ...base, phase: { kind: 'leg', leg: 2, since: '2026-10-19T11:40:00Z' } }, ledger: ['- a', '- b'], now, isAlive: () => true });
  assert.equal(leg.running, true);
  assert.match(leg.text, /running · pid 42 · leg 2 since .* \(20m\)/);
  assert.match(leg.text, /8h 0m left/);
  assert.match(leg.text, /last {2}leg 1 paused: budget critical \[5h 86% · 7d 30%\]/);
  assert.match(leg.text, /ledger\n {2}- a\n {2}- b/);
  const waiting = describeMarathon({ state: { ...base, phase: { kind: 'waiting', until: '2026-10-19T13:30:00Z' } }, now, isAlive: () => true });
  assert.match(waiting.text, /waiting for the usage window until .* \(1h 30m from now\)/);
  const gone = describeMarathon({ state: { ...base, phase: { kind: 'leg', leg: 2, since: '2026-10-19T11:40:00Z' } }, now, isAlive: () => false });
  assert.equal(gone.running, false);
  assert.match(gone.text, /not running: .*continues from the ledger/);
  assert.match(describeMarathon({ state: { ...base, endedAt: '2026-10-19T11:59:00Z', stopReason: 'plan complete' }, now, isAlive: () => true }).text, /finished .*: plan complete/);
  assert.equal(alive(process.pid), true);
});

test('a running marathon can be watched, is not started twice, and stops after its current leg on request', async () => {
  const { home, dir, planPath, ledger, state } = committedPlanRepo();
  const scenarioPath = join(home, 'scenario.json');
  writeFileSync(scenarioPath, JSON.stringify({ ledger, budget: join(home, 'budget.json'), steps: [{ sleepMs: 1500, ledger: ['start: 6 tasks', 'wave 1: merged @ aaa, suite pass'], result: 'wave 1 merged, turns ran out' }, { result: 'RELAY_LEG: DONE — merged' }] }));
  const env = { RELAY_HOME: home, RELAY_CLAUDE_BIN: FAKE, FAKE_CLAUDE_SCENARIO: scenarioPath, RELAY_MARATHON_FAST: '1' };
  const m = startMarathon([planPath, '--hours', '2'], { cwd: dir, env });
  assert.ok(await waitFor(() => existsSync(scenarioPath + '.pid')), 'leg 1 started');

  const s = runCli(['marathon', planPath, '--status'], { cwd: dir, env });
  assert.equal(s.code, 0, s.stderr);
  assert.match(s.stdout, /running · pid \d+ · leg 1 since/);
  const twice = runCli(['marathon', planPath, '--hours', '2'], { cwd: dir, env });
  assert.equal(twice.code, 1);
  assert.match(twice.stderr, /already running/);

  const stop = runCli(['marathon', planPath, '--stop'], { cwd: dir, env });
  assert.equal(stop.code, 0, stop.stderr);
  assert.match(stop.stdout, /ends after the current leg/);
  const { code, out } = await m.exited;
  assert.equal(code, 3, out);
  const st = JSON.parse(readFileSync(state, 'utf8'));
  assert.equal(st.legs.length, 1, 'leg 1 finished, leg 2 never started');
  assert.equal(st.legs[0].outcome, 'progress');
  assert.equal(st.stopReason, 'stopped on request');
  assert.match(runCli(['marathon', planPath, '--status'], { cwd: dir, env }).stdout, /finished .*: stopped on request/);
  assert.equal(runCli(['marathon', planPath, '--stop'], { cwd: dir, env }).code, 1, 'nothing left to stop');

  // started again, it continues: the old stop request does not apply to the new run
  const again = runCli(['marathon', planPath, '--hours', '2'], { cwd: dir, env });
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /leg 2: done/);
});

test('stop --now ends the running leg as well, so no headless session is left behind', async () => {
  const { home, dir, planPath, ledger, state } = committedPlanRepo();
  const scenarioPath = join(home, 'scenario.json');
  writeFileSync(scenarioPath, JSON.stringify({ ledger, budget: join(home, 'budget.json'), steps: [{ sleepMs: 60_000, result: 'never reached' }] }));
  const env = { RELAY_HOME: home, RELAY_CLAUDE_BIN: FAKE, FAKE_CLAUDE_SCENARIO: scenarioPath, RELAY_MARATHON_FAST: '1' };
  const m = startMarathon([planPath, '--hours', '2'], { cwd: dir, env });
  assert.ok(await waitFor(() => existsSync(scenarioPath + '.pid')), 'leg 1 started');
  const legPid = Number(readFileSync(scenarioPath + '.pid', 'utf8'));
  assert.equal(alive(legPid), true);

  const stop = runCli(['marathon', planPath, '--stop', '--now'], { cwd: dir, env });
  assert.equal(stop.code, 0, stop.stderr);
  const { code } = await m.exited;
  assert.equal(code, 143);
  assert.ok(await waitFor(() => !alive(legPid), 3000), 'the leg process was stopped with the marathon');
  assert.equal(JSON.parse(readFileSync(state, 'utf8')).stopReason, 'stopped by SIGTERM');
});

test('the legs find claude on PATH, or fall back to the Claude Code that started the marathon', () => {
  const bin = mkdtempSync(join(tmpdir(), 'relay-bin-'));
  const empty = mkdtempSync(join(tmpdir(), 'relay-empty-'));
  writeFileSync(join(bin, 'claude'), '');
  const app = join(mkdtempSync(join(tmpdir(), 'relay-app-')), 'claude');
  writeFileSync(app, '');
  assert.equal(resolveClaudeBin({ RELAY_CLAUDE_BIN: '/x/claude', PATH: bin }), '/x/claude');
  assert.equal(resolveClaudeBin({ PATH: `${empty}:${bin}`, CLAUDE_CODE_EXECPATH: app }), join(bin, 'claude'));
  assert.equal(resolveClaudeBin({ PATH: empty, CLAUDE_CODE_EXECPATH: app }), app, 'desktop app: no claude on PATH');
  assert.equal(resolveClaudeBin({ PATH: empty }), undefined);

  const { home, dir, planPath } = committedPlanRepo();
  const tools = join(home, 'tools');
  mkdirSync(tools);
  symlinkSync(process.execPath, join(tools, 'node')); // node, git and nothing named claude
  const r = runCli(['marathon', planPath, '--hours', '1', '--dry-run'], { cwd: dir, env: { RELAY_HOME: home, RELAY_CLAUDE_BIN: '', CLAUDE_CODE_EXECPATH: '', PATH: `${tools}:/usr/bin:/bin` } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no `claude` command found/);
});

function codexScenario(repo, steps, extra = {}) {
  const file = join(repo.home, 'codex.json');
  writeFileSync(file, JSON.stringify({ ledger: repo.ledger, steps, ...extra }));
  return { file, env: { RELAY_HOME: repo.home, RELAY_HARNESS: 'codex', RELAY_CODEX_BIN: join(ROOT, 'test/fixtures/fake-codex.mjs'), FAKE_CODEX_SCENARIO: file, RELAY_MARATHON_FAST: '1' } };
}

test('Codex dry-run uses native sandbox and approval arguments without executing a leg', () => {
  const repo = committedPlanRepo();
  const { file, env } = codexScenario(repo, [{ result: 'RELAY_LEG: DONE' }]);
  const run = runCli(['marathon', repo.planPath, '--codex', '--hours', '1', '--dry-run', '--model', 'chosen-model', '--effort', 'high'], { cwd: repo.dir, env });
  assert.equal(run.code, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /exec --sandbox workspace-write --approve-for-me --json --model chosen-model -c model_reasoning_effort=high/);
  assert.doesNotMatch(run.stdout, /bypass|--permission-mode|--max-turns/);
  assert.equal(existsSync(file + '.argv'), false);
  assert.equal(existsSync(repo.state), false);
});

test('Codex pauses on its real weekly window and resumes its saved session to completion', () => {
  const repo = committedPlanRepo();
  const resetsAt = Math.floor(Date.now() / 1000) + 120;
  const { file, env } = codexScenario(repo, [
    { ledger: ['wave 1: merged'], budget: { primary: { usedPercent: 96, windowDurationMins: 10080, resetsAt } }, result: 'RELAY_LEG: PAUSED — window full' },
    { ledger: ['plan: complete'], result: 'RELAY_LEG: DONE — merged' },
  ], { resetAfterRead: true });
  const run = runCli(['marathon', repo.planPath, '--harness', 'codex', '--hours', '2'], { cwd: repo.dir, env });
  assert.equal(run.code, 0, run.stdout + run.stderr);
  assert.match(run.stdout, new RegExp(`waiting until ${new Date(resetsAt * 1000).toISOString()}`));
  const state = JSON.parse(readFileSync(repo.state, 'utf8'));
  assert.deepEqual(state.legs.map(leg => leg.outcome), ['paused', 'done']);
  assert.equal(state.sessionId, 'codex-thread-1');
  const argv = readFileSync(file + '.argv', 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(argv[0][0], 'exec');
  assert.ok(argv[0].at(-1).includes(join(ROOT, 'skills/run-lanes/SKILL.md')));
  assert.ok(argv[1].at(-1).includes(`node '${join(ROOT, 'bin/relay')}' ledger '${repo.planPath}' --harness codex`));
  assert.deepEqual(argv[1].slice(0, 6), ['exec', '--sandbox', 'workspace-write', '--approve-for-me', 'resume', '--json']);
  assert.ok(argv[1].includes('codex-thread-1'));
});

test('Codex graceful stop finishes the leg and a restarted controller resumes the persisted thread', async t => {
  const repo = committedPlanRepo();
  const { file, env } = codexScenario(repo, [{ sleepMs: 400, ledger: ['wave 1: merged'], result: 'progress' }, { ledger: ['plan: complete'], result: 'RELAY_LEG: DONE' }]);
  const marathon = startMarathon([repo.planPath, '--harness', 'codex', '--hours', '1'], { cwd: repo.dir, env });
  t.after(() => marathon.child.kill('SIGTERM'));
  assert.ok(await waitFor(() => existsSync(file + '.pid')));
  assert.equal(runCli(['marathon', repo.planPath, '--stop'], { cwd: repo.dir, env }).code, 0);
  const stopped = await marathon.exited;
  assert.equal(stopped.code, 3, stopped.out);
  assert.equal(JSON.parse(readFileSync(repo.state, 'utf8')).legs.length, 1);
  const resumed = runCli(['marathon', repo.planPath, '--harness', 'codex', '--hours', '1'], { cwd: repo.dir, env });
  assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
  const argv = readFileSync(file + '.argv', 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(argv[1].includes('resume'));
  assert.ok(argv[1].includes('codex-thread-1'));
});

test('Codex stop-now terminates its live leg and preserves the thread for continuation', async t => {
  const repo = committedPlanRepo();
  const { file, env } = codexScenario(repo, [{ sleepMs: 60_000, result: 'unreachable' }]);
  const marathon = startMarathon([repo.planPath, '--harness', 'codex', '--hours', '1'], { cwd: repo.dir, env });
  t.after(() => marathon.child.kill('SIGTERM'));
  assert.ok(await waitFor(() => existsSync(file + '.pid')));
  const legPid = Number(readFileSync(file + '.pid', 'utf8'));
  assert.equal(runCli(['marathon', repo.planPath, '--stop', '--now'], { cwd: repo.dir, env }).code, 0);
  assert.equal((await marathon.exited).code, 143);
  assert.ok(await waitFor(() => !alive(legPid), 3000));
  assert.equal(JSON.parse(readFileSync(repo.state, 'utf8')).sessionId, 'codex-thread-1');
});

test('a marathon deadline interrupts a running Codex leg rather than waiting for it to finish', async t => {
  const repo = committedPlanRepo();
  const { file, env } = codexScenario(repo, [{ sleepMs: 60_000, result: 'unreachable' }]);
  const marathon = startMarathon([repo.planPath, '--harness', 'codex', '--hours', '0.0002'], { cwd: repo.dir, env });
  t.after(() => marathon.child.kill('SIGTERM'));
  assert.ok(await waitFor(() => existsSync(file + '.pid')));
  const legPid = Number(readFileSync(file + '.pid', 'utf8'));
  const completed = await Promise.race([marathon.exited, new Promise(resolve => setTimeout(() => resolve(undefined), 4000))]);
  if (!completed) marathon.child.kill('SIGTERM');
  assert.ok(completed, 'running leg is bounded by the wall-clock deadline');
  assert.equal(completed.code, 2, completed.out);
  assert.match(JSON.parse(readFileSync(repo.state, 'utf8')).stopReason, /deadline reached/);
  assert.ok(await waitFor(() => !alive(legPid), 3000));
});

test('Codex JSONL errors retain the native session and use reported windows for rate-limit waits', () => {
  const result = parseCodexJson('noise\n{"type":"thread.started","thread_id":"thread-7"}\n{"type":"turn.failed","error":{"message":"rate_limit_exceeded"}}\n');
  assert.deepEqual(result, { session_id: 'thread-7', result: '', is_error: true, error: 'rate_limit_exceeded' });
  const outcome = classifyLeg({ result, budget: { windows: [{ id: 'primary', usedPercent: 100, windowMinutes: 10080, resetsAt: '2026-10-20T12:00:00Z' }] }, now: NOW });
  assert.deepEqual(outcome, { kind: 'limit', which: 'account', resetsAt: '2026-10-20T12:00:00Z', reason: 'usage limit (account)' });
  assert.equal(parseCodexJson('{"type":"error","message":"authentication failed"}').error, 'authentication failed');
  assert.equal(parseCodexJson('not JSON'), undefined);
});

test('Codex does not start a new leg when its critical account window resets after the deadline', () => {
  const repo = committedPlanRepo();
  const { file, env } = codexScenario(repo, [{ result: 'unreachable' }], { initialBudget: { primary: { usedPercent: 99, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 7200 } } });
  const run = runCli(['marathon', repo.planPath, '--harness', 'codex', '--hours', '1'], { cwd: repo.dir, env });
  assert.equal(run.code, 2, run.stdout + run.stderr);
  assert.match(JSON.parse(readFileSync(repo.state, 'utf8')).stopReason, /after the deadline/);
  assert.equal(existsSync(file + '.argv'), false);
});
