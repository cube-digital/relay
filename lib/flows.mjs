// Flows and pieces: building blocks at fixed points around relay's lane chassis.
// pieces/<id>.json is one block (role, allowed points, when it applies, brief,
// output); flows/<id>.json places pieces at points. The CLI resolves them, never a model.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchesAny } from './glob.mjs';
import { RISKS } from './plan.mjs';
import { RELAY_ROOT, TIERS } from './routing.mjs';
import { loadTeam } from './team.mjs';

export const POINTS = ['plan.before', 'plan.after', 'lane.before', 'lane.after', 'wave.after', 'final'];
export const LANE_POINTS = ['lane.before', 'lane.after'];
export const GATES = ['blocking', 'advisory'];
export const WHEN_KEYS = ['any', 'risk', 'tier', 'testsAtLeast', 'files', 'tags'];
export const DEFAULT_FLOW = 'feature';
const PIECE_KEYS = ['id', 'title', 'role', 'slots', 'skills', 'when', 'requires', 'brief', 'output', 'gate', 'readonly', 'protect'];
const FLOW_KEYS = ['id', 'title', 'slots', 'overrides'];
const OVERRIDABLE = ['when', 'gate'];
const KEBAB = /^[a-z0-9][a-z0-9-]*$/;
const PLACEHOLDER = /\{([^}]*)\}/g;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

function readJsonDir(root, dirName, problems) {
  const out = new Map();
  const dir = join(root, dirName);
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let value;
    try {
      value = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      problems.push(`${dirName}/${f}: not valid JSON`);
      continue;
    }
    if (!isObj(value)) problems.push(`${dirName}/${f}: must be a JSON object`);
    else out.set(f.replace(/\.json$/, ''), value);
  }
  return out;
}

// Never throws: unreadable files become problems.
export function loadFlowSet(root = RELAY_ROOT) {
  const problems = [];
  const pieces = readJsonDir(root, 'pieces', problems);
  const flows = readJsonDir(root, 'flows', problems);
  return { pieces, flows, problems };
}

export function whenProblems(when, at) {
  if (when === undefined) return [];
  if (!isObj(when)) return [`${at}: when must be an object`];
  const out = [];
  for (const [k, v] of Object.entries(when)) {
    if (!WHEN_KEYS.includes(k)) out.push(`${at}: unknown when key "${k}" (keys: ${WHEN_KEYS.join(', ')})`);
    else if (k === 'any') {
      if (!Array.isArray(v) || !v.length) out.push(`${at}: when.any must be a non-empty list of conditions`);
      else v.forEach((w, i) => out.push(...whenProblems(w, `${at} when.any[${i}]`)));
    } else if (k === 'risk' && !(strings(v) && v.length && v.every((x) => RISKS.includes(x)))) out.push(`${at}: when.risk must list risks (${RISKS.join(', ')})`);
    else if (k === 'tier' && !(strings(v) && v.length && v.every((x) => TIERS.includes(x)))) out.push(`${at}: when.tier must list tiers (${TIERS.join(', ')})`);
    else if (k === 'testsAtLeast' && !(Number.isInteger(v) && v >= 0)) out.push(`${at}: when.testsAtLeast must be a whole number >= 0`);
    else if ((k === 'files' || k === 'tags') && !(strings(v) && v.length)) out.push(`${at}: when.${k} must be a non-empty list of strings`);
  }
  return out;
}

function placeholderProblems(text, allowed, at, field) {
  return [...String(text).matchAll(PLACEHOLDER)]
    .filter((m) => !allowed.includes(m[1]))
    .map((m) => `${at}: ${field} placeholder "{${m[1]}}" is not valid for its points (allowed: ${allowed.map((a) => `{${a}}`).join(', ')})`);
}

function pieceProblems(id, p, { roles, skills }) {
  const at = `pieces/${id}.json`;
  const out = [];
  if (p.id !== id) out.push(`${at}: id must be "${id}" (the file name)`);
  if (!KEBAB.test(id)) out.push(`${at}: id must be kebab-case`);
  for (const k of Object.keys(p)) if (!PIECE_KEYS.includes(k) && !k.startsWith('$')) out.push(`${at}: unknown field "${k}"`);
  if (typeof p.title !== 'string' || !p.title) out.push(`${at}: title is required`);
  if (!roles.has(p.role)) out.push(`${at}: role "${p.role}" is not a role in roles/`);
  if (!strings(p.slots) || !p.slots.length) out.push(`${at}: slots must list the points it may sit at (${POINTS.join(', ')})`);
  else for (const s of p.slots) if (!POINTS.includes(s)) out.push(`${at}: slot "${s}" is not a point (${POINTS.join(', ')})`);
  if (p.skills !== undefined && !strings(p.skills)) out.push(`${at}: skills must be a list of skill folders`);
  for (const s of strings(p.skills) ? p.skills : []) if (!skills.has(s)) out.push(`${at}: skill "${s}" is not a folder in skills/`);
  out.push(...whenProblems(p.when, at));
  if (p.requires !== undefined && !strings(p.requires)) out.push(`${at}: requires must be a list of paths`);
  for (const r of strings(p.requires) ? p.requires : []) out.push(...placeholderProblems(r, ['slug', 'run', 'docs'], at, 'requires'));
  if (typeof p.brief !== 'string' || !p.brief.trim()) out.push(`${at}: brief is required`);
  if (typeof p.output !== 'string' || !p.output) out.push(`${at}: output is required`);
  else {
    const laneOnly = strings(p.slots) && p.slots.length > 0 && p.slots.every((s) => LANE_POINTS.includes(s));
    out.push(...placeholderProblems(p.output, laneOnly ? ['slug', 'run', 'lane'] : ['slug', 'run'], at, 'output'));
  }
  if (!GATES.includes(p.gate)) out.push(`${at}: gate must be one of ${GATES.join(', ')}`);
  for (const k of ['readonly', 'protect']) if (p[k] !== undefined && typeof p[k] !== 'boolean') out.push(`${at}: ${k} must be true or false`);
  if (p.readonly === true && p.protect === true) out.push(`${at}: a read-only piece cannot write protected tests`);
  return out;
}

