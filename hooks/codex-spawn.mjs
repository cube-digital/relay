#!/usr/bin/env node
import { readInput } from '../lib/hookio.mjs';
import { readBudget } from '../scripts/relay-budget.mjs';
import { loadHarness, loadCodexRouting } from '../codex-math/lib/harness.mjs';
import { routeSpawn } from '../codex-math/lib/budget.mjs';

try {
  const input = await readInput();
  if (!/(?:^|[.:/])(?:spawn_agent|Agent)$/.test(input.tool_name ?? '')) process.exit(0);
  const args = input.tool_input ?? input.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) process.exit(0);
  const routing = loadCodexRouting();
  const budget = readBudget({ harness: 'codex' });
  const routed = routeSpawn({ subagentType: args.agent_type ?? args.subagent_type, model: args.model, effort: args.reasoning_effort }, budget.level === 'unknown' ? 'tight' : budget.level, routing, loadHarness());
  // V2 full-history children inherit model and effort and reject overrides.
  // Keep explicit history intact and request an isolated Relay dispatch instead.
  if (!routed.deny && args.fork_turns !== 'none') {
    if (!routed.role) process.exit(0);
    routed.deny = 'relay: model routing requires fork_turns: \"none\". Retry this Relay role with fork_turns: \"none\" and include its isolated task context in the message. Full-history children inherit the parent model and effort.';
  }
  const out = routed.deny
    ? { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: routed.deny }
    : { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...args, model: routed.model, reasoning_effort: routed.effort } };
  process.stdout.write(JSON.stringify({ hookSpecificOutput: out }) + '\n');
} catch (err) {
  process.stderr.write(`relay codex-spawn: ${err.message}\n`);
  process.exitCode = 0;
}
