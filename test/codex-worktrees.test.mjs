import assert from 'node:assert/strict';
import { test } from 'node:test';
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

test('worktrees sync partitions wave 1 like lanes: 3 lanes under Codex, 4 under Claude', () => {
  const count = (harness) => {
    const { dir, plan } = fourLanePlan();
    const r = runCli(['worktrees', 'sync', plan, '--harness', harness], { cwd: dir });
    assert.equal(r.code, 0, r.stderr);
    return runCli(['worktrees', 'status', plan, '--harness', harness], { cwd: dir }).stdout.split('\n').filter((l) => /lane/i.test(l)).length;
  };
  assert.equal(count('claude') - count('codex'), 1);
});
