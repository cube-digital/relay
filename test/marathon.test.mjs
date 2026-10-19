import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { classifyLeg, decideNext, parseClaudeJson, parseResetTime } from '../lib/marathon.mjs';
import { legArgs } from '../scripts/relay-marathon.mjs';
import { copyFixture, ROOT, runCli, tempRepo } from './helpers.mjs';

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
