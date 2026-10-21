// relay flow list | show <flow> | at <plan> <point> [--lane id] [--json] | at --flow <f> --slug <s> <point>
//            | done <plan> <piece> [--lane id] --status S --report P [--protect path...] | add | remove
// Resolves flows and pieces for the orchestrator: briefs, agent names, ledger lines. Never a model.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { ensureExcluded, git, mainRoot } from '../lib/git.mjs';
import { effectivePiece, fillPlaceholders, LANE_POINTS, loadFlowSet, piecesAt, POINTS, whenSummary } from '../lib/flows.mjs';
import { RELAY_ROOT } from '../lib/routing.mjs';
import { checkFlow } from './build.mjs';
import { planLanes, runDir } from './relay-lanes.mjs';
import { appendLedger } from './relay-ledger.mjs';
import { main as protect } from './relay-protect.mjs';

const USAGE = `usage:
  relay flow list
  relay flow show <flow>
  relay flow at <plan> <point> [--lane <id>] [--json]
  relay flow at --flow <flow> --slug <slug> <point> [--json]
  relay flow done <plan> <piece> [--lane <id>] --status pass|findings|blocked --report <path> [--protect <path>...]
  relay flow add <flow> <piece> --at <point>
  relay flow remove <flow> <piece> [--at <point>]`;
const KEBAB = /^[a-z0-9][a-z0-9-]*$/;
const sourceRoot = () => process.env.RELAY_SOURCE_ROOT || RELAY_ROOT;

function list() {
  const set = loadFlowSet();
  for (const [id, f] of set.flows) {
    const pts = POINTS.filter((p) => f.slots?.[p]?.length).map((p) => `${p}: ${f.slots[p].join(', ')}`);
    console.log(`${id}  ${f.title ?? id}  ${pts.join(' · ')}`);
  }
  console.log('');
  for (const [id, p] of set.pieces) {
    console.log(`${id}  role ${p.role} · slots ${(p.slots ?? []).join(', ')} · ${p.gate}${p.readonly ? ' · read-only' : ''}${p.protect ? ' · protects tests' : ''}`);
  }
  return 0;
}

function show(id) {
  const set = loadFlowSet();
  const flow = set.flows.get(id);
  if (!flow) {
    console.error(`✗ unknown flow "${id}" (flows: ${[...set.flows.keys()].join(', ')})`);
    return 1;
  }
  console.log(`${id} — ${flow.title ?? id}`);
  for (const point of POINTS) {
    console.log(point);
    const ids = flow.slots?.[point] ?? [];
    if (!ids.length) console.log('  (none)');
    for (const pid of ids) {
      const raw = set.pieces.get(pid);
      if (!raw) {
        console.log(`  ${pid}  (missing piece)`);
        continue;
      }
      const p = effectivePiece(flow, raw);
      console.log(`  ${pid}  ${p.role} · ${p.gate} · when ${whenSummary(p.when)}`);
    }
  }
  return 0;
}

function planOrFail(planPath) {
  const res = planLanes(planPath);
  if (res.errors.length) {
    for (const e of res.errors) console.error(`✗ ${e}`);
    return undefined;
  }
  return res;
}

