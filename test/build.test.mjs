import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkSkills, claudeAgent, codexAgent, injectModRouting, main } from '../scripts/build.mjs';
import * as build from '../scripts/build.mjs';
import { loadCodexRouting, loadHarness } from '../codex-math/lib/harness.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { ROOT, runCli } from './helpers.mjs';

const routing = loadRouting();
const role = { name: 'reviewer', tier: 'mid', description: 'Reviews: lanes', tools: ['Read', 'Grep'], readonly: true, maxTurns: 5, body: 'Body.' };

test('generated files are up to date and skills are portable', () => {
  assert.equal(main(['--check'], ROOT), 0);
});

test('claude agent gets model, effort and read-only guard from the routing table', () => {
  const md = claudeAgent(role, routing);
  assert.match(md, /^model: sonnet$/m);
  assert.match(md, /^effort: medium$/m);
  assert.match(md, /^disallowedTools: Edit, NotebookEdit$/m);
  assert.match(md, /^description: "Reviews: lanes"$/m);
});

test('codex agent leaves dispatch model precedence intact and permits assigned report output', () => {
  const toml = codexAgent(role, routing);
  assert.match(toml, /^name = "relay-reviewer"$/m);
  assert.doesNotMatch(toml, /^model(?:_reasoning_effort)? =/m);
  assert.match(toml, /Do not create, change, or delete project code\./);
  assert.match(toml, /Do not commit\./);
  assert.match(toml, /Write only the report file that the caller assigns\./);
});

test('both renderers preserve protected literals and role contracts', () => {
  const fixture = {
    name: 'literal-fixture', tier: 'mid', description: 'Checks protected literals',
    tools: ['Read', 'Grep', 'Bash', 'Write'], readonly: true, maxTurns: 17,
    body: 'Read src/cache-v2.ts.\nRun node bin/relay build --check.\nUse fork_turns: "none" and reasoning_effort.\nReturn DONE_WITH_CONCERNS.\nQuote: "Entries expire after 60 seconds."',
  };
  const claude = claudeAgent(fixture, routing);
  const codex = codexAgent(fixture, routing);
  assert.match(claude, /^name: literal-fixture$/m);
  assert.match(claude, /^model: sonnet$/m);
  assert.match(claude, /^effort: medium$/m);
  assert.match(claude, /^tools: Read, Grep, Bash, Write$/m);
  assert.match(claude, /^disallowedTools: Edit, NotebookEdit$/m);
  assert.match(claude, /^maxTurns: 17$/m);
  assert.equal(claude.slice(claude.indexOf('\n---\n') + 5), fixture.body + '\n');
  assert.match(codex, /^name = "relay-literal-fixture"$/m);
  assert.doesNotMatch(codex, /^model(?:_reasoning_effort)? =/m);
  assert.equal(codex.slice(codex.indexOf("developer_instructions = '''\n")),
    "developer_instructions = '''\n" +
    'Do not create, change, or delete project code. Do not commit. Write only the report file that the caller assigns.\n\n' +
    fixture.body + "\n'''\n");
});

test('the mod routing block is replaced between its markers only', () => {
  const src = 'a\n// <relay:generated> note\nconst ROUTING = {} as const satisfies Routing\n// </relay:generated>\nb\n';
  const out = injectModRouting(src, { x: 1 });
  assert.match(out, /^a\n\/\/ <relay:generated> note\nconst ROUTING = \{\n {2}"x": 1\n\} as const satisfies Routing\n\/\/ <\/relay:generated>\nb\n$/);
});

test('non-portable skill frontmatter is reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-skills-'));
  mkdirSync(join(dir, 'skills', 'x'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'x', 'SKILL.md'), '---\nname: x\ndescription: d\nmodel: opus\n---\nbody\n');
  assert.match(checkSkills(dir).join('\n'), /"model" is not portable/);
});

test('the CLI prints help and validates the bundled template plan', () => {
  assert.match(runCli(['--help']).stdout, /worktrees/);
  const r = runCli(['lanes', join(ROOT, 'skills/plan-with-tiers/template.md')]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /csv-export: 3 tasks → 1 lanes/);
});

test('every hook script referenced by hooks.json exists', () => {
  const hooks = readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8');
  for (const m of hooks.matchAll(/hooks\/([\w-]+\.mjs)/g)) {
    assert.doesNotThrow(() => readFileSync(join(ROOT, 'hooks', m[1])), m[1]);
  }
});

test('build reports codex role tiers that disagree with roles/*.md and roles with no file', () => {
  const problems = build.checkCodexRouting(
    [{ name: 'scout', tier: 'cheap' }],
    { roles: { scout: 'mid', ghost: 'mid' }, tiers: loadCodexRouting().tiers },
    loadHarness());
  assert.equal(problems.length, 2);
  assert.match(problems[0], /roles\.scout/);
  assert.match(problems[1], /roles\.ghost/);
  assert.ok(problems.every((p) => p.startsWith('codex-math/config/codex-routing.json: ')));
});

test('build reports a codex tier whose effort the model does not advertise', () => {
  const tiers = structuredClone(loadCodexRouting().tiers);
  tiers.mid.effort = 'ultra-not-real';
  const problems = build.checkCodexRouting([], { roles: {}, tiers }, loadHarness());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /tiers\.mid: gpt-6\.1-sol does not advertise effort "ultra-not-real"/);
});

test('build reports a codex number that has no source label', () => {
  const problems = build.checkCodexSources({ lanes: { $sources: { maxLaneTasks: 'policy: x' }, maxLaneTasks: 6, maxParallelLanes: 4 } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /lanes\.maxParallelLanes needs a source label/);
});
