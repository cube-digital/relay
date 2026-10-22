// relay HQ Recos state and apply: done, skipped and cart in <relayHome>/hq/recos.json, the public
// view the page reads, and apply, which takes reco ids only and rebuilds every command from disk.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { relayHome } from '../budget.mjs';
import { writeJsonAtomic } from '../routines/store.mjs';
import { displayCommand, previewLaunch, startFromIntent } from './launch.mjs';
import { getLaunch, startLaunch } from './launches.mjs';
import { readRegistry } from './registry.mjs';
import { AREAS, buildRecos, collectRecoSources, reconcile } from './recos.mjs';

const OPS = ['done', 'skip', 'unskip', 'cart-add', 'cart-remove', 'cart-clear'];
const PLAN_FIELDS = ['harness', 'model', 'effort', 'permissionMode', 'confirmDangerous'];
const PRIORITY_MAX = 6;

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const idsOk = (ids, max, min) => Array.isArray(ids) && ids.length >= min && ids.length <= max
  && ids.every((id) => typeof id === 'string' && id.length >= 1 && id.length <= 400);
const baseOf = (id) => (id.includes('#') ? id.slice(0, id.lastIndexOf('#')) : id);
const binName = (r) => (r.source === 'skill-links' ? 'rm' : 'git');
const showRun = (r, x) => displayCommand({ bin: x.bin ?? binName(r), argv: x.argv, cwd: x.cwd }, 'relay');

export const recosPath = () => join(relayHome(), 'hq', 'recos.json');
export const emptyRecoState = () => ({ version: 1, done: {}, skipped: {}, applied: {}, cart: [], known: {} });

// Missing → empty; invalid JSON or shape → kept as recos.json.bad, empty.
export function readRecoState() {
  const path = recosPath();
  if (!existsSync(path)) return emptyRecoState();
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    if (doc?.version === 1 && isObj(doc.done) && isObj(doc.skipped) && Array.isArray(doc.cart) && doc.cart.every((c) => typeof c === 'string')
      && (doc.known === undefined || isObj(doc.known)) && (doc.applied === undefined || isObj(doc.applied))) {
      return { version: 1, done: doc.done, skipped: doc.skipped, applied: doc.applied ?? {}, cart: doc.cart, known: doc.known ?? {} };
    }
  } catch {
    // fall through
  }
  try {
    copyFileSync(path, `${path}.bad`);
  } catch {
    // keep going with an empty state
  }
  return emptyRecoState();
}

function writeRecoState(state) {
  mkdirSync(join(relayHome(), 'hq'), { recursive: true, mode: 0o700 });
  writeJsonAtomic(recosPath(), state);
}

export function buildNow(opts = {}) {
  const sources = collectRecoSources(opts);
  return { builtAt: new Date().toISOString(), sources, recos: buildRecos(sources, { home: opts.home }) };
}

// Reconciled with the stored state; the cart keeps only ids that are neither done nor skipped.
function settle(built, now = new Date()) {
  const before = readRecoState();
  const next = reconcile(before, built.recos, built.sources, now);
  next.cart = next.cart.filter((id) => !Object.hasOwn(next.done, id) && !Object.hasOwn(next.skipped, id));
  return { before, next };
}

// done and skipped win; applied means a launch ran for it and the rebuild still produces it.
const stateOf = (state, id) => (Object.hasOwn(state.done, id) ? 'done' : Object.hasOwn(state.skipped, id) ? 'skipped' : Object.hasOwn(state.applied ?? {}, id) ? 'applied' : 'open');
const live = (s) => s === 'open' || s === 'applied';

const launchEnded = (a) => { const l = getLaunch(a?.launch); return !l || l.status !== 'running'; };

function launchOutcome(a) {
  const l = getLaunch(a.launch);
  if (!l) return { launch: a.launch, at: a.at, status: 'lost', exitCode: null, error: null, endedAt: null };
  return { launch: a.launch, at: a.at, status: l.status, exitCode: l.exitCode, error: l.error, endedAt: l.endedAt };
}

function publicApply(r) {
  const a = r.apply;
  if (a.kind === 'command') {
    return {
      kind: 'command',
      commands: a.run.filter((x) => !x.deletes).map((x) => showRun(r, x)),
      deletes: a.run.filter((x) => x.deletes).map((x) => showRun(r, x)),
    };
  }
  if (a.kind === 'plan') return { kind: 'plan', goal: a.goal };
  if (a.kind === 'routine') return { kind: 'routine', routine: a.routine };
  return { kind: 'manual', copy: a.copy };
}

