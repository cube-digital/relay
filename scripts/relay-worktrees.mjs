// relay worktrees <sync|merge|pack|status|clean> ...
//
// A reusable pool of lane worktrees per plan. Worktrees are created once (and
// dependencies installed once); between waves each slot is moved to the new
// integration head instead of creating a fresh worktree.
//
//   sync  <plan> --wave N            create/reuse slots, branch lanes from the integration head,
//                                    write .relay/lanes/active.json (the Claude mod reads it to put
//                                    agents named lane-<id> into their worktree)
//   merge <plan> --wave N [--suite]  merge the wave's lane branches into relay/<slug>/integration, then run the
//                                    plan's suite once in the integration worktree
//   pack  <plan> <lane> [--from REF] review package (commits, stat, diff) for a lane, or a fix range
//   pack  <plan> --final             whole-branch package for the final review
//   status [<plan>]                  what is active, ahead counts, dirty slots
//   clean <plan>                     remove the plan's worktrees (branches are kept)

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { ensureExcluded, git, mainRoot } from '../lib/git.mjs';
import { describeSegments, planLanes, renderBrief, runDir } from './relay-lanes.mjs';

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'poetry.lock', 'uv.lock', 'requirements.txt', 'Pipfile.lock', 'Cargo.lock', 'go.sum', 'Gemfile.lock', 'composer.lock'];

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function context(planPath) {
  const res = planLanes(planPath);
  if (res.errors.length) throw new Error(`plan is invalid:\n  ${res.errors.join('\n  ')}`);
  const root = mainRoot(dirname(resolve(planPath)));
  if (!root) throw new Error('the plan must live inside a git repository');
  const slug = res.plan.slug;
  return {
    ...res,
    root,
    slug,
    dir: runDir(planPath, slug),
    intBranch: `relay/${slug}/integration`,
    intPath: join(root, '.claude', 'worktrees', `relay-${slug}-int`),
    slotPath: (k) => join(root, '.claude', 'worktrees', `relay-${slug}-${k}`),
    activePath: join(root, '.relay', 'lanes', 'active.json'),
  };
}

function branchExists(root, branch) {
  return git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root, { allowFail: true }) !== undefined;
}

function aheadCount(root, base, branch) {
  return Number(git(['rev-list', '--count', `${base}..${branch}`], root));
}

function setupHash(root, setup) {
  const h = createHash('sha1').update(setup ?? '');
  for (const f of LOCKFILES) if (existsSync(join(root, f))) h.update(f).update(readFileSync(join(root, f)));
  return h.digest('hex');
}

