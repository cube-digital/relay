// relay marathon <plan.md> --hours N [options]
//
// Runs a plan unattended for up to N hours as a series of short headless
// Claude Code sessions ("legs"). Each leg starts with an empty context and
// continues from the ledger; when a leg stops for the usage window, the loop
// waits for the reset and starts the next one. State is on disk the whole time.
//
//   --hours N              wall-clock deadline (required)
//   --dry-run              print the forecast and the first leg's command, run nothing
//   --max-legs N           stop after N legs (default 24)
//   --max-turns N          turns per leg before it ends and a new leg starts (default 400)
//   --model <alias>        the conductor's model (default sonnet)
//   --permission-mode M    auto (default) | acceptEdits | bypassPermissions
//   --allowed-tools "..."  extra --allowedTools rules (e.g. "Bash(pnpm test *)")
//   --plugin-dir           load relay from this checkout (when it is not installed as a plugin)

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { readSnapshot, isStale, levelFor } from '../lib/budget.mjs';
import { readCalibration } from '../lib/calibration.mjs';
import { forecast, formatForecast } from '../lib/forecast.mjs';
import { ensureExcluded, git, mainRoot } from '../lib/git.mjs';
import { classifyLeg, decideNext, legPrompt, parseClaudeJson } from '../lib/marathon.mjs';
import { loadRouting, RELAY_ROOT } from '../lib/routing.mjs';
import { ledgerPath } from './relay-ledger.mjs';
import { planLanes, runDir } from './relay-lanes.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ledgerLines(path) {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((l) => l.startsWith('- ')) : [];
}

function budgetNow(routing) {
  const snap = readSnapshot();
  if (!snap || isStale(snap, routing.budget.staleAfterMinutes)) return undefined;
  return { ...snap, level: levelFor(snap, routing.budget) };
}

