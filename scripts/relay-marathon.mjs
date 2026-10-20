// relay marathon <plan.md> --hours N [options]
// relay marathon <plan.md> --status
// relay marathon <plan.md> --stop [--now]
//
// Runs a plan unattended for up to N hours as a series of short headless
// Claude Code sessions ("legs"). Each leg starts with an empty context and
// continues from the ledger; when a leg stops for the usage window, the loop
// waits for the reset and starts the next one. State is on disk the whole time,
// so a marathon that was interrupted continues where it left off when started
// again with the same command.
//
// From Claude Code, /relay:marathon starts it as a background task of the
// session; from a terminal, run it under tmux or screen.
//
//   --hours N              wall-clock deadline (required to start)
//   --dry-run              print the forecast and the first leg's command, run nothing
//   --status               where a marathon for this plan is: leg, wait, last outcome, ledger tail
//   --stop                 stop after the current leg; with --now, stop the current leg too
//   --max-legs N           stop after N legs in this run (default 24)
//   --max-turns N          turns per leg before it ends and a new leg starts (default 400)
//   --model <alias>        the conductor's model (default sonnet)
//   --permission-mode M    auto (default) | acceptEdits | bypassPermissions
//   --allowed-tools "..."  extra --allowedTools rules (e.g. "Bash(pnpm test *)")
//   --plugin-dir           load relay from this checkout (when it is not installed as a plugin)

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { readSnapshot, isStale, levelFor } from '../lib/budget.mjs';
import { readCalibration } from '../lib/calibration.mjs';
import { forecast, formatForecast } from '../lib/forecast.mjs';
import { ensureExcluded, git, mainRoot } from '../lib/git.mjs';
import { classifyLeg, decideNext, legPrompt, parseClaudeJson } from '../lib/marathon.mjs';
import { loadRouting, RELAY_ROOT } from '../lib/routing.mjs';
import { refreshBoard } from './relay-board.mjs';
import { ledgerPath } from './relay-ledger.mjs';
import { planLanes, runDir } from './relay-lanes.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USAGE =
  'usage: relay marathon <plan.md> --hours N [--dry-run] [--max-legs N] [--max-turns N] [--model sonnet] [--permission-mode auto] [--allowed-tools "..."] [--plugin-dir]\n' +
  '       relay marathon <plan.md> --status\n' +
  '       relay marathon <plan.md> --stop [--now]';

function ledgerLines(path) {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((l) => l.startsWith('- ')) : [];
}

function budgetNow(routing) {
  const snap = readSnapshot();
  if (!snap || isStale(snap, routing.budget.staleAfterMinutes)) return undefined;
  return { ...snap, level: levelFor(snap, routing.budget) };
}

export function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

// Every leg gets its own session id: started from inside a Claude Code session,
// a child `claude -p` can otherwise pick up the parent's id and write into its transcript.
// The claude binary for the legs: RELAY_CLAUDE_BIN, else `claude` on PATH, else the
// Claude Code that started this command (the desktop app need not put `claude` on PATH).
export function resolveClaudeBin(env = process.env) {
  if (env.RELAY_CLAUDE_BIN) return env.RELAY_CLAUDE_BIN;
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const n of names) if (existsSync(join(dir, n))) return join(dir, n);
  }
  if (env.CLAUDE_CODE_EXECPATH && existsSync(env.CLAUDE_CODE_EXECPATH)) return env.CLAUDE_CODE_EXECPATH;
  return undefined;
}

export function legArgs({ prompt, model, permissionMode, maxTurns, allowedTools, pluginDir, sessionId = randomUUID() }) {
  const args = ['-p', prompt, '--session-id', sessionId, '--output-format', 'json', '--model', model, '--permission-mode', permissionMode, '--permission-prompts', 'none', '--max-turns', String(maxTurns)];
  if (permissionMode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
  if (allowedTools) args.push('--allowedTools', allowedTools);
  if (pluginDir) args.push('--plugin-dir', pluginDir);
  return args;
}

// One leg as a child process we can stop: a stop request or a signal must not
// leave a headless session running on its own.
function startLeg(bin, args, opts) {
  const child = spawn(bin, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr = (stderr + d).slice(-20_000)));
  const done = new Promise((res) => {
    child.on('error', (err) => res({ status: null, stdout, stderr: stderr + String(err) }));
    child.on('close', (status, signal) => res({ status, signal, stdout, stderr }));
  });
  return { child, done };
}

