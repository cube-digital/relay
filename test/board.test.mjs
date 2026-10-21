import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { computeBoard, formatBoard, taskOfCommit } from '../lib/board.mjs';
import { renderBoardHtml } from '../lib/board-html.mjs';
import { computeLanes } from '../lib/lanes.mjs';
import { parsePlan } from '../lib/plan.mjs';
import { copyFixture, FIXTURES, runCli, tempRepo } from './helpers.mjs';

const plan = parsePlan(readFileSync(join(FIXTURES, 'plan-basic.md'), 'utf8'));
const lanes = computeLanes(plan);
const board = (facts) => computeBoard({ plan, lanes, planPath: 'p.md', facts: { ledgerText: '', ...facts } });
const stateOf = (b, id) => b.waves.flatMap((w) => w.lanes.flatMap((l) => l.tasks)).find((t) => t.id === id).state;
const lane = (b, id) => b.waves.flatMap((w) => w.lanes).find((l) => l.id === id);

test('a task is green only from its own commit; the tests written for it do not count', () => {
  const ids = new Set(['T1', 'T2']);
  assert.equal(taskOfCommit('T1: Export schema', ids), 'T1');
  assert.equal(taskOfCommit('T1: acceptance tests', ids), undefined);
  assert.equal(taskOfCommit('T1, T2: acceptance tests', ids), undefined);
  assert.equal(taskOfCommit('T9: elsewhere', ids), undefined);
  assert.equal(taskOfCommit('fix: test script', ids), undefined);
});

test('lights follow the run: planned, in progress, done, merged, blocked', () => {
  const before = board({});
  assert.equal(before.status, 'planned');
  assert.equal(before.totals.planned, 6);

  const ledgerText = [
    '- 2026-10-20 10:00 [5h 10%] start: 6 tasks, 4 lanes, 2 waves',
    '- 2026-10-20 10:20 [5h 14%] Lane c: fix round 2/5 (1 addressed, 1 open)',
  ].join('\n');
  const mid = board({ ledgerText, laneSubjects: { a: ['T1: acceptance tests', 'T1: Export schema'], b: ['T4: README section'] }, integrationSubjects: ['T4: README section'] });
  assert.equal(mid.status, 'running');
  assert.equal(stateOf(mid, 'T1'), 'done', 'committed on its lane');
  assert.equal(stateOf(mid, 'T2'), 'working', 'its wave started, no commit yet');
  assert.equal(stateOf(mid, 'T4'), 'merged');
  assert.equal(stateOf(mid, 'T5'), 'working');
  assert.equal(lane(mid, 'c').note, 'fix round 2/5');
  assert.equal(stateOf(mid, 'T3'), 'planned', 'wave 2 has not started');
  assert.deepEqual([mid.green, mid.currentWave], [2, 1]);

  const blocked = board({ ledgerText: ledgerText + '\n- 2026-10-20 10:40 lane-c: BLOCKED — the spec contradicts the plan' });
  assert.equal(stateOf(blocked, 'T5'), 'blocked');
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.waves[0].state, 'blocked');

  const piece = (status, path) => board({ ledgerText: ledgerText + `\n- 2026-10-20 10:45 piece platform-review lane b: ${status} (${path})` });
  assert.notEqual(lane(piece('pass', '.relay/runs/x/blocked-notes.md'), 'b').state, 'blocked', 'a report path is not a status');
  assert.equal(lane(piece('blocked', '.relay/runs/x/notes.md'), 'b').state, 'blocked');

  const failed = board({ ledgerText: ledgerText + '\n- 2026-10-20 11:00 wave 1: merged @ abc, suite fail' });
  assert.equal(failed.waves[0].state, 'blocked', 'a red suite holds the wave');
  const fixed = board({ ledgerText: ledgerText + '\n- 2026-10-20 11:00 wave 1: merged @ abc, suite fail\n- 2026-10-20 11:10 wave 1: merged @ abd, suite pass' });
  assert.equal(fixed.waves[0].state, 'merged');
  assert.equal(fixed.currentWave, 2);

  const done = board({ ledgerText: ledgerText + '\n- 2026-10-20 12:00 Ruling: parked a minor — cosmetic\n- 2026-10-20 12:01 plan: complete (relay/billing-export/integration @ x)' });
  assert.equal(done.status, 'complete');
  assert.equal(done.green, 6);
  assert.deepEqual(done.rulings, ['parked a minor — cosmetic']);
  assert.match(formatBoard(done), /6\/6 tasks green · complete/);
});

test('the roadmap page carries the board and escapes what it shows', () => {
  const b = board({ ledgerText: '- 2026-10-20 10:00 start: x\n- 2026-10-20 10:01 Ruling: </script><b>x</b>' });
  const html = renderBoardHtml(b);
  assert.ok(!html.includes('</script><b>'), 'no way out of the data block');
  assert.match(html, /"slug":"billing-export"/);
  assert.match(html, /location\.reload/, 'a running board reloads itself');
  assert.doesNotMatch(renderBoardHtml(board({})), /location\.reload/, 'a board that is not running stays still');
});

test('relay board reads real branches, and ledger and worktree calls keep board.json and the page current', () => {
  const { dir, git } = tempRepo();
  const planPath = copyFixture('plan-basic.md', dir);
  git('add', '-A');
  git('commit', '-qm', 'plan');
  const json = () => JSON.parse(readFileSync(join(dir, '.relay', 'board.json'), 'utf8'));

  let r = runCli(['board', planPath, '--html'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /0\/6 tasks green · not started/);
  const page = join(dir, '.relay', 'runs', 'billing-export', 'board.html');
  assert.ok(existsSync(page));

  runCli(['ledger', planPath, 'start: 6 tasks, 4 lanes, 2 waves'], { cwd: dir });
  assert.equal(json().status, 'running', 'a ledger line refreshes the board');
  r = runCli(['worktrees', 'sync', planPath, '--wave', '1'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  const active = JSON.parse(readFileSync(join(dir, '.relay', 'lanes', 'active.json'), 'utf8'));
  const commit = (wt, file, msg) => {
    mkdirSync(join(wt, file, '..'), { recursive: true });
    writeFileSync(join(wt, file), `${msg}\n`);
    git('-C', wt, 'add', '-A');
    git('-C', wt, 'commit', '-qm', msg);
  };
  commit(active.lanes.a.worktree, 'src/export/schema.ts', 'T1: Export schema');
  commit(active.lanes.b.worktree, 'README.md', 'T4: README section');
  runCli(['ledger', planPath, 'Lane a: T1 DONE, T2 in progress'], { cwd: dir });
  let b = json();
  assert.deepEqual([stateOf(b, 'T1'), stateOf(b, 'T2'), stateOf(b, 'T4'), stateOf(b, 'T3')], ['done', 'working', 'done', 'planned']);
  r = runCli(['worktrees', 'merge', planPath, '--wave', '1'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  b = json();
  assert.deepEqual([stateOf(b, 'T1'), stateOf(b, 'T4')], ['merged', 'merged'], 'a merge refreshes the board');
  assert.match(readFileSync(page, 'utf8'), /"T1","title":"Export schema"[^}]*"state":"merged"/, 'and the page');
});
