import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { computeLanes, pathsOverlap, segmentsFor } from '../lib/lanes.mjs';
import { parsePlan, validatePlan } from '../lib/plan.mjs';
import { FIXTURES, runCli, tempRepo } from './helpers.mjs';

const task = (id, files, extra = {}) => ({ id, title: id, tier: 'mid', risk: 'low', files, deps: [], tests: 0, behaviors: [], code: 'prose', done: 'true', ...extra });
const lanesOf = (tasks, opts) => computeLanes({ slug: 's', tasks }, opts);
const shape = (res) => res.waves.map((w) => w.lanes.map((l) => l.tasks.join('+')));

test('paths overlap on equality, directory prefixes and globs', () => {
  assert.ok(pathsOverlap('src/a.ts', './src/a.ts'));
  assert.ok(pathsOverlap('src/billing/', 'src/billing/round.ts'));
  assert.ok(pathsOverlap('src/**/*.ts', 'src/x/y.ts'));
  assert.ok(!pathsOverlap('src/a.ts', 'src/ab.ts'));
  assert.ok(!pathsOverlap('src/billing/', 'src/billing-old/x.ts'));
});

test('tasks sharing a file share a lane; independent tasks run in parallel', () => {
  const res = lanesOf([task('A', ['x.ts']), task('B', ['y.ts']), task('C', ['x.ts', 'z.ts'])]);
  assert.deepEqual(shape(res), [['A+C', 'B']]);
});

test('a dependency chain folds into one lane (no merge between steps)', () => {
  const res = lanesOf([task('A', ['a']), task('B', ['b'], { deps: ['A'] }), task('C', ['c'], { deps: ['B'] })]);
  assert.deepEqual(shape(res), [['A+B+C']]);
});

test('a diamond keeps its parallel middle as a second wave', () => {
  const res = lanesOf([
    task('A', ['a']),
    task('B', ['b'], { deps: ['A'] }),
    task('C', ['c'], { deps: ['A'] }),
    task('D', ['d'], { deps: ['B', 'C'] }),
  ]);
  assert.deepEqual(shape(res), [['A'], ['B', 'C'], ['D']]);
});

test('chain folding stops at maxLaneTasks', () => {
  const tasks = ['A', 'B', 'C', 'D'].map((id, i, all) => task(id, [id], { deps: i ? [all[i - 1]] : [] }));
  const res = lanesOf(tasks, { maxLaneTasks: 2 });
  assert.deepEqual(shape(res), [['A+B'], ['C+D']]);
});

test('a wave with too many lanes packs the smallest together', () => {
  const tasks = ['A', 'B', 'C', 'D', 'E'].map((id) => task(id, [id]));
  const res = lanesOf(tasks, { maxParallelLanes: 3 });
  assert.equal(res.waves[0].lanes.length, 3);
  assert.equal(res.waves[0].lanes.flatMap((l) => l.tasks).length, 5);
});

test('lane order inside respects dependencies even against plan order', () => {
  const res = lanesOf([task('B', ['x'], { deps: ['A'] }), task('A', ['x'])]);
  assert.deepEqual(shape(res), [['A+B']]);
});

test('strong tasks get their own agent segment in the same lane', () => {
  const segs = segmentsFor([task('A', ['x']), task('B', ['x'], { tier: 'strong' }), task('C', ['x'])]);
  assert.deepEqual(segs.map((s) => [s.agent, s.role, s.tasks.join('+')]), [
    [null, 'implementer', 'A'],
    ['s2', 'implementer-deep', 'B'],
    ['s3', 'implementer', 'C'],
  ]);
  const fast = segmentsFor([task('A', ['x'], { tier: 'cheap', code: 'complete' })]);
  assert.equal(fast[0].role, 'implementer-fast');
});

