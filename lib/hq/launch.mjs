// relay HQ launches from the page: an intent becomes argv on the server, from the
// action table only. User text is one argv element and nothing runs through a
// shell. preview evaluates the guards; start refuses on any of them.

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { isStale, levelFor, readSnapshot } from '../budget.mjs';
import { stripFrontmatter } from '../frontmatter.mjs';
import { parsePlan } from '../plan.mjs';
import { loadRouting, modelFor, RELAY_ROOT, TIERS } from '../routing.mjs';
import { boardFor } from '../../scripts/relay-board.mjs';
import { forecastPlan } from '../../scripts/relay-forecast.mjs';
import { runDir } from '../../scripts/relay-lanes.mjs';
import { alive, resolveClaudeBin } from '../../scripts/relay-marathon.mjs';
import { INSTANCE_RE, getInstance } from '../routines/store.mjs';
import { findTemplate } from '../routines/templates.mjs';
import { listLaunches, startLaunch } from './launches.mjs';
import { readRegistry } from './registry.mjs';
import { onPath } from './sources.mjs';

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export const ACTIONS = ['plan', 'run', 'marathon', 'skill', 'connectors', 'setup-codex', 'routine'];
export const HARNESS = {
  claude: { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], modes: ['auto', 'acceptEdits', 'default', 'dontAsk', 'plan', 'bypassPermissions'], defaultMode: 'auto', dangerous: 'bypassPermissions' },
  // From the spec; check against `codex exec --help` (spec section 11) and change only here.
  codex: { efforts: ['low', 'medium', 'high'], modes: ['workspace-write', 'read-only', 'danger-full-access'], defaultMode: 'workspace-write', dangerous: 'danger-full-access' },
};
const MARATHON_MODES = ['auto', 'acceptEdits', 'bypassPermissions'];
const MAX_TEXT = 4000;

export function launchOptions(harness, routing = loadRouting(), action) {
  const h = HARNESS[harness];
  if (!h) return undefined;
  const mid = modelFor(routing, 'mid', harness);
  return {
    models: [...new Set(TIERS.map((t) => modelFor(routing, t, harness).model))],
    efforts: h.efforts,
    modes: action === 'marathon' ? MARATHON_MODES : h.modes,
    dangerous: h.dangerous,
    defaults: { model: mid.model, effort: mid.effort, permissionMode: h.defaultMode },
  };
}

// The Codex prompt for a command is its commands/<name>.md body: frontmatter removed,
// $ARGUMENTS and ${CLAUDE_PLUGIN_ROOT} substituted, so the instructions live in one place.
export function commandPrompt(name, args = '', relayRoot = RELAY_ROOT) {
  const text = readFileSync(join(relayRoot, 'commands', `${name}.md`), 'utf8');
  // One pass with a function replacer: user text is never re-scanned and `$&`-style patterns stay literal.
  const subs = { $ARGUMENTS: args, '${CLAUDE_PLUGIN_ROOT}': relayRoot };
  return stripFrontmatter(text).replace(/\$ARGUMENTS|\$\{CLAUDE_PLUGIN_ROOT\}/g, (m) => subs[m]).trim();
}