export function legArgs({ prompt, model, permissionMode, maxTurns, allowedTools, pluginDir }) {
  const args = ['-p', prompt, '--output-format', 'json', '--model', model, '--permission-mode', permissionMode, '--permission-prompts', 'none', '--max-turns', String(maxTurns)];
  if (permissionMode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
  if (allowedTools) args.push('--allowedTools', allowedTools);
  if (pluginDir) args.push('--plugin-dir', pluginDir);
  return args;
}

export async function main(argv) {
  const args = parseArgs(argv, { booleans: ['dry-run', 'plugin-dir'] });
  const planPath = args._[0] && resolve(args._[0]);
  if (!planPath || !args.hours) {
    console.error('usage: relay marathon <plan.md> --hours N [--dry-run] [--max-legs N] [--max-turns N] [--model sonnet] [--permission-mode auto] [--allowed-tools "..."] [--plugin-dir]');
    return 64;
  }
  const res = planLanes(planPath);
  if (res.errors.length) {
    for (const e of res.errors) console.error(`✗ ${e}`);
    return 1;
  }
  const root = mainRoot(resolve(planPath, '..'));
  if (!root) {
    console.error('✗ the plan must live inside a git repository');
    return 1;
  }
  ensureExcluded(root, ['.relay/', '.claude/worktrees/']);
  const dirty = (git(['status', '--porcelain'], root, { allowFail: true }) ?? '')
    .split('\n')
    .filter((l) => l && !/^\?\? \.relay\//.test(l))
    .join('\n');
  if (dirty) {
    console.error(`✗ the main checkout has uncommitted changes; commit or stash them first:\n${dirty.split('\n').slice(0, 5).join('\n')}`);
    return 1;
  }
  const claudeBin = process.env.RELAY_CLAUDE_BIN || 'claude';
  const routing = loadRouting();
  const dir = runDir(planPath, res.plan.slug);
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, 'marathon.json');
  const logPath = join(dir, 'marathon.log');
  const ledger = ledgerPath(planPath);
  const hours = Number(args.hours);
  const start = new Date();
  const deadline = new Date(start.getTime() + hours * 3_600_000);
  const options = {
    model: args.model ?? 'sonnet',
    permissionMode: args['permission-mode'] ?? 'auto',
    maxTurns: Number(args['max-turns'] ?? 400),
    maxLegs: Number(args['max-legs'] ?? 24),
    allowedTools: args['allowed-tools'],
    pluginDir: args['plugin-dir'] ? RELAY_ROOT : undefined,
  };
  const log = (line) => {
    const msg = `${new Date().toISOString()} ${line}`;
    console.log(msg);
    appendFileSync(logPath, msg + '\n');
  };

  const f = forecast({ plan: res.plan, lanes: res.lanes, routing, calibration: readCalibration(), budget: budgetNow(routing) });
  console.log(formatForecast(f));
  console.log('');
  if (f.time.totalMinutes > hours * 60) console.log(`! the forecast (~${Math.round(f.time.totalMinutes / 60)}h) exceeds --hours ${hours}; the run will stop at the deadline with work left`);
  if (f.usage.fitsWeekly === false) console.log('! the forecast does not fit the weekly limit; expect a stop on the weekly reset');

  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { slug: res.plan.slug, legs: [] };
  state.startedAt ??= start.toISOString();
  state.deadline = deadline.toISOString();
  state.options = options;
  const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  const firstLeg = state.legs.length + 1;
  const firstArgs = legArgs({ ...options, prompt: legPrompt({ planPath, leg: firstLeg, deadline: deadline.toISOString(), slug: res.plan.slug }) });
  if (args['dry-run']) {
    console.log(`dry run. Leg ${firstLeg} would run in ${root}:\n  ${claudeBin} ${firstArgs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    console.log(`state: ${statePath}\nlog:   ${logPath}`);
    return 0;
  }

  save();
  log(`marathon start: ${res.plan.slug}, ${hours}h, deadline ${deadline.toISOString()}, model ${options.model}, permission ${options.permissionMode}`);
  let stalledStreak = 0;
  for (;;) {
    const leg = state.legs.length + 1;
    const before = ledgerLines(ledger).length;
    const prompt = legPrompt({ planPath, leg, deadline: deadline.toISOString(), slug: res.plan.slug });
    const cmd = legArgs({ ...options, prompt });
    log(`leg ${leg}: starting`);
    const startedAt = new Date();
    const run = spawnSync(claudeBin, cmd, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, RELAY_MARATHON_LEG: String(leg) } });
    const result = parseClaudeJson(run.stdout) ?? { is_error: run.status !== 0, result: (run.stdout || run.stderr || '').trim().slice(-2000) };
    const lines = ledgerLines(ledger);
    const planComplete = lines.some((l) => /plan: complete/.test(l));
    const budget = budgetNow(routing);
    const outcome = classifyLeg({ result, ledgerGrew: lines.length > before, planComplete, budget });
    stalledStreak = outcome.kind === 'stalled' || outcome.kind === 'error' ? stalledStreak + 1 : 0;
    state.legs.push({
      leg,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      sessionId: result.session_id,
      exitCode: run.status,
      costUsd: result.total_cost_usd,
      ledgerLines: [before, lines.length],
      outcome: outcome.kind,
      reason: outcome.reason,
      budget: budget ? { level: budget.level, fiveHour: budget.fiveHour?.percentUsed, sevenDay: budget.sevenDay?.percentUsed } : undefined,
    });
    save();
    log(`leg ${leg}: ${outcome.kind} — ${outcome.reason}` + (result.total_cost_usd ? ` (api-equivalent $${result.total_cost_usd.toFixed(2)})` : '') + (budget ? ` [5h ${budget.fiveHour?.percentUsed ?? '?'}% · 7d ${budget.sevenDay?.percentUsed ?? '?'}%]` : ''));
    if (outcome.kind === 'error') log(`leg ${leg}: stderr tail: ${(run.stderr || '').trim().slice(-500)}`);

    const next = decideNext({ outcome, deadline, legsRun: state.legs.length, maxLegs: options.maxLegs, stalledStreak });
    if (next.action === 'stop') {
      state.endedAt = new Date().toISOString();
      state.stopReason = next.reason;
      save();
      log(`marathon stop: ${next.reason}`);
      console.log(`\nledger: relay ledger ${planPath}\nstate:  ${statePath}`);
      return outcome.kind === 'done' ? 0 : 2;
    }
    if (next.action === 'wait') {
      const ms = Math.max(0, Date.parse(next.until) - Date.now()) + 90_000;
      log(`waiting until ${next.until} (+90s) for the window to reset: ${next.reason}`);
      if (process.env.RELAY_MARATHON_FAST !== '1') await sleep(ms);
    }
  }
}