function readRecords(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function briefText({ p, point, flowId, planPath, slug, specLine, lane, run, report, skills, canRead }) {
  const out = [`# Piece ${p.id}: ${p.title}`, ''];
  out.push(`Point: ${point} · Flow: ${flowId} · Role: ${p.role} · Gate: ${p.gate} · Read-only: ${p.readonly ? 'yes' : 'no'}`);
  out.push(planPath ? `Plan: ${resolve(planPath)}` : `Plan: not written yet (slug ${slug})`);
  if (specLine) out.push(`Spec: ${specLine}`);
  if (lane) out.push(`Lane: ${lane} · brief ${join(run, `lane-${lane}.brief.md`)} · branch relay/${slug}/lane-${lane}`);
  out.push(`Report: ${report}`);
  if (skills.length) out.push(`Skills: ${skills.join(', ')}`);
  if (canRead.length) out.push('Can read:', ...canRead.map((c) => `- ${c}`));
  out.push('', '## What to do', '', p.filled, '', '## Rules', '');
  out.push(`- ${p.readonly ? 'You are read-only: never edit files, never commit.' : 'Write only what the instruction names; commit tests on their own.'}`);
  if (p.protect) out.push('- List every test path you wrote after protect: in your return; they become protected tests.');
  out.push('', '## Return', '', 'At most 5 lines:', 'STATUS: DONE | NEEDS_CONTEXT | BLOCKED', 'result: pass | findings', `report: ${report}`);
  if (p.protect) out.push('protect: <paths>');
  return out.join('\n') + '\n';
}

function refFor(point, slug, lane) {
  if (LANE_POINTS.includes(point)) return `relay/${slug}/lane-${lane}`;
  if (point === 'wave.after' || point === 'final') return `relay/${slug}/integration`;
  return 'HEAD';
}

function at(argv) {
  const args = parseArgs(argv, { booleans: ['json'] });
  const flowForm = typeof args.flow === 'string';
  const planPath = flowForm ? undefined : args._[0];
  const point = flowForm ? args._[0] : args._[1];
  if (!point || (!flowForm && !planPath)) {
    console.error(USAGE);
    return 64;
  }
  if (!POINTS.includes(point)) {
    console.error(`✗ unknown point "${point}" (points: ${POINTS.join(', ')})`);
    return 64;
  }
  const lane = typeof args.lane === 'string' ? args.lane : undefined;
  const isLanePoint = LANE_POINTS.includes(point);
  const set = loadFlowSet();
  let flowId, slug, root, run, tasks, specLine;
  if (flowForm) {
    if (typeof args.slug !== 'string' || !KEBAB.test(args.slug)) {
      console.error('✗ --flow needs --slug <kebab-case slug>');
      return 64;
    }
    if (isLanePoint) {
      console.error('✗ lane points need a plan');
      return 64;
    }
    if (!set.flows.has(args.flow)) {
      console.error(`✗ unknown flow "${args.flow}" (flows: ${[...set.flows.keys()].join(', ')})`);
      return 1;
    }
    root = mainRoot(process.cwd());
    if (!root) {
      console.error('✗ run inside a git repository');
      return 1;
    }
    flowId = args.flow;
    slug = args.slug;
    run = join(root, '.relay', 'runs', slug);
    tasks = [];
  } else {
    const res = planOrFail(planPath);
    if (!res) return 1;
    flowId = res.plan.flow;
    slug = res.plan.slug;
    specLine = res.specLine;
    root = mainRoot(dirname(resolve(planPath))) ?? dirname(resolve(planPath));
    run = runDir(planPath, slug);
    if (isLanePoint) {
      if (!lane) {
        console.error(`✗ ${point} needs --lane <id>`);
        return 64;
      }
      const all = res.lanes.waves.flatMap((w) => w.lanes);
      const l = all.find((x) => x.id === lane);
      if (!l) {
        console.error(`✗ plan ${slug} has no lane "${lane}" (lanes: ${all.map((x) => x.id).join(', ')})`);
        return 1;
      }
      tasks = l.tasks.map((id) => res.plan.tasks.find((t) => t.id === id)).filter(Boolean);
    } else tasks = res.plan.tasks;
  }
  ensureExcluded(root, ['.relay/']); // run files must never be swept into a lane commit
  const laneVar = isLanePoint ? lane : undefined;
  const vars = { slug, run, lane: laneVar };
  const { apply, skipped } = piecesAt({ set, flowId, point, tasks, lane: laneVar, vars, exists: (p) => existsSync(resolve(root, p)) });

  // outputs of the flow's other pieces, in the order they appear
  const flow = set.flows.get(flowId);
  const placed = [...new Set(Object.values(flow.slots ?? {}).flat())].map((id) => set.pieces.get(id)).filter(Boolean);

  const piecesDir = join(run, 'pieces');
  const items = [];
  for (const p of apply) {
    const canRead = [];
    for (const o of placed) {
      if (o.id === p.id || !o.output) continue;
      if (/\{lane\}/.test(o.output) && !laneVar) continue;
      const path = resolve(root, fillPlaceholders(o.output, vars));
      if (existsSync(path)) canRead.push(path);
    }
    if (point === 'lane.after') {
      const lr = join(run, `lane-${lane}.report.md`);
      if (existsSync(lr)) canRead.push(lr);
    }
    const report = resolve(root, p.report);
    const brief = join(piecesDir, `${p.agent}.brief.md`);
    mkdirSync(piecesDir, { recursive: true });
    writeFileSync(brief, briefText({ p: { ...p, filled: fillPlaceholders(p.brief, vars) }, point, flowId, planPath, slug, specLine, lane: laneVar, run, report, skills: p.skills ?? [], canRead }));
    items.push({ p, report, brief });
  }

  const ro = items.filter((i) => i.p.readonly);
  if (ro.length) {
    const file = join(run, 'pieces.json');
    const records = readRecords(file);
    for (const { p } of ro) {
      let ref = refFor(point, slug, laneVar);
      let head = git(['rev-parse', '--verify', '--quiet', ref], root, { allowFail: true });
      if (!head) {
        ref = 'HEAD';
        head = git(['rev-parse', '--verify', '--quiet', 'HEAD'], root, { allowFail: true }) ?? '';
      }
      records[p.agent] = { piece: p.id, lane: laneVar ?? null, point, ref, head, at: new Date().toISOString() };
    }
    mkdirSync(run, { recursive: true });
    writeFileSync(file, JSON.stringify(records, null, 2) + '\n');
  }

  if (planPath) {
    for (const s of skipped.filter((x) => x.kind === 'requires')) {
      const path = /^requires (.*) missing$/.exec(s.reason)?.[1] ?? s.reason;
      appendLedger(planPath, `piece ${s.piece}${laneVar ? ` lane ${laneVar}` : ''}: skipped (requires ${path} missing)`);
    }
  }

  if (args.json) {
    console.log(JSON.stringify({
      point, flow: flowId, slug, lane: laneVar ?? null,
      pieces: items.map(({ p, report, brief }) => ({ piece: p.id, title: p.title, role: p.role, gate: p.gate, readonly: Boolean(p.readonly), protect: Boolean(p.protect), agent: p.agent, brief, report })),
      skipped: skipped.map(({ piece, kind, reason }) => ({ piece, kind, reason })),
    }, null, 2));
    return 0;
  }
  if (!items.length && !skipped.length) console.log(`(no pieces at ${point})`);
  for (const { p, report, brief } of items) console.log(`${p.id}  ${p.role} · ${p.gate}${p.readonly ? ' · read-only' : ''}  agent ${p.agent}  brief ${brief}  report ${report}`);
  for (const s of skipped) console.log(`skip ${s.piece}: ${s.reason}`);
  return 0;
}

function done(argv) {
  // --protect takes every following argument up to the next --flag
  const protectPaths = [];
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--protect') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) protectPaths.push(argv[++i]);
    } else rest.push(argv[i]);
  }
  const args = parseArgs(rest);
  const [planPath, pieceId] = args._;
  const lane = typeof args.lane === 'string' ? args.lane : undefined;
  if (!planPath || !pieceId || !['pass', 'findings', 'blocked'].includes(args.status) || typeof args.report !== 'string') {
    console.error(USAGE);
    return 64;
  }
  const res = planOrFail(planPath);
  if (!res) return 1;
  const piece = loadFlowSet().pieces.get(pieceId);
  if (!piece) {
    console.error(`✗ unknown piece "${pieceId}"`);
    return 1;
  }
  const slug = res.plan.slug;
  const agent = lane ? `lane-${lane}-${pieceId}` : pieceId;
  const tag = `piece ${pieceId}${lane ? ` lane ${lane}` : ''}`;
  const report = args.report;
  if (piece.protect && args.status === 'pass' && !protectPaths.length) {
    console.error(`✗ ${pieceId} writes protected tests: --status pass needs --protect <path>...`);
    return 1;
  }
  const root = mainRoot(dirname(resolve(planPath))) ?? dirname(resolve(planPath));
  if (piece.readonly) {
    const rec = readRecords(join(runDir(planPath, slug), 'pieces.json'))[agent];
    if (!rec) {
      console.error(`✗ no relay flow at record for ${agent}; run relay flow at first`);
      return 1;
    }
    const now = git(['rev-parse', '--verify', '--quiet', rec.ref], root, { allowFail: true }) ?? '';
    if (now !== rec.head) {
      const subjects = (git(['log', '--format=%s', `${rec.head}..${now}`], root, { allowFail: true }) ?? '').split('\n').filter(Boolean);
      const line = `${tag}: blocked (${report}) committed: ${subjects.join('; ')}`;
      appendLedger(planPath, line);
      console.log(line);
      console.error(`✗ ${agent} is read-only and committed; rule on it (nothing was reset)`);
      return 1;
    }
  }
  if (protectPaths.length && protect(['add', ...protectPaths]) !== 0) return 1;
  const line = `${tag}: ${args.status} (${report})`;
  appendLedger(planPath, line);
  console.log(line);
  return 0;
}

