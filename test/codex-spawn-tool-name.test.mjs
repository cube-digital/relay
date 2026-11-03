import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, tempRepo, runHook } from './helpers.mjs';

// Codex 0.163 reports the V2 spawn tool as `collaborationspawn_agent` and matches hook matchers against the whole name.
const TOOL = 'collaborationspawn_agent';

test('the generated Codex spawn matcher matches the V2 tool name as a whole', () => {
  for (const file of ['hooks.json', 'hooks.plugin.json']) {
    const { hooks } = JSON.parse(readFileSync(join(ROOT, 'codex', file), 'utf8'));
    const spawn = hooks.PreToolUse.find((h) => h.hooks.some((c) => c.command.includes('codex-spawn.mjs')));
    assert.match(TOOL, new RegExp(`^(?:${spawn.matcher})$`), file);
  }
});

test('a V2 role spawn without a model is routed to the role tier', () => {
  const { dir } = tempRepo();
  const res = runHook('codex-spawn.mjs', { tool_name: TOOL, tool_input: { agent_type: 'relay-scout', task_name: 'scout', fork_turns: 'none', message: 'Find add' } }, { RELAY_HOME: join(dir, 'home'), CODEX_HOME: join(dir, 'empty') });
  const out = JSON.parse(res.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'allow');
  assert.equal(out.updatedInput.model, 'gpt-6-luna');
  assert.equal(out.updatedInput.reasoning_effort, 'low');
});