function copyWorktreeInclude(root, slot) {
  const list = join(root, '.worktreeinclude');
  if (!existsSync(list)) return;
  for (const raw of readFileSync(list, 'utf8').split('\n')) {
    const rel = raw.trim();
    if (!rel || rel.startsWith('#') || /[*?[]/.test(rel)) continue; // literal paths only in v0.1
    const from = join(root, rel);
    const to = join(slot, rel);
    if (existsSync(from) && !existsSync(to)) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

function ensureIntegration(ctx) {
  const { root, intBranch, intPath, dir } = ctx;
  const runPath = join(dir, 'run.json');
  const run = readJson(runPath, {});
  if (!branchExists(root, intBranch)) {
    const origin = git(['rev-parse', 'HEAD'], root);
    git(['branch', intBranch, origin], root);
    run.origin = origin;
    run.startedAt = new Date().toISOString();
  }
  run.origin ??= git(['merge-base', 'HEAD', intBranch], root);
  writeJson(runPath, run);
  if (!existsSync(intPath)) git(['worktree', 'add', intPath, intBranch], root);
  return run;
}

export function sync(ctx, wave) {
  const { root, slug, lanes, plan, dir } = ctx;
  const w = lanes.waves[wave - 1];
  if (!w) throw new Error(`plan ${slug} has ${lanes.waves.length} wave(s); there is no wave ${wave}`);
  ensureExcluded(root, ['.relay/', '.claude/worktrees/']);
  mkdirSync(dir, { recursive: true });
  ensureIntegration(ctx);
  const intHead = git(['rev-parse', ctx.intBranch], root);
  const slotsPath = join(root, '.relay', 'slots.json');
  const slots = readJson(slotsPath, {});
  const wantSetup = setupHash(root, plan.setup);
  const active = { slug, plan: resolve(ctx.planPath), wave, integration: { branch: ctx.intBranch, worktree: ctx.intPath, head: intHead }, lanes: {} };
  const report = [];

  w.lanes.forEach((lane, i) => {
    const slot = ctx.slotPath(i + 1);
    const branch = `relay/${slug}/lane-${lane.id}`;
    const hasWork = branchExists(root, branch) && aheadCount(root, intHead, branch) > 0;
    let state;
    if (existsSync(slot)) {
      const dirty = git(['status', '--porcelain'], slot);
      const current = git(['branch', '--show-current'], slot);
      if (hasWork && current === branch) state = 'kept (lane has unmerged commits)';
      else if (dirty) throw new Error(`slot ${slot} has uncommitted changes; commit or discard them first`);
      else if (hasWork) throw new Error(`branch ${branch} has unmerged commits but slot ${slot} is on ${current}; merge or move it first`);
      else {
        git(['checkout', '-B', branch, intHead], slot);
        state = 'reused';
      }
    } else {
      mkdirSync(dirname(slot), { recursive: true });
      if (hasWork) git(['worktree', 'add', slot, branch], root);
      else git(['worktree', 'add', '-B', branch, slot, intHead], root);
      copyWorktreeInclude(root, slot);
      state = 'created';
    }
    if (plan.setup && slots[slot]?.setupHash !== wantSetup) {
      console.log(`· setup in ${slot}: ${plan.setup}`);
      execSync(plan.setup, { cwd: slot, stdio: 'inherit', shell: '/bin/sh' });
      slots[slot] = { setupHash: wantSetup, at: new Date().toISOString() };
    }
    const brief = join(dir, `lane-${lane.id}.brief.md`);
    writeFileSync(brief, renderBrief({ plan, planPath: ctx.planPath, lane, dir, specLine: ctx.specLine }));
    active.lanes[lane.id] = {
      worktree: slot,
      branch,
      base: intHead,
      tier: lane.tier,
      risk: lane.risk,
      segments: lane.segments,
      tasks: lane.tasks,
      brief,
      report: join(dir, `lane-${lane.id}.report.md`),
    };
    report.push(`  lane-${lane.id}  ${state.padEnd(34)} ${slot}\n      ${describeSegments(lane)}`);
  });

  writeJson(slotsPath, slots);
  writeJson(ctx.activePath, active);
  console.log(`wave ${wave}/${lanes.waves.length} of ${slug}: integration ${ctx.intBranch} @ ${intHead.slice(0, 7)}`);
  for (const line of report) console.log(line);
  console.log(`active lanes → ${ctx.activePath}`);
  return active;
}

export function merge(ctx, wave, { suite = false } = {}) {
  const active = readJson(ctx.activePath, undefined);
  if (!active || active.slug !== ctx.slug || active.wave !== wave) throw new Error(`wave ${wave} of ${ctx.slug} is not the active wave; run sync first`);
  const int = ctx.intPath;
  if (git(['status', '--porcelain'], int)) throw new Error(`integration worktree ${int} is dirty`);
  for (const [id, lane] of Object.entries(active.lanes)) {
    const ahead = aheadCount(ctx.root, lane.base, lane.branch);
    if (!ahead) {
      console.log(`· lane-${id}: no commits, skipped`);
      continue;
    }
    const ok = git(['merge', '--no-ff', '--no-edit', '-m', `relay: merge lane ${id} (${lane.tasks.join(', ')})`, lane.branch], int, { allowFail: true });
    if (ok === undefined) {
      const conflicts = git(['diff', '--name-only', '--diff-filter=U'], int, { allowFail: true }) ?? '';
      git(['merge', '--abort'], int, { allowFail: true });
      console.error(`✗ lane-${id} conflicts with the integration branch in:\n  ${conflicts.split('\n').join('\n  ')}`);
      console.error(`  Resume lane-${id} with: "rebase ${lane.branch} onto ${ctx.intBranch}, resolve, rerun the touched tasks' done checks", then merge again.`);
      return 2;
    }
    console.log(`✓ lane-${id}: merged ${ahead} commit(s)`);
  }
  const head = git(['rev-parse', 'HEAD'], int);
  console.log(`integration ${ctx.intBranch} @ ${head.slice(0, 7)}`);
  if (suite) {
    if (!ctx.plan.suite) {
      console.log('· plan has no "suite" command; skipped');
      return 0;
    }
    console.log(`· suite (once per wave) in ${int}: ${ctx.plan.suite}`);
    try {
      execSync(ctx.plan.suite, { cwd: int, stdio: 'inherit', shell: '/bin/sh' });
      console.log('✓ suite passed');
    } catch {
      console.error('✗ suite failed');
      return 3;
    }
  }
  return 0;
}

export function pack(ctx, laneId, { from, final = false } = {}) {
  const active = readJson(ctx.activePath, {});
  let base;
  let head;
  let title;
  let extra = [];
  if (final) {
    const run = readJson(join(ctx.dir, 'run.json'), {});
    base = run.origin ?? git(['merge-base', 'HEAD', ctx.intBranch], ctx.root);
    head = ctx.intBranch;
    title = `Final review package — ${ctx.slug}`;
    extra = [`Ledger: ${join(ctx.dir, 'ledger.md')}`];
  } else {
    const lane = active.lanes?.[laneId];
    if (!lane) throw new Error(`lane ${laneId} is not active (run sync for its wave)`);
    base = from ?? lane.base;
    head = lane.branch;
    title = `Review package — lane ${laneId} (${ctx.slug}, wave ${active.wave})${from ? ` — fix range from ${from}` : ''}`;
    extra = [`Brief: ${lane.brief}`, `Report: ${lane.report}`];
  }
  const range = `${base}..${head}`;
  const body = [
    `# ${title}`,
    '',
    ...extra,
    `Range: ${range}`,
    '',
    '## Commits',
    '',
    '```',
    git(['log', '--oneline', range], ctx.root) || '(none)',
    '```',
    '',
    '## Stat',
    '',
    '```',
    git(['diff', '--stat', range], ctx.root) || '(empty)',
    '```',
    '',
    '## Diff',
    '',
    '```diff',
    git(['diff', '-U10', range], ctx.root),
    '```',
    '',
  ].join('\n');
  const name = final ? 'final.review.md' : `lane-${laneId}${from ? `.fix-${String(from).slice(0, 7)}` : ''}.review.md`;
  const out = join(ctx.dir, name);
  mkdirSync(ctx.dir, { recursive: true });
  writeFileSync(out, body);
  console.log(out);
  return out;
}

export function status(root) {
  const activePath = join(root, '.relay', 'lanes', 'active.json');
  const active = readJson(activePath, undefined);
  if (!active) {
    console.log('no active lanes');
    return 0;
  }
  console.log(`${active.slug}: wave ${active.wave}, integration ${active.integration.branch}`);
  for (const [id, l] of Object.entries(active.lanes)) {
    const ahead = existsSync(l.worktree) ? aheadCount(root, l.base, l.branch) : 0;
    const dirty = existsSync(l.worktree) && git(['status', '--porcelain'], l.worktree) ? ', dirty' : '';
    console.log(`  lane-${id}  +${ahead} commit(s)${dirty}  ${l.segments.map((s) => `${s.role}(${s.tasks.join(' → ')})`).join(', then ')}`);
  }
  return 0;
}

export function clean(ctx) {
  const list = git(['worktree', 'list', '--porcelain'], ctx.root)
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length));
  const prefix = join(ctx.root, '.claude', 'worktrees', `relay-${ctx.slug}-`);
  let failed = 0;
  for (const wt of list.filter((p) => p.startsWith(prefix))) {
    if (git(['worktree', 'remove', wt], ctx.root, { allowFail: true }) === undefined) {
      console.error(`✗ kept ${wt} (uncommitted changes?)`);
      failed++;
    } else console.log(`✓ removed ${wt}`);
  }
  return failed ? 1 : 0;
}

export function main(argv) {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest, { booleans: ['suite', 'final'] });
  try {
    if (cmd === 'status') {
      const root = args._[0] ? mainRoot(dirname(resolve(args._[0]))) : mainRoot(process.cwd());
      return status(root ?? process.cwd());
    }
    const planPath = args._[0];
    if (!['sync', 'merge', 'pack', 'clean'].includes(cmd) || !planPath) {
      console.error('usage: relay worktrees <sync|merge|pack|status|clean> <plan.md> [--wave N] [--suite] [<lane> [--from REF] | --final]');
      return 64;
    }
    const ctx = { ...context(planPath), planPath };
    if (cmd === 'sync') return sync(ctx, Number(args.wave ?? 1)) ? 0 : 1;
    if (cmd === 'merge') return merge(ctx, Number(args.wave ?? 1), { suite: Boolean(args.suite) });
    if (cmd === 'pack') return pack(ctx, args._[1], { from: args.from, final: Boolean(args.final) }) ? 0 : 1;
    if (cmd === 'clean') return clean(ctx);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    return 1;
  }
  return 64;
}