function view(built, state) {
  const cart = new Set(state.cart);
  const rows = built.recos.map((r) => {
    const { base, apply, ...rest } = r;
    const st = stateOf(state, r.id);
    return { ...rest, apply: publicApply(r), state: st, ...(st === 'applied' ? { applied: launchOutcome(state.applied[r.id]) } : {}), inCart: cart.has(r.id), rank: 0 };
  });
  const open = rows.filter((r) => live(r.state));
  open.forEach((r, i) => { r.rank = i + 1; });
  const ids = new Set(built.recos.map((r) => r.id));
  const gone = Object.entries(state.known)
    .filter(([id]) => !ids.has(id) && !live(stateOf(state, id)))
    .map(([id, k]) => ({ id, title: k.title, area: k.area, state: stateOf(state, id) }));
  const counts = {
    total: open.length,
    priority: Math.min(PRIORITY_MAX, open.filter((r) => r.priority === 'high' || (r.priority === 'mid' && r.cost.tokens === 0)).length),
    ...Object.fromEntries(AREAS.map((a) => [a, open.filter((r) => r.area === a).length])),
    done: rows.filter((r) => r.state === 'done').length + gone.filter((g) => g.state === 'done').length,
    skipped: rows.filter((r) => r.state === 'skipped').length + gone.filter((g) => g.state === 'skipped').length,
    applied: rows.filter((r) => r.state === 'applied').length,
    zeroTokens: open.filter((r) => r.cost.tokens === 0).length,
    cart: state.cart.length,
  };
  return {
    builtAt: built.builtAt,
    sources: built.sources.filter((x) => x.name !== 'bins').map(({ name, ok, error }) => (ok ? { name, ok } : { name, ok, error })),
    recos: [...open, ...rows.filter((r) => r.state === 'done'), ...rows.filter((r) => r.state === 'skipped')],
    gone,
    counts,
    cart: [...state.cart],
  };
}

let memo = { at: 0, home: null, value: null };

export function recosView({ maxAgeMs = 30_000, ...opts } = {}) {
  const home = relayHome();
  if (!(memo.value && memo.home === home && Date.now() - memo.at < maxAgeMs)) memo = { at: Date.now(), home, value: buildNow(opts) };
  const { before, next } = settle(memo.value);
  if (JSON.stringify(before) !== JSON.stringify(next)) writeRecoState(next);
  return view(memo.value, next);
}

export function recoOp(body) {
  const op = body?.op;
  if (!OPS.includes(op)) throw fail(400, `op must be one of ${OPS.join(', ')}`);
  const ids = op === 'cart-clear' ? [] : body.ids;
  if (op !== 'cart-clear' && !idsOk(ids, 100, 0)) throw fail(400, 'ids must be a list of at most 100 reco ids');
  if (op === 'done' || op === 'skip' || op === 'cart-add') {
    const fresh = recosView({ maxAgeMs: 0 });
    for (const id of ids) {
      const r = fresh.recos.find((x) => x.id === id && live(x.state));
      if (!r) throw fail(404, `unknown reco: ${id}`);
      if (op === 'cart-add' && r.apply.kind === 'manual') throw fail(400, 'manual recos are not applied');
    }
  }
  const state = readRecoState();
  const at = new Date().toISOString();
  if (op === 'done' || op === 'skip') {
    const into = op === 'done' ? state.done : state.skipped;
    for (const id of ids) {
      into[id] = at;
      delete state.applied[id];
    }
    state.cart = state.cart.filter((id) => !ids.includes(id));
  } else if (op === 'unskip') {
    for (const id of ids) delete state.skipped[id];
  } else if (op === 'cart-add') {
    for (const id of ids) if (!state.cart.includes(id)) state.cart.push(id);
  } else if (op === 'cart-remove') {
    state.cart = state.cart.filter((id) => !ids.includes(id));
  } else {
    state.cart = [];
  }
  writeRecoState(state);
  const v = recosView();
  return { ok: true, counts: v.counts, cart: v.cart };
}

// ---------------------------------------------------------------- apply

function checkBody(body, apply) {
  if (!isObj(body)) throw fail(400, 'the body must be an object');
  const allowed = apply ? ['ids', 'plan', 'confirm'] : ['ids', 'plan'];
  for (const k of Object.keys(body)) if (!allowed.includes(k)) throw fail(400, `unknown field: ${k}`);
  if (body.plan !== undefined) {
    if (!isObj(body.plan)) throw fail(400, 'plan must be an object');
    for (const k of Object.keys(body.plan)) if (!PLAN_FIELDS.includes(k)) throw fail(400, `unknown field: plan.${k}`);
  }
  if (!idsOk(body.ids, 50, 1)) throw fail(400, 'ids must be a list of 1 to 50 reco ids');
  if (apply && body.confirm !== true) throw fail(400, 'apply needs confirm: true');
}

