// Acceptance tests for T3: relay routine enable | confirm | disable on Codex and Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, runCli, tempRepo } from './helpers.mjs';
import { parseToml } from '../lib/hq/toml.mjs';
import { loadRouting } from '../lib/routing.mjs';

function setup() {
  const RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-home-'));
  const HOME = mkdtempSync(join(tmpdir(), 'relay-codexhome-'));
  const env = { RELAY_HOME, HOME };
  const { dir } = tempRepo();
  assert.equal(runCli(['hq', 'add', dir], { env }).code, 0);
  const made = runCli(['routine', 'new', 'tidy', '--prompt', 'Tidy up', '--kind', 'passive', '--days', 'mon,wed', '--at', '07:30'], { env });
  assert.equal(made.code, 0, made.stderr);
  const enabledPath = join(RELAY_HOME, 'routines', 'enabled.json');
  const instances = () => JSON.parse(readFileSync(enabledPath, 'utf8')).instances;
  return { env, dir, HOME, enabledPath, instances };
}

test('enable --harness codex writes only its relay folder, and needs a harness and Codex', () => {
  const { env, dir, HOME, enabledPath, instances } = setup();

  const noCodex = runCli(['routine', 'enable', 'tidy', '--harness', 'codex', '--repo', dir], { env });
  assert.equal(noCodex.code, 1);
  assert.equal(existsSync(enabledPath), false);
  assert.equal(existsSync(join(HOME, '.codex', 'automations')), false);

  const other = join(HOME, '.codex', 'automations', 'user-thing');
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, 'automation.toml'), 'id = "user-thing"\n');
  const before = readFileSync(join(other, 'automation.toml'));

  assert.equal(runCli(['routine', 'enable', 'tidy', '--repo', dir], { env }).code, 64);

  const ok = runCli(['routine', 'enable', 'tidy', '--harness', 'codex', '--repo', dir], { env });
  assert.equal(ok.code, 0, ok.stderr);
  const [inst] = instances();
  assert.match(inst.id, /^tidy@/);
  const folder = join(HOME, '.codex', 'automations', `relay-${inst.id.replace('@', '-')}`);
  const parsed = parseToml(readFileSync(join(folder, 'automation.toml'), 'utf8'));
  assert.equal(parsed.ok, true);
  const t = parsed.value;
  const cheap = loadRouting().tiers.cheap.codex;
  assert.equal(t.rrule, 'RRULE:FREQ=WEEKLY;BYHOUR=7;BYMINUTE=30;BYDAY=MO,WE');
  assert.equal(t.model, cheap.model);
  assert.equal(t.reasoning_effort, cheap.effort);
  assert.deepEqual(t.cwds, [realpathSync(dir)]);
  assert.ok(t.prompt.includes(join(ROOT, 'bin', 'relay')));
  assert.ok(t.prompt.includes('routine run tidy@'));
  assert.equal(existsSync(join(folder, 'memory.md')), true);

  const off = runCli(['routine', 'disable', inst.id], { env });
  assert.equal(off.code, 0, off.stderr);
  assert.equal(existsSync(folder), false);
  assert.deepEqual(readdirSync(join(HOME, '.codex', 'automations')), ['user-thing']);
  assert.deepEqual(readFileSync(join(other, 'automation.toml')), before);
});

test('enable --harness claude prints the proposal and records pending until confirm', () => {
  const { env, dir, instances } = setup();

  const res = runCli(['routine', 'enable', 'tidy', '--harness', 'claude', '--repo', dir], { env });
  assert.equal(res.code, 0, res.stderr);
  const line = res.stdout.split('\n').find((l) => l.startsWith('RELAY_PROPOSAL: '));
  const proposal = JSON.parse(line.slice('RELAY_PROPOSAL: '.length));
  const [pending] = instances();
  assert.equal(proposal.cronExpression, '30 7 * * 1,3');
  assert.equal(proposal.taskId, 'relay-' + pending.id.replace('@', '-'));
  assert.ok(proposal.prompt.includes(`routine run ${pending.id}`));
  assert.equal(pending.harness, 'claude');
  assert.equal(pending.registration.state, 'pending');

  const done = runCli(['routine', 'confirm', pending.id, '--task-id', proposal.taskId], { env });
  assert.equal(done.code, 0, done.stderr);
  const [active] = instances();
  assert.equal(active.registration.state, 'active');
  assert.equal(active.registration.taskId, proposal.taskId);
});
