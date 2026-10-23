#!/usr/bin/env node
// PreToolUse / PostToolUse on shell commands.
// Blocks rerunning the exact same test command on exactly the same code: the
// result cannot change, so the rerun only spends tokens and time.
// Escape hatch for genuinely flaky tests: prefix the command with RELAY_RERUN=1.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(state));
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

// Hook processes share state. Keep the entire read/modify/write in one short
// transaction; abandon contention after a bounded wait so hooks fail open.
async function lock(path) {
  mkdirSync(join(path, '..'), { recursive: true });
  const directory = `${path}.lock`;
  const deadline = Date.now() + 1500;
  for (;;) {
    try {
      mkdirSync(directory);
      try {
        writeFileSync(join(directory, 'owner'), String(process.pid));
      } catch (err) {
        rmSync(directory, { recursive: true, force: true });
        throw err;
      }
      return () => rmSync(directory, { recursive: true, force: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Serialize stale-owner recovery too: two waiters must never delete a
      // newly acquired lock after both observed the same dead owner.
      const recovery = `${directory}.recovery`;
      let recovering = false;
      try {
        mkdirSync(recovery);
        recovering = true;
        try {
          const pid = Number(readFileSync(join(directory, 'owner'), 'utf8'));
          if (Number.isInteger(pid) && pid > 0) {
            try { process.kill(pid, 0); } catch (ownerError) {
              if (ownerError.code === 'ESRCH') rmSync(directory, { recursive: true, force: true });
            }
          }
        } catch (ownerError) {
          if (ownerError.code !== 'ENOENT') throw ownerError;
          // A crash between mkdir and writing the owner leaves an empty lock.
          try {
            if (Date.now() - statSync(directory).mtimeMs > 30_000) rmSync(directory, { recursive: true, force: true });
          } catch (statError) {
            if (statError.code !== 'ENOENT') throw statError;
          }
        }
      } catch (recoveryError) {
        if (recoveryError.code !== 'EEXIST') throw recoveryError;
      } finally {
        if (recovering) rmSync(recovery, { recursive: true, force: true });
      }
      if (Date.now() >= deadline) throw new Error('state lock timed out; allowing tool call');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

function tail(text, n = 240) {
  const s = String(text ?? '').trim();
  return s.length > n ? '…' + s.slice(-n) : s;
}

try {
  const input = await readInput();
  const command = commandOf(input.tool_input);
  if (!isTestCommand(command) || /\bRELAY_RERUN=1\b/.test(command)) allow();

  const base = input.cwd || process.cwd();
  const cwd = resolve(base, input.tool_input?.workdir || input.tool_input?.cwd || '.');
  const fp = fingerprint(cwd, command);
  if (!fp) allow();
  const path = statePath(fp.root);
  const release = await lock(path);
  let reason;
  try {
    const state = load(path);
    const callId = input.tool_use_id || `${input.session_id ?? ''}:${cwd}:${command}`;
    if (input.hook_event_name === 'PostToolUse') {
      const value = state.pending[callId] ?? fp.value;
      delete state.pending[callId];
      const resp = input.tool_response ?? {};
      const output = typeof resp === 'string' ? resp : resp.stdout ?? resp.output ?? '';
      state.runs[value] = { at: new Date().toISOString(), command, tail: tail(output) };
      save(path, state);
    } else {
      const prev = state.runs[fp.value];
      if (prev) {
        const when = new Date(prev.at).toLocaleTimeString();
        reason = `relay retest-guard: \`${command}\` already ran at ${when} on identical code, so its result cannot change.\n` +
          (prev.tail ? `Last output (tail): ${prev.tail}\n` : '') +
          'Use that result. Change the code first, or run a narrower command. ' +
          'If the test is genuinely flaky, prefix the command with RELAY_RERUN=1 and say why in your report.';
      } else {
        state.pending[callId] = fp.value;
        save(path, state);
      }
    }
  } finally {
    release();
  }
  if (reason) block(reason);
  allow();
} catch (err) {
  process.stderr.write(`relay retest-guard: ${err.message}\n`);
  process.exit(0);
}