// Everything apply would start, from a fresh build (never the memo); starts nothing.
function plan(body, ctx) {
  const built = buildNow(ctx);
  const { next: state } = settle(built);
  const bins = built.sources.find((x) => x.name === 'bins').items;
  const home = ctx.home ?? homedir();
  const byId = new Map(built.recos.map((r) => [r.id, r]));
  const bases = new Set(built.recos.map((r) => r.base));
  const refused = [];
  const accepted = [];
  for (const id of [...new Set(body.ids)]) {
    const r = byId.get(id);
    if (r) {
      const s = stateOf(state, id);
      if (s === 'applied' && launchEnded(state.applied[id])) accepted.push(r);
      else if (s !== 'open' && s !== 'applied') refused.push({ id, reason: s });
      else if (s === 'applied') refused.push({ id, reason: 'running' });
      else if (r.apply.kind === 'manual') refused.push({ id, reason: 'manual' });
      else accepted.push(r);
    } else refused.push({ id, reason: bases.has(baseOf(id)) ? 'changed, refresh' : 'gone' });
  }

  const commands = [];
  const runs = []; // { recos: [id], bin, argv, cwd, display, deletes }
  for (const r of accepted.filter((x) => x.apply.kind === 'command')) {
    const missing = r.apply.run.find((x) => !x.bin);
    if (missing) {
      refused.push({ id: r.id, reason: `${binName(r)} not found` });
      continue;
    }
    for (const x of r.apply.run) {
      const display = showRun(r, x);
      const same = runs.find((e) => e.display === display);
      if (same) {
        if (!same.recos.includes(r.id)) same.recos.push(r.id);
        continue;
      }
      runs.push({ recos: [r.id], bin: x.bin, argv: x.argv, cwd: x.cwd, display, deletes: x.deletes });
      commands.push({ reco: r.id, display, deletes: x.deletes });
    }
  }

  const groups = new Map();
  for (const r of accepted.filter((x) => x.apply.kind === 'plan')) {
    if (!groups.has(r.apply.rid)) groups.set(r.apply.rid, { rid: r.apply.rid, repo: r.apply.repo, repoName: r.apply.repoName, goals: [], recos: [] });
    const g = groups.get(r.apply.rid);
    g.goals.push(r.apply.goal);
    g.recos.push(r.id);
  }
  const plans = [...groups.values()].map((g) => {
    const intent = { action: 'plan', repo: g.repo, goal: g.goals.join('\n'), flow: 'bugfix', ...(body.plan ?? {}) };
    return { rid: g.rid, repoName: g.repoName, flow: 'bugfix', goal: intent.goal, recos: g.recos, intent, preview: previewLaunch(intent, ctx) };
  });

  const routines = accepted.filter((x) => x.apply.kind === 'routine').map((r) => {
    const c = r.apply.create;
    const cmd = { bin: bins.node, argv: [bins.relay, 'routine', 'new', c.id, '--kind', c.kind, '--days', c.days, '--at', c.at, '--prompt', c.prompt], cwd: home };
    return { reco: r.id, routine: r.apply.routine, create: displayCommand(cmd, 'relay'), cmd };
  });

  return { state, runs, commands, plans, routines, refused };
}

export function applyPreview(body, ctx = {}) {
  checkBody(body, false);
  const p = plan(body, ctx);
  return {
    commands: p.commands,
    plans: p.plans.map(({ intent, ...rest }) => rest),
    routines: p.routines.map(({ cmd, ...rest }) => rest),
    refused: p.refused,
  };
}

export function applyRecos(body, ctx = {}) {
  checkBody(body, true);
  const p = plan(body, ctx);
  const refused = [...p.refused];
  const plans = p.plans.filter((x) => {
    if (!x.preview.guards.errors.length) return true;
    for (const id of x.recos) refused.push({ id, reason: x.preview.guards.errors.join('; ') });
    return false;
  });
  if (!p.runs.length && !plans.length && !p.routines.length) throw fail(409, 'nothing to apply', { refused });

  const repos = readRegistry().repos;
  const repoOf = (cwd) => (Object.hasOwn(repos, cwd) ? cwd : null);
  const start = (cmd, display) => startLaunch({ action: 'reco', repo: repoOf(cmd.cwd), plan: null, harness: 'relay', bin: cmd.bin, argv: cmd.argv, cwd: cmd.cwd, env: {}, model: null, effort: null, display });
  const launches = [];
  const started = new Map(); // reco id -> launch id
  const refuse = (ids, reason) => { for (const id of ids) if (!refused.some((x) => x.id === id)) refused.push({ id, reason }); };

  for (const run of p.runs) {
    try {
      const l = start(run, run.display);
      launches.push({ id: l.id, action: l.action, display: run.display });
      for (const id of run.recos) started.set(id, l.id);
    } catch (err) {
      refuse(run.recos, err.message);
    }
  }
  for (const x of plans) {
    try {
      const { launch } = startFromIntent({ ...x.intent, confirm: true }, ctx);
      launches.push({ id: launch.id, action: launch.action, display: launch.display });
      for (const id of x.recos) started.set(id, launch.id);
    } catch (err) {
      refuse(x.recos, err.message);
    }
  }
  const routines = p.routines.map((x) => {
    try {
      const l = start(x.cmd, x.create);
      launches.push({ id: l.id, action: l.action, display: x.create });
      started.set(x.reco, l.id);
      return { reco: x.reco, routine: x.routine, launch: l.id };
    } catch (err) {
      refuse([x.reco], err.message);
      return { reco: x.reco, routine: x.routine, launch: null };
    }
  });

  const state = p.state;
  const at = new Date().toISOString();
  state.applied ??= {};
  for (const [id, launch] of started) state.applied[id] = { launch, at };
  state.cart = state.cart.filter((id) => !started.has(id));
  writeRecoState(state);
  return { launches, routines, refused };
}
