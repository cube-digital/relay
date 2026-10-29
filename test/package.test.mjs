import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ROOT, runCli, tempRepo } from './helpers.mjs';

test('packaged resources run outside the source checkout without relay on PATH', () => {
  const payload = realpathSync(mkdtempSync(join(tmpdir(), 'relay-payload-')));
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(manifest.files?.includes('bin'), 'package must declare executable resources');
  for (const entry of manifest.files) cpSync(join(ROOT, entry), join(payload, entry), { recursive: true });
  cpSync(join(ROOT, 'package.json'), join(payload, 'package.json'));
  const result = spawnSync(process.execPath, [join(payload, 'bin/relay'), 'lanes', join(payload, 'skills/plan-with-tiers/template.md')], { cwd: tmpdir(), encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /csv-export: 3 tasks/);
  const forecast = spawnSync(process.execPath, [join(payload, 'bin/relay'), 'forecast', join(payload, 'skills/plan-with-tiers/template.md'), '--harness', 'codex', '--json'], { cwd: tmpdir(), encoding: 'utf8', env: { PATH: '/usr/bin:/bin', RELAY_HOME: join(payload, 'state'), CODEX_HOME: join(payload, 'empty') } });
  assert.equal(forecast.status, 0, forecast.stderr);
  assert.equal(JSON.parse(forecast.stdout).harness, 'codex');
  const spawn = spawnSync(process.execPath, [join(payload, 'hooks/codex-spawn.mjs')], { cwd: tmpdir(), encoding: 'utf8', input: JSON.stringify({ tool_name: 'spawn_agent', tool_input: { agent_type: 'relay-implementer', fork_turns: 'none', message: 'Test dispatch' } }), env: { PATH: '/usr/bin:/bin', RELAY_HOME: join(payload, 'state'), CODEX_HOME: join(payload, 'empty') } });
  assert.equal(spawn.status, 0, spawn.stderr);
  assert.equal(JSON.parse(spawn.stdout).hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(JSON.parse(spawn.stdout).hookSpecificOutput.updatedInput.message, 'Test dispatch');
  const plugin = JSON.parse(readFileSync(join(payload, '.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(plugin.hooks, './codex/hooks.plugin.json');
  assert.equal(plugin.extensions['com.openai'].onboardingSkill, './skills/relay-setup/SKILL.md');
  assert.match(readFileSync(join(payload, plugin.hooks), 'utf8'), /\$\{PLUGIN_ROOT\}/);
  assert.ok(existsSync(join(payload, 'roles/reviewer.md')));
  assert.equal(plugin.skills, './skills/');
  const designResources = [
    'roles/architect.md', 'agents/architect.md', 'codex/agents/relay-architect.toml',
    'skills/relay-design/SKILL.md',
    'skills/relay-design/references/design-method.md',
    'skills/relay-design/references/research.md',
    'skills/relay-design/references/documentation.md',
    'skills/relay-design/references/design-template.md',
    'skills/relay-design/references/review.md',
  ];
  assert.deepEqual(designResources.map(path => readFileSync(join(payload, path), 'utf8')),
    designResources.map(path => readFileSync(join(ROOT, path), 'utf8')));
  assert.equal(readFileSync(join(payload, 'roles/teacher.md'), 'utf8'), readFileSync(join(ROOT, 'roles/teacher.md'), 'utf8'));
  assert.equal(readFileSync(join(payload, 'roles/reverse-engineer.md'), 'utf8'), readFileSync(join(ROOT, 'roles/reverse-engineer.md'), 'utf8'));
  assert.equal(readFileSync(join(payload, 'agents/teacher.md'), 'utf8'), readFileSync(join(ROOT, 'agents/teacher.md'), 'utf8'));
  assert.equal(readFileSync(join(payload, 'agents/reverse-engineer.md'), 'utf8'), readFileSync(join(ROOT, 'agents/reverse-engineer.md'), 'utf8'));
  assert.equal(readFileSync(join(payload, 'codex/agents/relay-teacher.toml'), 'utf8'), readFileSync(join(ROOT, 'codex/agents/relay-teacher.toml'), 'utf8'));
  assert.equal(readFileSync(join(payload, 'codex/agents/relay-reverse-engineer.toml'), 'utf8'), readFileSync(join(ROOT, 'codex/agents/relay-reverse-engineer.toml'), 'utf8'));
  assert.equal(readFileSync(join(payload, 'skills/relay-teach/SKILL.md'), 'utf8'), readFileSync(join(ROOT, 'skills/relay-teach/SKILL.md'), 'utf8'));
  assert.equal(readFileSync(join(payload, 'skills/relay-reverse-engineer/SKILL.md'), 'utf8'), readFileSync(join(ROOT, 'skills/relay-reverse-engineer/SKILL.md'), 'utf8'));
  assert.equal(readFileSync(join(payload, 'skills/research-and-explain/SKILL.md'), 'utf8'), readFileSync(join(ROOT, 'skills/research-and-explain/SKILL.md'), 'utf8'));
  assert.equal(readFileSync(join(payload, 'skills/research-and-explain/references/research.md'), 'utf8'), readFileSync(join(ROOT, 'skills/research-and-explain/references/research.md'), 'utf8'));
  assert.equal(readFileSync(join(payload, 'skills/research-and-explain/references/teaching-method.md'), 'utf8'), readFileSync(join(ROOT, 'skills/research-and-explain/references/teaching-method.md'), 'utf8'));
  const installedRoot = join(realpathSync(join(payload, 'skills/using-relay/SKILL.md')), '../../..');
  assert.equal(readFileSync(join(installedRoot, 'skills/using-relay/references/language-guide.md'), 'utf8'), readFileSync(join(ROOT, 'skills/using-relay/references/language-guide.md'), 'utf8'));
  assert.equal(readFileSync(join(installedRoot, 'skills/using-relay/references/software-glossary.md'), 'utf8'), readFileSync(join(ROOT, 'skills/using-relay/references/software-glossary.md'), 'utf8'));
  const relocatedProject = tempRepo().dir;
  const setup = spawnSync(process.execPath, [join(payload, 'bin/relay'), 'setup', 'codex', relocatedProject], { cwd: tmpdir(), encoding: 'utf8', env: { PATH: '/usr/bin:/bin', RELAY_HOME: join(payload, 'state'), CODEX_HOME: join(payload, 'empty') } });
  assert.equal(setup.status, 0, setup.stderr);
  const designPath = realpathSync(join(relocatedProject, '.agents/skills/relay-design/SKILL.md'));
  assert.equal(designPath, join(payload, 'skills/relay-design/SKILL.md'));
  const designRoot = join(designPath, '../../..');
  assert.equal(designRoot, payload);
  assert.deepEqual(designResources.map(path => readFileSync(join(designRoot, path), 'utf8')),
    designResources.map(path => readFileSync(join(ROOT, path), 'utf8')));
  assert.equal(readFileSync(join(relocatedProject, '.codex/agents/relay-architect.toml'), 'utf8'),
    readFileSync(join(payload, 'codex/agents/relay-architect.toml'), 'utf8'));
  const teachPath = realpathSync(join(relocatedProject, '.agents/skills/relay-teach/SKILL.md'));
  const engineerPath = realpathSync(join(relocatedProject, '.agents/skills/relay-reverse-engineer/SKILL.md'));
  assert.equal(teachPath, join(payload, 'skills/relay-teach/SKILL.md'));
  assert.equal(engineerPath, join(payload, 'skills/relay-reverse-engineer/SKILL.md'));
  const teachRoot = join(teachPath, '../../..');
  const engineerRoot = join(engineerPath, '../../..');
  assert.equal(teachRoot, payload);
  assert.equal(engineerRoot, payload);
  assert.equal(readFileSync(join(teachRoot, 'skills/research-and-explain/SKILL.md'), 'utf8'), readFileSync(join(ROOT, 'skills/research-and-explain/SKILL.md'), 'utf8'));
  assert.equal(readFileSync(join(teachRoot, 'skills/research-and-explain/references/research.md'), 'utf8'), readFileSync(join(ROOT, 'skills/research-and-explain/references/research.md'), 'utf8'));
  assert.equal(readFileSync(join(teachRoot, 'skills/research-and-explain/references/teaching-method.md'), 'utf8'), readFileSync(join(ROOT, 'skills/research-and-explain/references/teaching-method.md'), 'utf8'));
  assert.equal(readFileSync(join(engineerRoot, 'skills/research-and-explain/SKILL.md'), 'utf8'), readFileSync(join(ROOT, 'skills/research-and-explain/SKILL.md'), 'utf8'));
  assert.equal(readFileSync(join(engineerRoot, 'skills/research-and-explain/references/research.md'), 'utf8'), readFileSync(join(ROOT, 'skills/research-and-explain/references/research.md'), 'utf8'));
  assert.equal(readFileSync(join(engineerRoot, 'skills/research-and-explain/references/teaching-method.md'), 'utf8'), readFileSync(join(ROOT, 'skills/research-and-explain/references/teaching-method.md'), 'utf8'));

});

test('fallback setup is repeatable, preserves config and creates missing skills discovery directory', () => {
  const { dir } = tempRepo({ '.codex/config.toml': 'model = "my-model"\n[agents]\nmax_threads = 3\n' });
  const original = readFileSync(join(dir, '.codex/config.toml'), 'utf8');
  assert.equal(runCli(['setup', 'codex', dir]).code, 0);
  assert.equal(runCli(['setup', 'codex', dir]).code, 0);
  assert.equal(readFileSync(join(dir, '.codex/config.toml'), 'utf8'), original);
  assert.ok(existsSync(join(dir, '.agents/skills/relay-plan/SKILL.md')));
  assert.equal(realpathSync(join(dir, '.agents/skills/relay-design/SKILL.md')), join(ROOT, 'skills/relay-design/SKILL.md'));
  assert.equal(readFileSync(join(dir, '.codex/agents/relay-architect.toml'), 'utf8'), readFileSync(join(ROOT, 'codex/agents/relay-architect.toml'), 'utf8'));
  assert.ok(existsSync(join(dir, '.codex/agents/relay-reviewer.toml')));
  assert.equal(realpathSync(join(dir, '.agents/skills/relay-teach/SKILL.md')), join(ROOT, 'skills/relay-teach/SKILL.md'));
  assert.equal(realpathSync(join(dir, '.agents/skills/relay-reverse-engineer/SKILL.md')), join(ROOT, 'skills/relay-reverse-engineer/SKILL.md'));
  assert.equal(readFileSync(join(dir, '.codex/agents/relay-teacher.toml'), 'utf8'), readFileSync(join(ROOT, 'codex/agents/relay-teacher.toml'), 'utf8'));
  assert.equal(readFileSync(join(dir, '.codex/agents/relay-reverse-engineer.toml'), 'utf8'), readFileSync(join(ROOT, 'codex/agents/relay-reverse-engineer.toml'), 'utf8'));

  const discoveredRoot = join(realpathSync(join(dir, '.agents/skills/using-relay/SKILL.md')), '../../..');
  assert.equal(readFileSync(join(discoveredRoot, 'skills/using-relay/references/language-guide.md'), 'utf8'), readFileSync(join(ROOT, 'skills/using-relay/references/language-guide.md'), 'utf8'));
  assert.equal(readFileSync(join(discoveredRoot, 'skills/using-relay/references/software-glossary.md'), 'utf8'), readFileSync(join(ROOT, 'skills/using-relay/references/software-glossary.md'), 'utf8'));
});

test('malformed Codex config is rejected before setup writes any resources', () => {
  const { dir } = tempRepo({ '.codex/config.toml': '[agents\nmax_threads = 3\n' });
  const before = readFileSync(join(dir, '.codex/config.toml'), 'utf8');
  const result = runCli(['setup', 'codex', dir]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /config.*malformed|malformed.*config/i);
  assert.equal(readFileSync(join(dir, '.codex/config.toml'), 'utf8'), before);
  assert.equal(existsSync(join(dir, '.codex/agents')), false);
});

test('setup rejects unterminated TOML values and preserves malformed bytes', () => {
  const { dir } = tempRepo({ '.codex/config.toml': 'model = "unterminated\n' });
  const result = runCli(['setup', 'codex', dir]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /malformed.*config/i);
  assert.equal(readFileSync(join(dir, '.codex/config.toml'), 'utf8'), 'model = "unterminated\n');
  assert.equal(existsSync(join(dir, '.codex/agents')), false);
});

test('native plugin setup avoids duplicate hooks and doctor only reports trust as unknown', () => {
  const { dir } = tempRepo();
  const result = runCli(['setup', 'codex', dir, '--plugin']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(join(dir, '.codex/hooks.json')), false);
  assert.equal(existsSync(join(dir, '.agents/skills/relay-teach')), false);
  assert.equal(existsSync(join(dir, '.agents/skills/relay-reverse-engineer')), false);
  assert.equal(existsSync(join(dir, '.agents/skills/using-relay')), false);
  assert.equal(existsSync(join(dir, '.agents/skills/relay-design')), false);
  assert.equal(readFileSync(join(dir, '.codex/agents/relay-architect.toml'), 'utf8'), readFileSync(join(ROOT, 'codex/agents/relay-architect.toml'), 'utf8'));
  assert.equal(readFileSync(join(dir, '.codex/agents/relay-teacher.toml'), 'utf8'), readFileSync(join(ROOT, 'codex/agents/relay-teacher.toml'), 'utf8'));
  assert.equal(readFileSync(join(dir, '.codex/agents/relay-reverse-engineer.toml'), 'utf8'), readFileSync(join(ROOT, 'codex/agents/relay-reverse-engineer.toml'), 'utf8'));

  const before = readFileSync(join(dir, '.codex/config.toml'), 'utf8');
  const report = runCli(['doctor', '--harness', 'codex', '--project', dir, '--codex-bin', process.execPath]);
  assert.equal(report.code, 0, report.stderr);
  assert.match(report.stdout, /trust: unknown/i);
  assert.match(report.stdout, /agents: 10/);
  assert.equal(readFileSync(join(dir, '.codex/config.toml'), 'utf8'), before);
});
