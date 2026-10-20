// relay board <plan.md> [--html] [--open] [--json]
// A traffic light for every task, lane and wave: grey planned, yellow in
// progress, green done or merged, red blocked. Computed from the plan, the lane
// and integration branches and the ledger. Writes <run>/board.json and
// .relay/board.json (read by relay's Claude Code band and pane); with --html also
// <run>/board.html, a roadmap that reloads itself. Once board.html exists, every
// `relay ledger` and `relay worktrees` call keeps it current.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { computeBoard, formatBoard } from '../lib/board.mjs';
import { renderBoardHtml } from '../lib/board-html.mjs';
import { isStale, levelFor, readSnapshot } from '../lib/budget.mjs';
import { git, mainRoot } from '../lib/git.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { planLanes, runDir } from './relay-lanes.mjs';

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
};

function subjects(root, range) {
  const out = git(['log', '--format=%s', range], root, { allowFail: true });
  return out ? out.split('\n').filter(Boolean) : [];
}

const branchExists = (root, b) => git(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], root, { allowFail: true }) !== undefined;

export function boardFor(planPath) {
  const res = planLanes(planPath);
  if (res.errors.length) return { errors: res.errors };
  const { plan, lanes } = res;
  const root = mainRoot(dirname(resolve(planPath)));
  const dir = runDir(planPath, plan.slug);
  const run = readJson(join(dir, 'run.json')) ?? {};
  const base = run.origin;
  const intBranch = `relay/${plan.slug}/integration`;
  const facts = { ledgerText: existsSync(join(dir, 'ledger.md')) ? readFileSync(join(dir, 'ledger.md'), 'utf8') : '', laneSubjects: {}, integrationSubjects: [] };
  if (root && base) {
    if (branchExists(root, intBranch)) facts.integrationSubjects = subjects(root, `${base}..${intBranch}`);
    for (const w of lanes.waves) {
      for (const l of w.lanes) {
        const b = `relay/${plan.slug}/lane-${l.id}`;
        if (branchExists(root, b)) facts.laneSubjects[l.id] = subjects(root, `${base}..${b}`);
      }
    }
  }
  const active = root && readJson(join(root, '.relay', 'lanes', 'active.json'));
  if (active?.slug === plan.slug) facts.activeWave = active.wave;
  const marathon = readJson(join(dir, 'marathon.json'));
  if (marathon) facts.marathon = { phase: marathon.phase, legs: marathon.legs?.length ?? 0, endedAt: marathon.endedAt, stopReason: marathon.stopReason, deadline: marathon.deadline };
  const snap = readSnapshot();
  const routing = loadRouting();
  if (snap && !isStale(snap, routing.budget.staleAfterMinutes)) facts.budget = { level: levelFor(snap, routing.budget), fiveHour: snap.fiveHour?.percentUsed, sevenDay: snap.sevenDay?.percentUsed, resetsAt: snap.fiveHour?.resetsAt };
  const board = computeBoard({ plan: { ...plan, goal: plan.goal ?? plan.title }, lanes, planPath: resolve(planPath), facts });
  board.planRel = root ? relative(root, resolve(planPath)) : planPath;
  return { board, dir, root };
}

export function writeBoard(planPath, { html = false } = {}) {
  const r = boardFor(planPath);
  if (r.errors) return r;
  const { board, dir, root } = r;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'board.json'), JSON.stringify(board, null, 1) + '\n');
  if (root) writeFileSync(join(root, '.relay', 'board.json'), JSON.stringify(board) + '\n');
  const htmlPath = join(dir, 'board.html');
  if (html || existsSync(htmlPath)) writeFileSync(htmlPath, renderBoardHtml(board));
  return { ...r, htmlPath: existsSync(htmlPath) ? htmlPath : undefined };
}

// Called after ledger appends and worktree operations. Never fails the caller.
export function refreshBoard(planPath) {
  try {
    writeBoard(planPath);
  } catch {
    // the board is a view; a failure here must not stop the run
  }
}

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['html', 'open', 'json'] });
  const planPath = args._[0];
  if (!planPath) {
    console.error('usage: relay board <plan.md> [--html] [--open] [--json]');
    return 64;
  }
  const r = writeBoard(planPath, { html: Boolean(args.html || args.open) });
  if (r.errors) {
    for (const e of r.errors) console.error(`✗ ${e}`);
    return 1;
  }
  if (args.json) console.log(JSON.stringify(r.board, null, 2));
  else console.log(formatBoard(r.board, { color: process.stdout.isTTY && !process.env.NO_COLOR }));
  if (r.htmlPath) console.log(`\nroadmap: ${r.htmlPath}`);
  if (args.open && r.htmlPath) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(opener, [r.htmlPath], () => {});
  }
  return 0;
}
