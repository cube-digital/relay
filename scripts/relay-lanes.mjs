// relay lanes <plan.md> [--json] [--write] [--max-lanes N] [--max-lane-tasks N]
// Validates a plan, partitions its tasks into lanes and waves, and (with --write)
// writes lanes.json plus one brief per lane under <repo>/.relay/runs/<slug>/.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { mainRoot } from '../lib/git.mjs';
import { attachPieces, loadFlowSet, planFlowProblems } from '../lib/flows.mjs';
import { agentName, computeLanes } from '../lib/lanes.mjs';
import { parsePlan, validatePlan } from '../lib/plan.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { loadTeam } from '../lib/team.mjs';

export function runDir(planPath, slug) {
  const root = mainRoot(dirname(resolve(planPath))) ?? dirname(resolve(planPath));
  return join(root, '.relay', 'runs', slug);
}

export function planLanes(planPath, opts = {}) {
  const text = readFileSync(planPath, 'utf8');
  const plan = parsePlan(text);
  const validated = validatePlan(plan);
  const set = loadFlowSet();
  const team = loadTeam();
  const flowCheck = planFlowProblems(plan, set, team);
  const errors = [...validated.errors, ...flowCheck.errors];
  const warnings = [...validated.warnings, ...flowCheck.warnings];
  if (errors.length) return { plan, errors, warnings };
  const cfg = loadRouting().lanes ?? {};
  const lanes = computeLanes(plan, {
    maxLaneTasks: Number(opts.maxLaneTasks ?? cfg.maxLaneTasks ?? 6),
    maxParallelLanes: Number(opts.maxLanes ?? cfg.maxParallelLanes ?? 4),
  });
  attachPieces(plan, lanes, set, team);
  return { plan, errors, warnings: [...warnings, ...lanes.warnings], lanes, specLine: /^\*\*Spec:\*\*\s*(.+)$/m.exec(text)?.[1]?.trim() };
}

export function describeSegments(lane) {
  return lane.segments.map((s) => `${agentName(lane.id, s)}=${s.role}(${s.tasks.join(' → ')})`).join(', then ');
}

export function renderBrief({ plan, planPath, lane, dir, specLine }) {
  const tasks = lane.tasks.map((id) => plan.tasks.find((t) => t.id === id));
  const out = [];
  out.push(`# Lane ${lane.id} — ${plan.slug} (wave ${lane.wave})`, '');
  out.push(`Plan: ${resolve(planPath)}`);
  if (specLine) out.push(`Spec: ${specLine}`);
  out.push(`Tier: ${lane.tier} · Risk: ${lane.risk} · Tasks: ${lane.tasks.join(' → ')}`);
  out.push(`Flow: ${plan.flow}`);
  out.push(`Report: ${join(dir, `lane-${lane.id}.report.md`)}`, '');
  if (lane.segments.length > 1) {
    out.push('This lane is split between agents that work in the same worktree, one after the other:');
    for (const s of lane.segments) out.push(`- ${agentName(lane.id, s)} (${s.role}): ${s.tasks.join(', ')}`);
    out.push('Do only the tasks assigned to your agent name; earlier tasks are already committed.', '');
  }
  out.push('Do the tasks in order, one commit per task. Exact values below are binding. Follow the qa-mindset skill for tests.', '');
  if (plan.globalConstraints) out.push('## Global Constraints', '', plan.globalConstraints, '');
  out.push('## Tasks', '');
  for (const t of tasks) {
    out.push(plan.sections[t.id] ?? `### ${t.id}: ${t.title}`, '');
    out.push('Relay metadata:');
    out.push(`- tier: ${t.tier} · risk: ${t.risk} · code in plan: ${t.code}`);
    if (t.role) out.push(`- role: ${t.role}`);
    if (t.tags?.length) out.push(`- tags: ${t.tags.join(', ')}`);
    out.push(`- files: ${t.files.join(', ')}`);
    if (t.deps.length) out.push(`- depends on: ${t.deps.join(', ')}`);
    out.push(`- new-test budget: ${t.tests}${t.behaviors.length ? ` · behaviors: ${t.behaviors.map((b) => `"${b}"`).join('; ')}` : ''}`);
    out.push(`- done when: \`${t.done}\``, '');
  }
  return out.join('\n');
}

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['json', 'write'] });
  const planPath = args._[0];
  if (!planPath) {
    console.error('usage: relay lanes <plan.md> [--json] [--write] [--max-lanes N] [--max-lane-tasks N]');
    return 64;
  }
  const res = planLanes(planPath, { maxLanes: args['max-lanes'], maxLaneTasks: args['max-lane-tasks'] });
  if (res.errors.length) {
    for (const e of res.errors) console.error(`✗ ${e}`);
    for (const w of res.warnings) console.error(`! ${w}`);
    return 1;
  }
  const { plan, lanes } = res;
  if (args.write) {
    const dir = runDir(planPath, plan.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lanes.json'), JSON.stringify(lanes, null, 2) + '\n');
    for (const w of lanes.waves) {
      for (const lane of w.lanes) {
        writeFileSync(join(dir, `lane-${lane.id}.brief.md`), renderBrief({ plan, planPath, lane, dir, specLine: res.specLine }));
      }
    }
    if (!args.json) console.log(`wrote ${join(dir, 'lanes.json')} and ${lanes.waves.reduce((n, w) => n + w.lanes.length, 0)} lane briefs`);
  }
  if (args.json) {
    console.log(JSON.stringify({ ...lanes, warnings: res.warnings }, null, 2));
    return 0;
  }
  const laneCount = lanes.waves.reduce((n, w) => n + w.lanes.length, 0);
  console.log(`plan ${plan.slug}: ${plan.tasks.length} tasks → ${laneCount} lanes in ${lanes.waves.length} wave(s)`);
  console.log(`flow ${lanes.flow}`);
  for (const w of lanes.waves) {
    console.log(`wave ${w.wave}`);
    for (const l of w.lanes) {
      const pieces = l.pieces?.length ? ` · pieces ${l.pieces.map((p) => p.piece).join(', ')}` : '';
      console.log(`  lane ${l.id}  [risk ${l.risk}, new tests ≤ ${l.tests}]  ${describeSegments(l)}${pieces}`);
    }
  }
  for (const w of res.warnings) console.log(`! ${w}`);
  return 0;
}