const two = (n) => String(n).padStart(2, '0');
const local = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
const span = (ms) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

// Plain-language status, read only from the files a marathon writes.
export function describeMarathon({ state, ledger, now = Date.now(), isAlive = alive }) {
  if (!state) return { running: false, text: 'no marathon has run for this plan' };
  const out = [];
  const running = !state.endedAt && isAlive(state.pid);
  const phase = state.phase ?? {};
  let head;
  if (state.endedAt) head = `finished ${local(state.endedAt)}: ${state.stopReason}`;
  else if (!running) head = 'not running: the process ended without finishing (Claude Code closed, the machine slept, or the task was stopped). Start it again with the same command; it continues from the ledger.';
  else if (phase.kind === 'waiting') head = `running · pid ${state.pid} · waiting for the usage window until ${local(phase.until)} (${span(Date.parse(phase.until) - now)} from now)`;
  else if (phase.kind === 'leg') head = `running · pid ${state.pid} · leg ${phase.leg} since ${local(phase.since)} (${span(now - Date.parse(phase.since))})`;
  else head = `running · pid ${state.pid}`;
  out.push(`marathon ${state.slug}: ${head}`);
  if (state.deadline) {
    const left = Date.parse(state.deadline) - now;
    out.push(`deadline ${local(state.deadline)}` + (left > 0 && !state.endedAt ? ` (${span(left)} left)` : '') + (state.options ? ` · model ${state.options.model} · permission ${state.options.permissionMode}` : ''));
  }
  const legs = state.legs ?? [];
  if (legs.length) {
    const cost = legs.reduce((a, l) => a + (l.costUsd ?? 0), 0);
    out.push(`legs ${legs.length}: ${legs.map((l) => l.outcome).join(', ')}` + (cost ? ` · api-equivalent $${cost.toFixed(2)}` : ''));
    const last = legs.at(-1);
    out.push(`last  leg ${last.leg} ${last.outcome}: ${last.reason}` + (last.budget ? ` [5h ${last.budget.fiveHour ?? '?'}% · 7d ${last.budget.sevenDay ?? '?'}%]` : ''));
  }
  const tail = (ledger ?? []).slice(-4);
  if (tail.length) out.push('ledger', ...tail.map((l) => `  ${l}`));
  return { running, text: out.join('\n') };
}

function locate(planPath) {
  const res = planLanes(planPath);
  if (res.errors.length) return { errors: res.errors };
  const dir = runDir(planPath, res.plan.slug);
  return { res, dir, statePath: join(dir, 'marathon.json'), logPath: join(dir, 'marathon.log'), stopPath: join(dir, 'marathon.stop') };
}

function status(planPath) {
  const loc = locate(planPath);
  if (loc.errors) return fail(loc.errors);
  const { text } = describeMarathon({ state: readJson(loc.statePath), ledger: ledgerLines(ledgerPath(planPath)) });
  console.log(text);
  return existsSync(loc.statePath) ? 0 : 1;
}

function stop(planPath, now) {
  const loc = locate(planPath);
  if (loc.errors) return fail(loc.errors);
  const state = readJson(loc.statePath);
  if (!state || state.endedAt || !alive(state.pid)) {
    console.log('no marathon is running for this plan');
    return 1;
  }
  writeFileSync(loc.stopPath, JSON.stringify({ requestedAt: new Date().toISOString(), now }) + '\n');
  if (now) {
    process.kill(state.pid, 'SIGTERM');
    console.log(`stopping now: sent SIGTERM to pid ${state.pid}; the current leg is stopped too. Lanes keep their commits; start the marathon again to continue.`);
  } else {
    console.log(`stop requested: the marathon (pid ${state.pid}) ends after the current leg, or at once if it is waiting for the window.`);
  }
  return 0;
}

function fail(errors) {
  for (const e of errors) console.error(`✗ ${e}`);
  return 1;
}