// flows/<flow>.json under the source root: edit, re-check, restore on problems.
function editFlow(flowId, mutate) {
  const src = sourceRoot();
  const file = join(src, 'flows', `${flowId}.json`);
  if (!existsSync(file)) {
    console.error(`✗ unknown flow "${flowId}"`);
    return 1;
  }
  const original = readFileSync(file, 'utf8');
  const flow = JSON.parse(original);
  const err = mutate(flow, loadFlowSet(src));
  if (err) {
    console.error(`✗ ${err}`);
    return 1;
  }
  writeFileSync(file, JSON.stringify(flow, null, 2) + '\n');
  const problems = checkFlow(src).filter((p) => p.includes(`flows/${flowId}.json`));
  if (problems.length) {
    writeFileSync(file, original);
    for (const p of problems) console.error(`✗ ${p}`);
    return 1;
  }
  console.log(`wrote ${file}`);
  console.log('run `relay build --check`');
  return 0;
}

function add(argv) {
  const args = parseArgs(argv);
  const [flowId, pieceId] = args._;
  if (!flowId || !pieceId || typeof args.at !== 'string') {
    console.error(USAGE);
    return 64;
  }
  return editFlow(flowId, (flow, set) => {
    const piece = set.pieces.get(pieceId);
    if (!piece) return `unknown piece "${pieceId}"`;
    if (!(piece.slots ?? []).includes(args.at)) return `piece ${pieceId} cannot go at ${args.at} (its slots: ${(piece.slots ?? []).join(', ')})`;
    flow.slots ??= {};
    if ((flow.slots[args.at] ?? []).includes(pieceId)) return `${pieceId} is already at ${args.at} in ${flowId}`;
    flow.slots[args.at] = [...(flow.slots[args.at] ?? []), pieceId];
    return undefined;
  });
}

function remove(argv) {
  const args = parseArgs(argv);
  const [flowId, pieceId] = args._;
  if (!flowId || !pieceId) {
    console.error(USAGE);
    return 64;
  }
  return editFlow(flowId, (flow) => {
    let hit = false;
    for (const point of Object.keys(flow.slots ?? {})) {
      if (typeof args.at === 'string' && args.at !== point) continue;
      if (!flow.slots[point].includes(pieceId)) continue;
      hit = true;
      flow.slots[point] = flow.slots[point].filter((x) => x !== pieceId);
      if (!flow.slots[point].length) delete flow.slots[point];
    }
    return hit ? undefined : `${pieceId} is not placed${typeof args.at === 'string' ? ` at ${args.at}` : ''} in ${flowId}`;
  });
}

export function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'list') return list();
  if (cmd === 'show' && rest[0]) return show(rest[0]);
  if (cmd === 'at') return at(rest);
  if (cmd === 'done') return done(rest);
  if (cmd === 'add') return add(rest);
  if (cmd === 'remove') return remove(rest);
  console.error(USAGE);
  return 64;
}