function flowFileProblems(id, f, pieces) {
  const at = `flows/${id}.json`;
  const out = [];
  if (f.id !== id) out.push(`${at}: id must be "${id}" (the file name)`);
  for (const k of Object.keys(f)) if (!FLOW_KEYS.includes(k) && !k.startsWith('$')) out.push(`${at}: unknown field "${k}"`);
  if (typeof f.title !== 'string' || !f.title) out.push(`${at}: title is required`);
  if (!isObj(f.slots)) return [...out, `${at}: slots must map points to lists of pieces`];
  for (const [point, ids] of Object.entries(f.slots)) {
    if (!POINTS.includes(point)) {
      out.push(`${at}: "${point}" is not a point (${POINTS.join(', ')})`);
      continue;
    }
    if (!strings(ids)) {
      out.push(`${at}: slots.${point} must be a list of piece ids`);
      continue;
    }
    ids.forEach((pid, i) => {
      const p = pieces.get(pid);
      if (ids.indexOf(pid) !== i) out.push(`${at}: piece "${pid}" is placed twice at ${point}`);
      else if (!p) out.push(`${at}: piece "${pid}" at ${point} does not exist in pieces/`);
      else if (!strings(p.slots) || !p.slots.includes(point)) out.push(`${at}: piece "${pid}" cannot sit at ${point} (its slots: ${strings(p.slots) ? p.slots.join(', ') : 'none'})`);
    });
  }
  if (f.overrides !== undefined && !isObj(f.overrides)) out.push(`${at}: overrides must be an object`);
  const placed = new Set(Object.values(f.slots).filter(strings).flat());
  for (const [pid, o] of Object.entries(isObj(f.overrides) ? f.overrides : {})) {
    const where = `${at} overrides.${pid}`;
    if (!placed.has(pid)) out.push(`${where}: the piece is not placed in this flow`);
    if (!isObj(o)) {
      out.push(`${where}: must be an object`);
      continue;
    }
    for (const k of Object.keys(o)) if (!OVERRIDABLE.includes(k)) out.push(`${where}: ${k} cannot be overridden (only ${OVERRIDABLE.join(', ')})`);
    out.push(...whenProblems(o.when, where));
    if (o.gate !== undefined && !GATES.includes(o.gate)) out.push(`${where}: gate must be one of ${GATES.join(', ')}`);
  }
  return out;
}

// roles: Map of role name → team member; skills: Set of skill folder names.
export function flowProblems(set, { roles, skills }) {
  const out = [];
  for (const [id, p] of set.pieces) out.push(...pieceProblems(id, p, { roles, skills }));
  for (const [id, f] of set.flows) out.push(...flowFileProblems(id, f, set.pieces));
  if (!set.flows.has(DEFAULT_FLOW)) out.push(`flows/${DEFAULT_FLOW}.json is missing (plans without "flow" run as ${DEFAULT_FLOW})`);
  return out;
}

