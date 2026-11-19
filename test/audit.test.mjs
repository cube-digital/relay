import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditText } from '../lib/audit.mjs';
import { runCli } from './helpers.mjs';

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-audit-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

test("relay's own roles, skills and commands carry no prompt debt", () => {
  const r = runCli(['audit']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^0 error\(s\), 0 warning\(s\)$/m);
});

test('a ritual written for older models fails the audit with its file and line', () => {
  const dir = fixture({ 'skills/x/SKILL.md': '---\nname: x\ndescription: d\n---\nRead the brief.\nThink step by step before you edit.\n' });
  const r = runCli(['audit', 'skills'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /✗ skills\/x\/SKILL\.md:6 ritual-step-by-step/);
});

test('shouted rules fail; quoted phrases and severity labels pass', () => {
  const ids = (text) => auditText(text, 'f.md').map((f) => f.rule);
  assert.deepEqual(ids('IMPORTANT: run the tests.'), ['shouting']);
  assert.deepEqual(ids('Do not write `think step by step` in a prompt.'), []);
  assert.deepEqual(ids('Label each finding Critical, Important, or Minor.'), []);
});

test('an absolute without its reason is a warning; with a reason or in the profile section it passes', () => {
  const rules = (text) => auditText(text, 'r.md').map((f) => `${f.level}:${f.rule}`);
  assert.deepEqual(rules('Never dispatch subagents.'), ['warn:bare-never']);
  assert.deepEqual(rules('Never dispatch subagents: review comes from the orchestrator.'), []);
  assert.deepEqual(rules('## Never\n- Runs the full suite.\n- Never edits protected tests.'), []);
  const r = runCli(['audit', 'roles'], { cwd: fixture({ 'roles/a.md': 'Never dispatch subagents.\n' }) });
  assert.equal(r.code, 0, 'warnings alone do not fail the audit');
  assert.match(r.stdout, /! roles\/a\.md:1 bare-never/);
});
