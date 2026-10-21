import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkFlow, checkRoles, checkSkills, claudeAgent, codexAgent, injectModRouting, main } from '../scripts/build.mjs';
import { checkRoutines } from '../lib/routines/templates.mjs';
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
  assert.match(md, /^disallowedTools: Edit, Write, NotebookEdit$/m);
  assert.match(md, /^description: "Reviews: lanes"$/m);
});

test('codex agent gets the codex model and a read-only instruction', () => {
  const toml = codexAgent(role, routing);
  assert.match(toml, /^name = "relay-reviewer"$/m);
  assert.match(toml, /^model = "gpt-6\.1-sol"$/m);
  assert.match(toml, /^model_reasoning_effort = "medium"$/m);
  assert.match(toml, /You are read-only/);
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

test('build --check fails for a piece with an unknown role, a piece placed outside its slots, and a role without its profile, and a routine with an unknown check or a bad schedule', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-flow-'));
  for (const d of ['agents', 'bin', 'codex', 'config', 'flows', 'hooks', 'pieces', 'roles', 'skills']) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
  assert.equal(main(['--check'], dir), 0);
  const ghost = JSON.parse(readFileSync(join(dir, 'pieces', 'platform-review.json'), 'utf8'));
  writeFileSync(join(dir, 'pieces', 'ghost.json'), JSON.stringify({ ...ghost, id: 'ghost', role: 'no-such-role' }));
  const featurePath = join(dir, 'flows', 'feature.json');
  const feature = JSON.parse(readFileSync(featurePath, 'utf8'));
  feature.slots['lane.after'].push('requirements');
  writeFileSync(featurePath, JSON.stringify(feature));
  const scoutPath = join(dir, 'roles', 'scout.md');
  writeFileSync(scoutPath, readFileSync(scoutPath, 'utf8').replace(/## Never\n[^\n]*\n/, ''));
  const flowProblems = checkFlow(dir).join('\n');
  assert.match(flowProblems, /pieces\/ghost\.json: role "no-such-role" is not a role/);
  assert.match(flowProblems, /flows\/feature\.json: piece "requirements" cannot sit at lane\.after/);
  assert.match(checkRoles(dir).join('\n'), /roles\/scout\.md: profile section "## Never"/);
  mkdirSync(join(dir, 'routines'));
  writeFileSync(join(dir, 'routines', 'ghost.json'), JSON.stringify({ id: 'ghost', title: 'Ghost', kind: 'passive', type: 'check', check: 'no-such-check', schedule: { days: ['mon'], at: '09:00' }, cap: { runsPerWeek: 7 } }));
  writeFileSync(join(dir, 'routines', 'late.json'), JSON.stringify({ id: 'late', title: 'Late', kind: 'active', type: 'prompt', prompt: 'hi', schedule: { days: ['mon'], at: '25:00' } }));
  const routineProblems = checkRoutines(dir).join('\n');
  assert.match(routineProblems, /routines\/ghost\.json: check "no-such-check" has no module/);
  assert.match(routineProblems, /routines\/late\.json: schedule\.at "25:00"/);
  assert.equal(main(['--check'], dir), 1);
});
