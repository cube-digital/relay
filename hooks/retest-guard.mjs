#!/usr/bin/env node
// PreToolUse / PostToolUse on shell commands.
// Blocks rerunning the exact same test command on exactly the same code: the
// result cannot change, so the rerun only spends tokens and time.
// Escape hatch for genuinely flaky tests: prefix the command with RELAY_RERUN=1.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { relayHome } from '../lib/budget.mjs';
import { fingerprint, isTestCommand } from '../lib/fingerprint.mjs';
import { allow, block, commandOf, readInput } from '../lib/hookio.mjs';

const MAX_RUNS = 200;

function statePath(root) {
  const key = createHash('sha1').update(root).digest('hex').slice(0, 16);
  return join(relayHome(), 'state', `retest-${key}.json`);
}

function load(path) {
  if (!existsSync(path)) return { runs: {}, pending: {} };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { runs: {}, pending: {} };
  }
}

function save(path, state) {
  const entries = Object.entries(state.runs).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_RUNS);
  state.runs = Object.fromEntries(entries);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}

function tail(text, n = 240) {
  const s = String(text ?? '').trim();
  return s.length > n ? '…' + s.slice(-n) : s;
}

try {
  const input = await readInput();
  const command = commandOf(input.tool_input);
  if (!isTestCommand(command) || /\bRELAY_RERUN=1\b/.test(command)) allow();

  const cwd = input.cwd || process.cwd();
  const fp = fingerprint(cwd, command);
  if (!fp) allow();
  const path = statePath(fp.root);
  const state = load(path);
  const callId = input.tool_use_id || `${input.session_id ?? ''}:${command}`;

  if (input.hook_event_name === 'PostToolUse') {
    const value = state.pending[callId] ?? fp.value;
    delete state.pending[callId];
    const resp = input.tool_response ?? {};
    const output = typeof resp === 'string' ? resp : resp.stdout ?? resp.output ?? '';
    state.runs[value] = { at: new Date().toISOString(), command, tail: tail(output) };
    save(path, state);
    allow();
  }

  const prev = state.runs[fp.value];
  if (prev) {
    const when = new Date(prev.at).toLocaleTimeString();
    block(
      `relay retest-guard: \`${command}\` already ran at ${when} on identical code, so its result cannot change.\n` +
        (prev.tail ? `Last output (tail): ${prev.tail}\n` : '') +
        'Use that result. Change the code first, or run a narrower command. ' +
        'If the test is genuinely flaky, prefix the command with RELAY_RERUN=1 and say why in your report.',
    );
  }
  state.pending[callId] = fp.value;
  save(path, state);
  allow();
} catch (err) {
  process.stderr.write(`relay retest-guard: ${err.message}\n`);
  process.exit(0);
}