test('the fixture plan parses, validates and partitions as designed', () => {
  const plan = parsePlan(readFileSync(join(FIXTURES, 'plan-basic.md'), 'utf8'));
  assert.deepEqual(validatePlan(plan).errors, []);
  assert.match(plan.sections.T2, /^### T2: CSV writer/);
  assert.match(plan.globalConstraints, /cents/);
  const res = computeLanes(plan);
  assert.deepEqual(shape(res), [['T1+T2', 'T4', 'T5'], ['T3+T6']]);
  const last = res.waves[1].lanes[0];
  assert.deepEqual(last.segments.map((s) => s.role), ['implementer', 'implementer-deep']);
});

test('validation catches duplicate ids, unknown deps, cycles and missing fields', () => {
  const bad = {
    slug: 'Bad Slug',
    sections: {},
    tasks: [task('A', ['a'], { deps: ['B'] }), task('B', ['b'], { deps: ['A'] }), task('C', [], { tier: 'huge', deps: ['Z'] }), task('C', ['c'])],
  };
  const { errors } = validatePlan(bad);
  const text = errors.join('\n');
  assert.match(text, /slug must be kebab-case/);
  assert.match(text, /duplicate id/);
  assert.match(text, /unknown task Z/);
  assert.match(text, /dependency cycle/);
  assert.match(text, /tier must be one of/);
  assert.match(text, /files must list/);
});

test('validation warns about test budgets that do not match risk', () => {
  const plan = { slug: 'ok', sections: {}, tasks: [task('A', ['a'], { risk: 'low', tests: 3, behaviors: ['x', 'y', 'z'] }), task('B', ['b'], { risk: 'high', tests: 0 })] };
  const { warnings } = validatePlan(plan);
  assert.ok(warnings.some((w) => /low risk with 3 new tests/.test(w)));
  assert.ok(warnings.some((w) => /high risk with no new test/.test(w)));
});

test('relay lanes: a plan without flow runs as feature; a builder role is its own segment; a reviewer role is rejected', () => {
  const planText = (role2) => {
    const t = (id, files, extra = {}) => ({ id, title: id, tier: 'mid', risk: 'low', files, tests: 0, done: 'true', ...extra });
    const block = { slug: 'roles', suite: 'true', tasks: [t('T1', ['src/a.mjs']), t('T2', ['infra/main.tf'], { role: role2, deps: ['T1'] }), t('T3', ['src/a.mjs'], { deps: ['T2'] })] };
    return `# Roles Plan\n\n**Goal:** g\n**Spec:** s\n\n## Tasks\n\n### T1: T1\nx\n\n### T2: T2\nx\n\n### T3: T3\nx\n\n\`\`\`relay-plan\n${JSON.stringify(block, null, 2)}\n\`\`\`\n`;
  };
  const { dir } = tempRepo();
  const env = { RELAY_HOME: mkdtempSync(join(tmpdir(), 'relay-home-')) };
  const plan = join(dir, 'docs/relay/plans/roles.md');
  mkdirSync(join(dir, 'docs/relay/plans'), { recursive: true });
  writeFileSync(plan, planText('platform-engineer'));
  const ok = runCli(['lanes', plan, '--json'], { cwd: dir, env });
  assert.equal(ok.code, 0, ok.stderr);
  const lanes = JSON.parse(ok.stdout);
  assert.equal(lanes.flow, 'feature');
  const lane = lanes.waves[0].lanes[0];
  assert.equal(lanes.waves[0].lanes.length, 1);
  assert.deepEqual(lane.segments.map((s) => [s.agent, s.role, s.tasks.join('+')]), [[null, 'implementer', 'T1'], ['s2', 'platform-engineer', 'T2'], ['s3', 'implementer', 'T3']]);
  assert.ok(lane.pieces.some((p) => p.piece === 'platform-review'));
  writeFileSync(plan, planText('reviewer'));
  const bad = runCli(['lanes', plan, '--json'], { cwd: dir, env });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /task T2: role "reviewer" is a reviewer; a task's role must be a builder/);
});