export async function main(argv) {
  const args = parseArgs(argv, { booleans: ['dry-run', 'plugin-dir', 'status', 'stop', 'now'] });
  const planPath = args._[0] && resolve(args._[0]);
  if (planPath && args.status) return status(planPath);
  if (planPath && args.stop) return stop(planPath, Boolean(args.now));
  if (!planPath || !args.hours) {
    console.error(USAGE);
    return 64;
  }
  const loc = locate(planPath);
  if (loc.errors) return fail(loc.errors);
  const { res, dir, statePath, logPath, stopPath } = loc;
  const root = mainRoot(resolve(planPath, '..'));
  if (!root) {
    console.error('✗ the plan must live inside a git repository');
    return 1;
  }
  const previous = readJson(statePath);
  if (previous && !previous.endedAt && previous.pid !== process.pid && alive(previous.pid)) {
    console.error(`✗ a marathon for this plan is already running (pid ${previous.pid}). See it with --status, end it with --stop.`);
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
  const claudeBin = resolveClaudeBin();
  if (!claudeBin) {
    console.error('✗ no `claude` command found for the legs. Install the Claude Code CLI (https://code.claude.com/docs/en/setup), or set RELAY_CLAUDE_BIN to its path.');
    return 1;
  }
  const routing = loadRouting();
  mkdirSync(dir, { recursive: true });
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

  const state = previous ?? { slug: res.plan.slug, legs: [] };
  state.legs ??= [];
  const firstLeg = state.legs.length + 1;
  const firstArgs = legArgs({ ...options, prompt: legPrompt({ planPath, leg: firstLeg, deadline: deadline.toISOString(), slug: res.plan.slug }) });
  if (args['dry-run']) {
    console.log(`dry run. Leg ${firstLeg} would run in ${root}:\n  ${claudeBin} ${firstArgs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    console.log(`claude: ${claudeBin}\nstate:  ${statePath}\nlog:    ${logPath}`);
    return 0;
  }

  state.startedAt ??= start.toISOString();
  state.deadline = deadline.toISOString();
  state.options = options;
  state.pid = process.pid;
  delete state.endedAt;
  delete state.stopReason;
  const save = () => {
    writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
    refreshBoard(planPath);
  };
  const finish = (reason, phase = 'stopped') => {
    state.endedAt = new Date().toISOString();
    state.stopReason = reason;
    state.phase = { kind: phase, at: state.endedAt };
    save();
    log(`marathon stop: ${reason}`);
  };
  // a stop file older than this process belongs to an earlier run
  const stopRequested = () => {
    const s = readJson(stopPath);
    return Boolean(s && Date.parse(s.requestedAt) >= start.getTime());
  };

  let current;
  const onSignal = (sig) => {
    if (current) current.child.kill('SIGTERM');
    finish(`stopped by ${sig}`);
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));

  const legsBefore = state.legs.length;
  save();
  log(`marathon start: ${res.plan.slug}, ${hours}h, deadline ${deadline.toISOString()}, model ${options.model}, permission ${options.permissionMode}, pid ${process.pid}, claude ${claudeBin}`);
  let stalledStreak = 0;
  for (;;) {
    if (stopRequested()) {
      finish('stopped on request');
      return 3;
    }
    const leg = state.legs.length + 1;
    const before = ledgerLines(ledger).length;
    const prompt = legPrompt({ planPath, leg, deadline: deadline.toISOString(), slug: res.plan.slug });
    const cmd = legArgs({ ...options, prompt });
    const startedAt = new Date();
    state.phase = { kind: 'leg', leg, since: startedAt.toISOString() };
    save();
    log(`leg ${leg}: starting`);
    current = startLeg(claudeBin, cmd, { cwd: root, env: { ...process.env, RELAY_MARATHON_LEG: String(leg) } });
    const run = await current.done;
    current = undefined;
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

    const next = decideNext({ outcome, deadline, legsRun: state.legs.length - legsBefore, maxLegs: options.maxLegs, stalledStreak });
    if (next.action === 'stop') {
      finish(next.reason, outcome.kind === 'done' ? 'done' : 'stopped');
      console.log(`\nledger: relay ledger ${planPath}\nstate:  ${statePath}`);
      return outcome.kind === 'done' ? 0 : 2;
    }
    if (next.action === 'wait') {
      const until = Date.parse(next.until) + 90_000;
      state.phase = { kind: 'waiting', until: new Date(until).toISOString(), reason: next.reason, since: new Date().toISOString() };
      save();
      log(`waiting until ${next.until} (+90s) for the window to reset: ${next.reason}`);
      // sleep in short steps so a stop request ends the wait promptly
      while (process.env.RELAY_MARATHON_FAST !== '1' && Date.now() < until && !stopRequested()) await sleep(Math.min(15_000, until - Date.now()));
    }
  }
}
