import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codexRouting } from '../lib/codex-integration.mjs';
import { loadCodexRouting } from '../codex-math/lib/harness.mjs';
import { runCli, tempRepo } from './helpers.mjs';

function fourLanePlan() {
  const tasks = ['a', 'b', 'c', 'd'].map((x, i) => ({
    id: `T${i + 1}`, title: `Task ${x}`, tier: 'cheap', code: 'complete', risk: 'low', files: [`src/${x}.ts`], tests: 0, done: 'true',
  }));
  const body = ['# Four Plan', '', '**Goal:** g', '**Spec:** s', '', '## Global Constraints', '', '- none', '', '## Tasks', '',
    ...tasks.flatMap((t) => [`### ${t.id}: ${t.title}`, 'Work.', '']),
    '```relay-plan', JSON.stringify({ slug: 'four', suite: 'true', tasks }, null, 2), '```', ''].join('\n');
  const { dir } = tempRepo({ 'plan.md': body });
  return { dir, plan: `${dir}/plan.md` };
}

const lanesInWave1 = (stdout) => JSON.parse(stdout).waves[0].lanes.length;

test('under Codex a wave holds at most 3 lanes; Claude keeps 4', () => {
  const { dir, plan } = fourLanePlan();
  const codex = runCli(['lanes', plan, '--harness', 'codex', '--json'], { cwd: dir });
  const claude = runCli(['lanes', plan, '--harness', 'claude', '--json'], { cwd: dir });
  assert.equal(codex.code, 0, codex.stderr);
  assert.equal(claude.code, 0, claude.stderr);
  assert.equal(lanesInWave1(codex.stdout), 3);
  assert.equal(lanesInWave1(claude.stdout), 4);
});

test('the Codex forecast caps parallelism at 3 and --max-lanes overrides it', () => {
  const { dir, plan } = fourLanePlan();
  const capped = runCli(['forecast', plan, '--harness', 'codex', '--json'], { cwd: dir });
  const wide = runCli(['forecast', plan, '--harness', 'codex', '--max-lanes', '4', '--json'], { cwd: dir });
  assert.equal(capped.code, 0, capped.stderr);
  assert.equal(wide.code, 0, wide.stderr);
  assert.equal(JSON.parse(capped.stdout).parallel.cap, 3);
  assert.equal(JSON.parse(wide.stdout).parallel.cap, 4);
});

test('codexRouting uses the Codex forecast constants and tiers unchanged', () => {
  const source = loadCodexRouting();
  const routing = codexRouting();
  assert.deepEqual(routing.forecast, source.forecast);
  assert.deepEqual(routing.tiers, source.tiers);
});