export function effectivePiece(flow, piece) {
  const o = isObj(flow?.overrides?.[piece.id]) ? flow.overrides[piece.id] : {};
  const out = { ...piece };
  for (const k of OVERRIDABLE) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

// All keys must hold; `any` holds when one of its conditions does. Missing `when` = always.
export function matchWhen(when, tasks) {
  if (!isObj(when)) return true;
  return Object.entries(when).every(([k, v]) => {
    if (k === 'any') return Array.isArray(v) && v.some((w) => matchWhen(w, tasks));
    if (k === 'risk') return v.includes(RISKS[Math.max(-1, ...tasks.map((t) => RISKS.indexOf(t.risk)))]);
    if (k === 'tier') return tasks.some((t) => v.includes(t.tier));
    if (k === 'testsAtLeast') return tasks.reduce((s, t) => s + (t.tests ?? 0), 0) >= v;
    if (k === 'files') return tasks.some((t) => (t.files ?? []).some((f) => matchesAny(f, v)));
    if (k === 'tags') return tasks.some((t) => (t.tags ?? []).some((x) => v.includes(x)));
    return false;
  });
}

export function whenSummary(when) {
  if (!isObj(when) || !Object.keys(when).length) return 'always';
  const part = ([k, v]) => {
    if (k === 'any') return `any of (${v.map(whenSummary).join(' | ')})`;
    if (k === 'testsAtLeast') return `tests >= ${v}`;
    return `${k} ${[].concat(v).join(', ')}`;
  };
  return Object.entries(when).map(part).join(' and ');
}

// What a piece needs before it runs, for listings: `{docs}` is the plan's business documentation.
export function requiresSummary(requires) {
  return (requires ?? []).map((r) => (r === '{docs}' ? 'business docs (--business-docs)' : r)).join(', ');
}

// Unknown placeholders stay as written.
export function fillPlaceholders(text, vars) {
  return String(text).replace(PLACEHOLDER, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

// The pieces of a flow at one point, for a lane's tasks (lane points) or the plan's.
// vars: { slug, run, lane, docs }; exists(path) checks a filled `requires` path. A `requires`
// placeholder nobody filled (no --docs) is an input the plan was not given: the piece is skipped.
export function piecesAt({ set, flowId, point, tasks, lane, vars, exists = existsSync }) {
  const flow = set.flows.get(flowId);
  if (!flow) throw new Error(`unknown flow "${flowId}"`);
  const apply = [];
  const skipped = [];
  for (const id of flow.slots?.[point] ?? []) {
    const raw = set.pieces.get(id);
    if (!raw) {
      skipped.push({ piece: id, kind: 'missing', reason: `pieces/${id}.json does not exist` });
      continue;
    }
    const piece = effectivePiece(flow, raw);
    if (!matchWhen(piece.when, tasks)) {
      skipped.push({ piece: id, kind: 'when', reason: `when ${whenSummary(piece.when)} does not hold` });
      continue;
    }
    const required = (piece.requires ?? []).map((r) => fillPlaceholders(r, vars));
    const unset = required.find((p) => /\{[^}]*\}/.test(p));
    if (unset !== undefined) {
      skipped.push({ piece: id, kind: 'input', reason: unset.includes('{docs}') ? 'no business documentation given (--docs <path>)' : `${unset} not given` });
      continue;
    }
    const missing = required.find((p) => !exists(p));
    if (missing !== undefined) {
      skipped.push({ piece: id, kind: 'requires', reason: `requires ${missing} missing` });
      continue;
    }
    apply.push({ ...piece, point, agent: lane ? `lane-${lane}-${id}` : id, report: fillPlaceholders(piece.output, vars) });
  }
  return { apply, skipped };
}

// Lanes from computeLanes plus the pieces that apply to each lane (lane points) and
// to the plan (wave.after, final), by `when` only; `relay flow at` checks `requires`.
export function attachPieces(plan, lanes, set = loadFlowSet(), team = loadTeam()) {
  const flowId = plan.flow ?? DEFAULT_FLOW;
  const flow = set.flows.get(flowId);
  const tierOf = new Map(team.map((r) => [r.name, r.tier]));
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const at = (point, tasks) =>
    (flow?.slots?.[point] ?? [])
      .map((id) => set.pieces.get(id))
      .filter(Boolean)
      .map((p) => effectivePiece(flow, p))
      .filter((p) => matchWhen(p.when, tasks))
      .map((p) => ({ piece: p.id, point, role: p.role, tier: tierOf.get(p.role) ?? 'mid', gate: p.gate, readonly: Boolean(p.readonly) }));
  for (const w of lanes.waves) {
    for (const lane of w.lanes) {
      const tasks = lane.tasks.map((id) => byId.get(id)).filter(Boolean);
      lane.pieces = LANE_POINTS.flatMap((point) => at(point, tasks));
    }
  }
  lanes.flow = flowId;
  lanes.planPieces = ['wave.after', 'final'].flatMap((point) => at(point, plan.tasks));
  return lanes;
}

// The plan's flow, task roles (builders only) and tags.
export function planFlowProblems(plan, set = loadFlowSet(), team = loadTeam()) {
  const errors = [];
  const warnings = [];
  const flowId = plan.flow ?? DEFAULT_FLOW;
  if (typeof flowId !== 'string' || !set.flows.has(flowId)) errors.push(`flow "${flowId}" is not a flow (known: ${[...set.flows.keys()].sort().join(', ') || 'none'})`);
  const roles = new Map(team.map((r) => [r.name, r]));
  const builders = team.filter((r) => r.kind === 'builder').map((r) => r.name);
  for (const t of plan.tasks) {
    const at = `task ${t.id}`;
    if (t.tags !== undefined && !strings(t.tags)) errors.push(`${at}: tags must be a list of strings`);
    if (t.role === undefined) continue;
    const r = roles.get(t.role);
    if (!r) errors.push(`${at}: role "${t.role}" is not a role in roles/`);
    else if (r.kind !== 'builder') errors.push(`${at}: role "${t.role}" is a ${r.kind || 'role without a kind'}; a task's role must be a builder (${builders.join(', ')})`);
    else if (r.tier !== t.tier) warnings.push(`${at}: tier ${t.tier} differs from ${t.role}'s tier ${r.tier}; the role's tier decides the model`);
  }
  return { errors, warnings };
}
