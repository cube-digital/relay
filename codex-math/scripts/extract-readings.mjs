#!/usr/bin/env node
// Extract usage readings and thread metadata from a Codex home, without message content.
//
//   node codex-math/scripts/extract-readings.mjs [--codex-home ~/.codex] [--out codex-math/evidence/live]
//
// Writes:
//   readings.json  every token_count event found in sessions/**/*.jsonl and archived_sessions/**/*.jsonl:
//                  timestamp, thread id, model, rate_limits (windows, plan type, limit id, credits), token totals
//   threads.json   rows of state_5.sqlite threads (model, effort, tokens_used, agent role/path, timestamps, source)
//                  plus thread_spawn_edges; no titles, previews or first user messages
//   sessions.json  one line per rollout: thread id, cli_version, originator, source, model, record counts
// Nothing from auth.json, config.toml, prompts, tool calls or agent messages is copied.

import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const codexHome = resolve(opt('--codex-home', process.env.CODEX_HOME || join(homedir(), '.codex')));
const out = resolve(opt('--out', 'codex-math/evidence/live'));
mkdirSync(out, { recursive: true });

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.jsonl')) acc.push(p);
  }
  return acc;
}

const files = [...walk(join(codexHome, 'sessions')), ...walk(join(codexHome, 'archived_sessions'))];
const readings = [];
const sessions = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const counts = {};
  let meta;
  let model;
  let threadId;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    counts[row.type] = (counts[row.type] ?? 0) + 1;
    if (row.type === 'session_meta') {
      const p = row.payload ?? {};
      threadId = p.id;
      meta = { threadId: p.id, cliVersion: p.cli_version, originator: p.originator, source: p.source, threadSource: p.thread_source, modelProvider: p.model_provider, timestamp: p.timestamp, forkedFrom: p.forked_from_id ?? undefined };
    }
    if (row.type === 'turn_context' && row.payload?.model) model = row.payload.model;
    const payload = row.type === 'event_msg' ? row.payload : undefined;
    if (payload?.type === 'token_count') {
      const rl = payload.rate_limits ?? null;
      const info = payload.info ?? null;
      readings.push({
        at: row.timestamp,
        threadId,
        model,
        effort: undefined,
        rateLimits: rl
          ? {
              planType: rl.plan_type ?? null,
              limitId: rl.limit_id ?? null,
              limitName: rl.limit_name ?? null,
              primary: rl.primary ?? null,
              secondary: rl.secondary ?? null,
              credits: rl.credits ?? null,
              reached: rl.rate_limit_reached_type ?? null,
              spendControlReached: rl.spend_control_reached ?? null,
            }
          : null,
        total: info?.total_token_usage ?? null,
        last: info?.last_token_usage ?? null,
        modelContextWindow: info?.model_context_window ?? null,
      });
    }
    if (row.type === 'token_usage_record' && row.payload) {
      readings.push({ at: row.timestamp, threadId, model, kind: 'token_usage_record', total: row.payload.total_token_usage ?? row.payload.total ?? null, raw: Object.keys(row.payload) });
    }
  }
  sessions.push({ file: file.replace(codexHome, '$CODEX_HOME'), ...(meta ?? { threadId }), model, records: counts });
}
readings.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

let threads = { available: false };
const db = join(codexHome, 'state_5.sqlite');
if (existsSync(db)) {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const c = new DatabaseSync(db, { readOnly: true });
    const rows = c
      .prepare(
        `SELECT id, rollout_path, created_at, updated_at, created_at_ms, updated_at_ms, source, thread_source, originator, model_provider, model, reasoning_effort,
                tokens_used, agent_nickname, agent_role, agent_path, history_mode, cli_version, archived, git_branch
         FROM threads ORDER BY created_at_ms`,
      )
      .all();
    const edges = c.prepare('SELECT parent_thread_id, child_thread_id, status FROM thread_spawn_edges').all();
    let goals = [];
    const gdb = join(codexHome, 'goals_1.sqlite');
    if (existsSync(gdb)) {
      const g = new DatabaseSync(gdb, { readOnly: true });
      goals = g.prepare('SELECT thread_id, goal_id, status, token_budget, tokens_used, time_used_seconds, created_at_ms, updated_at_ms FROM thread_goals').all();
      g.close();
    }
    c.close();
    threads = {
      available: true,
      threads: rows.map((r) => ({ ...r, rollout_path: String(r.rollout_path ?? '').replace(codexHome, '$CODEX_HOME') })),
      spawnEdges: edges.map((e) => ({ ...e })),
      goals: goals.map((g) => ({ ...g })),
    };
  } catch (e) {
    threads = { available: false, error: String(e.message ?? e) };
  }
}

writeFileSync(join(out, 'readings.json'), JSON.stringify({ codexHome: '$CODEX_HOME', extractedAt: new Date().toISOString(), count: readings.length, readings }, null, 1));
writeFileSync(join(out, 'threads.json'), JSON.stringify(threads, null, 1));
writeFileSync(join(out, 'sessions.json'), JSON.stringify({ count: sessions.length, sessions }, null, 1));
const withLimits = readings.filter((r) => r.rateLimits);
const plans = [...new Set(withLimits.map((r) => r.rateLimits.planType).filter(Boolean))];
console.log(`${files.length} rollouts, ${readings.length} token_count readings (${withLimits.length} with rate limits; plan types: ${plans.join(', ') || 'none'}), ${threads.threads?.length ?? 0} threads, ${threads.spawnEdges?.length ?? 0} spawn edges → ${out}`);
