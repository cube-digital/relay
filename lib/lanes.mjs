// Partition plan tasks into lanes (one worktree + one implementer each) and waves.
//
// 1. Tasks that touch overlapping files share a lane (no merge conflicts between lanes).
// 2. Dependency cycles between lanes collapse into one lane.
// 3. A lane whose only predecessor has it as its only successor is folded into
//    that predecessor while the lane stays small (a chain needs no merge between steps).
// 4. Waves are the longest-path levels of the lane graph.
// 5. A wave with more lanes than maxParallelLanes packs its smallest lanes together.

import { maxTier, tierRank } from './routing.mjs';
import { RISKS } from './plan.mjs';

function normPath(p) {
  let s = String(p).trim().replace(/^\.\//, '');
  const glob = s.search(/[*?[]/);
  if (glob !== -1) {
    const cut = s.lastIndexOf('/', glob);
    return { path: cut === -1 ? '' : s.slice(0, cut + 1), dir: true };
  }
  return { path: s, dir: s.endsWith('/') };
}

export function pathsOverlap(a, b) {
  const x = normPath(a);
  const y = normPath(b);
  if (x.path === y.path) return true;
  if (x.dir && y.path.startsWith(x.path)) return true;
  if (y.dir && x.path.startsWith(y.path)) return true;
  return false;
}

function filesOverlap(fa, fb) {
  return fa.some((a) => fb.some((b) => pathsOverlap(a, b)));
}

function laneIdFor(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function computeLanes(plan, { maxLaneTasks = 6, maxParallelLanes = 4 } = {}) {
  const tasks = plan.tasks;
  const n = tasks.length;
  const index = new Map(tasks.map((t, i) => [t.id, i]));
  const parent = tasks.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const sizeOf = (root) => tasks.reduce((c, _, i) => c + (find(i) === root ? 1 : 0), 0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (filesOverlap(tasks[i].files, tasks[j].files)) union(i, j);
    }
  }

  const graph = () => {
    const preds = new Map();
    const succs = new Map();
    for (let i = 0; i < n; i++) {
      const g = find(i);
      if (!preds.has(g)) preds.set(g, new Set());
      if (!succs.has(g)) succs.set(g, new Set());
    }
    tasks.forEach((t, i) => {
      for (const d of t.deps) {
        const from = find(index.get(String(d)));
        const to = find(i);
        if (from !== to) {
          preds.get(to).add(from);
          succs.get(from).add(to);
        }
      }
    });
    return { preds, succs };
  };

  // 2. collapse cycles between lanes
  for (;;) {
    const { succs } = graph();
    const cycle = findGroupCycle(succs);
    if (!cycle) break;
    for (const g of cycle) union(cycle[0], g);
  }

  // 3. fold simple chains
  for (let changed = true; changed; ) {
    changed = false;
    const { preds, succs } = graph();
    for (const [b, ps] of preds) {
      if (ps.size !== 1) continue;
      const a = [...ps][0];
      if (succs.get(a).size !== 1) continue;
      if (sizeOf(a) + sizeOf(b) > maxLaneTasks) continue;
      union(a, b);
      changed = true;
      break;
    }
  }

  // 4. waves
  const { preds } = graph();
  const level = new Map();
  const levelOf = (g) => {
    if (level.has(g)) return level.get(g);
    const l = 1 + Math.max(0, ...[...preds.get(g)].map(levelOf));
    level.set(g, l);
    return l;
  };
  const groups = [...preds.keys()];
  groups.forEach(levelOf);

  // 5. respect the parallel cap inside each wave
  const warnings = [];
  const waveCount = Math.max(...groups.map((g) => level.get(g)));
  for (let w = 1; w <= waveCount; w++) {
    for (;;) {
      const inWave = [...new Set(tasks.map((_, i) => find(i)))].filter((g) => level.get(g) === w);
      if (inWave.length <= maxParallelLanes) break;
      inWave.sort((x, y) => sizeOf(x) - sizeOf(y) || x - y);
      const [small, next] = inWave;
      union(small, next);
      const merged = find(small);
      level.set(merged, w);
      if (sizeOf(merged) > maxLaneTasks) warnings.push(`wave ${w}: packed lanes past maxLaneTasks to stay within ${maxParallelLanes} parallel lanes`);
    }
  }

  // assemble
  const byGroup = new Map();
  tasks.forEach((t, i) => {
    const g = find(i);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(i);
  });
  const ordered = [...byGroup.entries()].sort(([ga, ia], [gb, ib]) => (level.get(ga) ?? levelOfAfter(ga)) - (level.get(gb) ?? levelOfAfter(gb)) || ia[0] - ib[0]);
  function levelOfAfter(g) {
    return level.get(g) ?? 1;
  }

  const waves = [];
  ordered.forEach(([g, members], k) => {
    const lane = {
      id: laneIdFor(k),
      wave: level.get(g) ?? 1,
      tier: maxTier(members.map((i) => tasks[i].tier)),
      risk: RISKS[Math.max(...members.map((i) => RISKS.indexOf(tasks[i].risk)))],
      tasks: topoOrder(members, tasks, index),
      files: [...new Set(members.flatMap((i) => tasks[i].files))],
      tests: members.reduce((s, i) => s + (tasks[i].tests ?? 0), 0),
    };
    lane.segments = segmentsFor(lane.tasks.map((id) => tasks[index.get(id)]));
    let wave = waves.find((x) => x.wave === lane.wave);
    if (!wave) waves.push((wave = { wave: lane.wave, lanes: [] }));
    wave.lanes.push(lane);
  });
  waves.sort((a, b) => a.wave - b.wave);
  waves.forEach((w, i) => {
    w.wave = i + 1;
    for (const l of w.lanes) l.wave = i + 1;
  });
  return { slug: plan.slug, waves, warnings: [...new Set(warnings)] };
}

function topoOrder(members, tasks, index) {
  const set = new Set(members);
  const remaining = new Set(members);
  const out = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter((i) => tasks[i].deps.every((d) => !set.has(index.get(String(d))) || !remaining.has(index.get(String(d)))))
      .sort((a, b) => a - b);
    const pick = ready[0] ?? Math.min(...remaining);
    out.push(tasks[pick].id);
    remaining.delete(pick);
  }
  return out;
}

function findGroupCycle(succs) {
  const state = new Map();
  const stack = [];
  const visit = (g) => {
    if (state.get(g) === 'done') return undefined;
    if (state.get(g) === 'open') return stack.slice(stack.indexOf(g));
    state.set(g, 'open');
    stack.push(g);
    for (const s of succs.get(g) ?? []) {
      const c = visit(s);
      if (c) return c;
    }
    stack.pop();
    state.set(g, 'done');
    return undefined;
  };
  for (const g of succs.keys()) {
    const c = visit(g);
    if (c) return c;
  }
  return undefined;
}

// One implementer per lane, except that strong tasks get their own agent (same
// worktree, run in sequence), so an Opus-class task does not pull the lane's
// routine tasks onto the most expensive model.
export function roleFor(laneTasks) {
  if (laneTasks.some((t) => t.tier === 'strong')) return 'implementer-deep';
  const cheapOnly = laneTasks.every((t) => t.tier === 'cheap' && (t.code === 'complete' || t.files.length === 1));
  return cheapOnly ? 'implementer-fast' : 'implementer';
}

export function segmentsFor(laneTasks) {
  const runs = [];
  for (const t of laneTasks) {
    const strong = t.tier === 'strong';
    const last = runs.at(-1);
    if (last && last.strong === strong) last.tasks.push(t);
    else runs.push({ strong, tasks: [t] });
  }
  return runs.map((r, i) => ({
    agent: i === 0 ? null : `s${i + 1}`,
    tier: maxTier(r.tasks.map((t) => t.tier)),
    role: roleFor(r.tasks),
    tasks: r.tasks.map((t) => t.id),
  }));
}

export function agentName(laneId, segment) {
  return segment?.agent ? `lane-${laneId}-${segment.agent}` : `lane-${laneId}`;
}

export function laneTierRank(lane) {
  return tierRank(lane.tier);
}