export function codexBin(env = process.env) {
  return env.RELAY_CODEX_BIN || onPath('codex', env);
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Fills harness, model, effort and permission mode from the defaults; never throws.
export function normalizeIntent(raw, routing = loadRouting()) {
  const action = raw?.action;
  // A routine Run now runs no model: it is the relay CLI itself.
  if (action === 'routine') return { action, harness: 'relay', goal: '', skill: '', prompt: '', confirmDangerous: false, instance: str(raw?.instance) || undefined };
  const harness = raw?.harness ?? (action === 'setup-codex' ? 'codex' : 'claude');
  const defaults = launchOptions(harness, routing, action)?.defaults ?? {};
  return {
    action,
    harness,
    repo: typeof raw?.repo === 'string' ? raw.repo : undefined,
    plan: str(raw?.plan) || undefined,
    goal: str(raw?.goal),
    skill: str(raw?.skill),
    prompt: str(raw?.prompt),
    hours: raw?.hours === undefined || raw?.hours === null ? undefined : Number(raw.hours),
    model: raw?.model ?? defaults.model,
    effort: raw?.effort ?? defaults.effort,
    permissionMode: raw?.permissionMode ?? defaults.permissionMode,
    confirmDangerous: raw?.confirmDangerous === true,
    instance: str(raw?.instance) || undefined,
  };
}

// Headless launches (claude -p, codex exec) cannot hand work to a background agent or
// ask questions, so run and plan get unattended prompts. Both start with a fixed,
// non-dash prefix; user text only appears later in the same single argv element.
export function runPrompt(planPath, slug, relayRoot = RELAY_ROOT) {
  return [
    `Use the relay run-lanes skill (${join(relayRoot, 'skills', 'run-lanes', 'SKILL.md')}) to run the plan at ${planPath} start to finish in this process, as the coordinator.`,
    `This is an unattended run: dispatch the lane agents and wait for them, never hand the run to a background agent; nobody can answer questions, so rule and continue.`,
    `Start by reading \`relay ledger ${planPath}\`: lanes and waves marked complete are done, never redo them (this is how a blocked plan resumes).`,
    `Run \`relay budget\` before each wave. At critical, or after any usage-limit error: finish only in-flight lanes, merge what is clean, write the handoff, and end your turn.`,
    `When the plan is complete: \`relay ledger ${planPath} "plan: complete (relay/${slug}/integration @ <sha>)"\` then \`relay calibrate ${planPath}\`.`,
    `End your final message with exactly one line: RELAY_LEG: DONE | PAUSED | BLOCKED — <reason>.`,
  ].join('\n');
}

const PLAN_PREFIX = 'This is a non-interactive run and nobody can answer questions. Skip step 2 (the questions): take sensible defaults and list them as assumptions in the spec. Do all the work in this process. Choose the flow yourself in step 1, without asking.';

function promptFor(i, relayRoot) {
  switch (i.action) {
    case 'plan':
      return `${PLAN_PREFIX}\n\n${commandPrompt('plan', i.goal, relayRoot)}`;
    case 'run': {
      const abs = resolve(i.repo, i.plan);
      let slug = '<slug>';
      try {
        slug = parsePlan(readFileSync(abs, 'utf8')).slug;
      } catch {
        // keep the placeholder
      }
      return runPrompt(abs, slug, relayRoot);
    }
    case 'skill':
      return `Use the ${i.skill} skill. ${i.prompt}`;
    case 'connectors':
      return i.harness === 'codex' ? commandPrompt('connectors', '', relayRoot) : '/relay:connectors';
    default:
      throw fail(400, `unknown action: ${i.action}`);
  }
}

export function buildCommand(i, { env = process.env, sessionId = randomUUID(), relayRoot = RELAY_ROOT } = {}) {
  const cwd = i.action === 'connectors' ? (i.repo ?? homedir()) : i.repo;
  const vars = { RELAY_HARNESS: i.harness };
  const relayBin = join(relayRoot, 'bin', 'relay');
  if (i.action === 'marathon') {
    return { bin: process.execPath, argv: [relayBin, 'marathon', i.plan, '--hours', String(i.hours), '--model', i.model, '--permission-mode', i.permissionMode], cwd, env: vars };
  }
  if (i.action === 'routine') return { bin: process.execPath, argv: [relayBin, 'routine', 'run', i.instance, '--via', 'hq'], cwd: homedir(), env: vars };
  if (i.action === 'setup-codex') return { bin: process.execPath, argv: [relayBin, 'setup', 'codex', i.repo], cwd, env: vars };
  const prompt = promptFor(i, relayRoot);
  if (i.harness === 'codex') {
    return { bin: codexBin(env), argv: ['exec', prompt, '-m', i.model, '-c', `model_reasoning_effort=${i.effort}`, '--sandbox', i.permissionMode, '--json'], cwd, env: vars };
  }
  const argv = ['-p', prompt, '--session-id', sessionId, '--model', i.model, '--effort', i.effort, '--permission-mode', i.permissionMode, '--output-format', 'json'];
  if (i.permissionMode === 'bypassPermissions') argv.push('--dangerously-skip-permissions');
  return { bin: resolveClaudeBin(env), argv, cwd, env: vars };
}

const q = (s) => (/^[\w@%+=:,./-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);

export function displayCommand(cmd, harness) {
  const name = cmd.bin ?? (harness === 'codex' ? 'codex' : 'claude');
  const vars = Object.entries(cmd.env ?? {}).map(([k, v]) => `${k}=${q(v)}`);
  return `cd ${q(cmd.cwd ?? '.')} && ${[...vars, q(name), ...cmd.argv.map(q)].join(' ')}`;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function planInRepo(repo, plan) {
  if (!repo || !plan) return undefined;
  try {
    const dir = realpathSync(join(repo, 'docs', 'relay', 'plans'));
    const abs = realpathSync(resolve(repo, plan));
    return abs.startsWith(dir + sep) && abs.endsWith('.md') && statSync(abs).isFile() ? abs : undefined;
  } catch {
    return undefined;
  }
}

function budgetNow(routing) {
  const snap = readSnapshot();
  if (!snap) return null;
  const stale = isStale(snap, routing.budget.staleAfterMinutes);
  return { level: stale ? 'unknown' : levelFor(snap, routing.budget), fiveHour: snap.fiveHour?.percentUsed ?? null, sevenDay: snap.sevenDay?.percentUsed ?? null, resetsAt: snap.fiveHour?.resetsAt ?? null, stale };
}

// Ledger stamps are UTC (toISOString), so they parse with a Z.
const LEDGER_LINE = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: \[[^\]]*\])? (.*)$/;
const QUIET_MS = 30 * 60_000;

// Is the plan alive, or can a run resume it? { refuse: reason } when something looks
// alive, { resume: true } for a started, unfinished plan whose board is blocked or
// whose ledger has been quiet for 30 minutes, {} for a plan that never started.
function runState(i, planAbs, launches, now) {
  if (launches.some((l) => l.status === 'running' && (l.action === 'run' || l.action === 'marathon') && l.repo === i.repo && planInRepo(l.repo, l.plan) === planAbs)) return { refuse: 'an HQ launch is running it' };
  let slug;
  try {
    slug = parsePlan(readFileSync(planAbs, 'utf8')).slug;
  } catch {
    return {};
  }
  const dir = runDir(planAbs, slug);
  const marathon = readJson(join(dir, 'marathon.json'));
  if (marathon && !marathon.endedAt && alive(marathon.pid)) return { refuse: 'a marathon is running it' };
  const ledgerPath = join(dir, 'ledger.md');
  const entries = (existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : '')
    .split('\n')
    .map((l) => LEDGER_LINE.exec(l))
    .filter(Boolean)
    .map((m) => ({ at: Date.parse(`${m[1]}T${m[2]}:00Z`), text: m[3].trim() }));
  const started = entries.some((e) => /^start:/.test(e.text));
  if (!started || entries.some((e) => /^plan: complete/.test(e.text))) return {};
  const r = boardFor(planAbs);
  if (r.board?.status === 'blocked') return { resume: true };
  const last = entries[entries.length - 1].at;
  if (Number.isFinite(last) && now - last < QUIET_MS) return { refuse: 'its ledger moved less than 30 minutes ago' };
  return { resume: true };
}

export function evaluateGuards(i, { env = process.env, routing = loadRouting(), registry = readRegistry(), launches = listLaunches(), now = Date.now() } = {}) {
  const errors = [];
  const warnings = [];
  if (!ACTIONS.includes(i.action)) return { errors: [`unknown action: ${i.action}`], warnings };
  const opts = i.action === 'routine' ? {} : launchOptions(i.harness, routing, i.action);
  if (!opts) return { errors: [`unknown harness: ${i.harness}`], warnings };
  const cliOnly = i.action === 'setup-codex' || i.action === 'routine';
  if (i.action !== 'routine' && (i.action !== 'connectors' || i.repo !== undefined)) {
    if (!i.repo || !Object.hasOwn(registry.repos, i.repo)) errors.push('the repository is not registered');
    else if (!existsSync(i.repo)) errors.push('the repository is missing on disk');
  }
  const planned = i.action === 'run' || i.action === 'marathon';
  let resume = false;
  const planAbs = planned && !errors.length ? planInRepo(i.repo, i.plan) : undefined;
  if (planned && !errors.length && !planAbs) errors.push('the plan is not a file under docs/relay/plans/');
  if (i.action === 'marathon' && i.harness !== 'claude') errors.push('marathon runs on Claude Code only in this version');
  if (i.action === 'setup-codex' && i.harness !== 'codex') errors.push('setup-codex is a Codex action');
  if (!cliOnly && i.harness === 'claude' && !resolveClaudeBin(env)) errors.push('claude not found: put it on PATH or set RELAY_CLAUDE_BIN');
  if (!cliOnly && i.harness === 'codex' && !codexBin(env)) errors.push('codex is not installed');
  if (i.action === 'plan' && !i.goal) errors.push('a plan needs a goal');
  if (i.action === 'skill' && (!/^[a-z0-9][a-z0-9:_-]*$/i.test(i.skill) || !i.prompt)) errors.push('a skill launch needs a skill name and a prompt');
  if (i.goal.length > MAX_TEXT || i.prompt.length > MAX_TEXT) errors.push(`text is longer than ${MAX_TEXT} characters`);
  if (i.action === 'routine') {
    try {
      const inst = INSTANCE_RE.test(i.instance ?? '') ? getInstance(i.instance) : undefined;
      if (!inst) errors.push('unknown routine instance');
      else if (inst.registration?.state === 'disabled') errors.push('the routine is disabled');
      else if (findTemplate(inst.routine)?.type !== 'check') errors.push('a prompt routine runs only on its harness');
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (!cliOnly) {
    if (!opts.models.includes(i.model)) errors.push(`model must be one of ${opts.models.join(', ')}`);
    if (i.action !== 'marathon' && !opts.efforts.includes(i.effort)) errors.push(`effort must be one of ${opts.efforts.join(', ')}`);
    if (!opts.modes.includes(i.permissionMode)) errors.push(`permission mode must be one of ${opts.modes.join(', ')}`);
    if (i.permissionMode === opts.dangerous && !i.confirmDangerous) errors.push(`${opts.dangerous} needs the extra confirmation`);
  }
  if (i.action === 'marathon' && !(Number.isFinite(i.hours) && i.hours >= 1 && i.hours <= 48)) errors.push('hours must be between 1 and 48');
  if (planAbs) {
    const state = runState(i, planAbs, launches, now);
    if (state.refuse) errors.push(`the plan is already running (${state.refuse})`);
    if (state.resume) {
      resume = true;
      warnings.push('resumes from the ledger');
    }
    const level = budgetNow(routing)?.level;
    if (level === 'critical') errors.push('the budget is critical; wait for the window to reset');
    else if (level === 'tight') warnings.push('the budget is tight');
  }
  return { errors, warnings, planAbs, resume };
}

function prepare(raw, ctx = {}) {
  const routing = ctx.routing ?? loadRouting();
  const i = normalizeIntent(raw, routing);
  const { errors, warnings, planAbs, resume } = evaluateGuards(i, { ...ctx, routing });
  if (planAbs) i.plan = relative(i.repo, planAbs).split(sep).join('/');
  let command;
  try {
    command = buildCommand(i, ctx);
    command.display = displayCommand(command, i.harness);
  } catch (err) {
    errors.push(err.message);
  }
  let forecast;
  let hint;
  if (planAbs) {
    const f = forecastPlan(planAbs);
    if (!f.errors.length) {
      forecast = f.forecast;
      if (i.action === 'run' && (forecast.usage?.windows ?? 1) > 1) hint = 'This plan spans more than one 5-hour window: consider Marathon.';
    }
  }
  return { i, command, guards: { errors, warnings }, resume, forecast, hint, budget: budgetNow(routing), options: launchOptions(i.harness, routing, i.action) ?? null };
}

export function previewLaunch(raw, ctx = {}) {
  const p = prepare(raw, ctx);
  return {
    intent: p.i,
    options: p.options,
    command: p.command ? { display: p.command.display, argv: p.command.argv, cwd: p.command.cwd } : null,
    forecast: p.forecast ?? null,
    budget: p.budget,
    guards: p.guards,
    resume: p.resume,
    hint: p.hint ?? null,
  };
}

export function startFromIntent(raw, ctx = {}) {
  if (raw?.confirm !== true) throw fail(400, 'a launch needs confirm: true');
  const p = prepare(raw, ctx);
  if (p.guards.errors.length) throw fail(409, p.guards.errors.join('; '), { guards: p.guards });
  const { i, command } = p;
  const launch = startLaunch({ action: i.action, repo: i.repo ?? null, plan: i.plan ?? null, harness: i.harness, bin: command.bin, argv: command.argv, cwd: command.cwd, env: command.env, model: i.model, effort: i.effort, permissionMode: i.permissionMode, display: command.display });
  return { launch };
}
