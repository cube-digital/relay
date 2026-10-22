// Data for the HQ Home page: today's timeline, running plans with lane segments, the routines
// panel, brain counts, team status and the 14-section ring. Pure over its inputs where it can be.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runDir } from '../../scripts/relay-lanes.mjs';
import { RELAY_ROOT, loadRouting, modelFor } from '../routing.mjs';
import { instanceView } from '../routines/info.mjs';
import { weekSlots } from '../routines/schedule.mjs';
import { listInstances, listRuns } from '../routines/store.mjs';
import { loadTemplates } from '../routines/templates.mjs';
import { loadTeam } from '../team.mjs';
import { brainConnectors, brainKeys } from './brain.mjs';
import { listSkills, wiring } from './catalog.mjs';

const LEDGER_RE = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: \[[^\]]*\])? (.*)$/;
const harnessLabel = (harness) => (harness === 'relay' ? 'relay CLI' : (harness ?? ''));
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayStart = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate());
const dayBounds = (now) => {
  const s = dayStart(now);
  return [s, new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1)];
};
const safe = (fn, fallback) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

// [{ at: Date, text }] of a ledger, oldest first as written.
function ledgerLines(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = LEDGER_RE.exec(line);
    if (!m) continue;
    const at = new Date(`${m[1]}T${m[2]}:00Z`);
    if (!Number.isNaN(at.getTime())) out.push({ at, text: m[3] });
  }
  return out;
}

const row = (at, text, tag, tone, href) => ({ at: at.toISOString(), time: hhmm(at), text, tag, tone, href, closest: false });

function runTag(run) {
  if (run.outcome === 'new') return [`${run.new?.length ?? 0} NEW`, 'accent'];
  if (run.outcome === 'failed') return ['FAILED', 'red'];
  if (run.outcome === 'skipped') return ['SKIPPED', 'mute'];
  if (run.outcome === 'report') return ['REPORT', 'mute'];
  return ['DONE', 'mute'];
}

export function todayRows({ repos = [], launches = [], now = new Date() } = {}) {
  const [from, to] = dayBounds(now);
  const today = (d) => d >= from && d < to;
  const rows = [];

  const templates = safe(() => loadTemplates().templates, []);
  for (const inst of safe(() => listInstances(), [])) {
    try {
      const view = instanceView(inst, { now, templates });
      const text = `${view.title} · ${view.scopeLabel}`;
      const href = `#/routines/${inst.id}`;
      for (const run of listRuns(inst.id, { limit: 50 })) {
        const at = new Date(run.startedAt);
        if (!today(at)) continue;
        const [tag, tone] = runTag(run);
        rows.push(row(at, text, tag, tone, href));
      }
      if (inst.registration?.state !== 'disabled') {
        for (const slot of weekSlots(inst.schedule, now)) if (today(slot) && slot > now) rows.push(row(slot, text, 'SCHEDULED', 'mute', href));
      }
    } catch {
      // one broken instance does not hide the rest
    }
  }

  for (const l of launches) {
    const href = `#/launches/${l.id}`;
    if (l.startedAt && today(new Date(l.startedAt))) rows.push(row(new Date(l.startedAt), `${l.action} started on ${harnessLabel(l.harness)}`, 'LAUNCH', 'mute', href));
    if (l.endedAt && today(new Date(l.endedAt))) rows.push(row(new Date(l.endedAt), `${l.action} ${l.status}`, String(l.status).toUpperCase(), ['failed', 'lost'].includes(l.status) ? 'red' : 'mute', href));
  }

  for (const r of repos) {
    const runs = join(r.path, '.relay', 'runs');
    for (const slug of safe(() => readdirSync(runs), [])) {
      for (const { at, text } of safe(() => ledgerLines(join(runs, slug, 'ledger.md')), [])) {
        if (!today(at)) continue;
        let tag;
        let tone = 'mute';
        if (/^start:/.test(text)) tag = 'START';
        else if (/^plan: complete\b/.test(text)) [tag, tone] = ['COMPLETE', 'accent'];
        else if (/^wave (\d+): merged\b/.test(text)) tag = 'MERGED';
        else if (/\bBLOCKED\b/.test(text) || /\blane [a-z]+\b.*\bblocked\b/i.test(text)) [tag, tone] = ['BLOCKED', 'red'];
        else continue;
        rows.push(row(at, `${slug}: ${text.slice(0, 80)}`, tag, tone, `#/repos/${r.rid}/plans/${slug}`));
      }
    }
  }

  rows.sort((a, b) => a.at.localeCompare(b.at));
  let best = -1;
  rows.forEach((x, i) => {
    if (best < 0 || Math.abs(Date.parse(x.at) - now) < Math.abs(Date.parse(rows[best].at) - now)) best = i;
  });
  if (best >= 0) rows[best].closest = true;
  return rows;
}

const GROUP = { working: 'running', blocked: 'running', done: 'finished', merged: 'finished' };

export function runningPlan(summary, plan, { launches = [], routing = loadRouting(), team = loadTeam(RELAY_ROOT) } = {}) {
  const mine = launches.filter((l) => l.repo === summary.path && l.plan === plan.file);
  const live = mine.find((l) => l.status === 'running') ?? null;
  const harness = (live ?? mine[0])?.harness === 'codex' ? 'codex' : 'claude';
  const members = new Map(team.map((m) => [m.name, m]));
  const lines = safe(() => ledgerLines(join(runDir(join(summary.path, plan.file), plan.slug), 'ledger.md')), []);
  let lastStart = -1;
  lines.forEach((l, i) => {
    if (/^start:/.test(l.text)) lastStart = i;
  });
  const after = lastStart < 0 ? [] : lines.slice(lastStart + 1);
  const groups = { running: [], finished: [], planned: [] };
  const tiles = new Map();

  for (const w of plan.board?.waves ?? []) {
    for (const lane of w.lanes) {
      const name = lane.agents?.[0];
      const m = members.get(name);
      const mdl = modelFor(routing, lane.tier, harness);
      const tasks = lane.tasks ?? [];
      const isDone = (t) => t.state === 'done' || t.state === 'merged';
      const t = tasks.find((x) => x.state === 'working' || x.state === 'blocked') ?? tasks.find((x) => !isDone(x)) ?? null;
      const re = new RegExp(`\\blane[- ]${lane.id}(?![a-z])`, 'i');
      const seen = after.find((l) => re.test(l.text));
      const seg = {
        lane: lane.id,
        role: name ?? '',
        title: m?.title || name || '',
        kind: m?.kind || 'builder',
        hex: m?.hex ?? '',
        avatar: m?.avatar ?? '',
        model: mdl.model,
        effort: mdl.effort,
        task: t ? { id: t.id, title: t.title } : null,
        tasks: tasks.map((x) => x.id),
        done: tasks.filter(isDone).length,
        total: tasks.length,
        fix: /fix round (\d+\/\d+)/.exec(lane.note ?? '')?.[1] ?? null,
        status: ['working', 'blocked', 'done', 'merged'].includes(lane.state) ? lane.state : 'planned',
        since: seen ? seen.at.toISOString() : null,
      };
      const group = GROUP[lane.state] ?? 'planned';
      groups[group].push(seg);
      if (group === 'running' && m) tiles.set(m.name, { role: m.name, title: m.title, avatar: m.avatar, hex: m.hex });
    }
  }
  const href = `#/repos/${summary.rid}/plans/${plan.slug}`;
  return {
    rid: summary.rid,
    repoName: summary.name,
    slug: plan.slug,
    file: plan.file,
    title: plan.title,
    status: plan.status,
    green: plan.green,
    totals: plan.totals,
    currentWave: plan.currentWave,
    waveCount: plan.waveCount,
    roles: [...tiles.values()],
    launch: live,
    href,
    kpis: {
      green: plan.green,
      total: plan.totals?.tasks ?? 0,
      wave: plan.currentWave,
      waves: plan.waveCount,
      lanes: { running: groups.running.length, finished: groups.finished.length, planned: groups.planned.length },
      startedAt: lastStart < 0 ? null : lines[lastStart].at.toISOString(),
    },
    groups,
  };
}

const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function routineRows({ now = new Date() } = {}) {
  const [from, to] = dayBounds(now);
  const tomorrowEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  const templates = safe(() => loadTemplates().templates, []);
  const rows = [];
  const nexts = [];
  for (const inst of safe(() => listInstances(), [])) {
    if (inst.registration?.state === 'disabled') continue;
    try {
      const view = instanceView(inst, { now, templates });
      const base = { id: inst.id, title: view.title, scopeLabel: view.scopeLabel, harness: view.harness, href: `#/routines/${inst.id}` };
      for (const run of listRuns(inst.id, { limit: 50 })) {
        const at = new Date(run.startedAt);
        if (at < from || at >= to) continue;
        const [status, tone] = run.outcome === 'new' ? [`${run.new?.length ?? 0} NEW`, 'accent'] : run.outcome === 'failed' ? ['FAILED', 'red'] : ['DONE', 'mute'];
        rows.push({ ...base, time: hhmm(at), at: at.toISOString(), status, tone });
      }
      if (view.nextRun) nexts.push({ base, at: new Date(view.nextRun) });
    } catch {
      // skip this instance
    }
  }
  const earliest = nexts.filter((n) => n.at < to).sort((a, b) => a.at - b.at)[0];
  for (const n of nexts) {
    const status = n === earliest ? 'NEXT' : n.at < to ? 'QUEUED' : n.at < tomorrowEnd ? 'TOMORROW' : WEEKDAY[n.at.getDay()];
    rows.push({ ...n.base, time: hhmm(n.at), at: n.at.toISOString(), status, tone: status === 'NEXT' ? 'accent' : 'mute' });
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

let brainMemo = null;
export function brainCounts({ home, env, relayRoot } = {}) {
  const key = JSON.stringify([home, relayRoot, env ? Object.keys(env).length : null]);
  if (brainMemo && brainMemo.key === key && Date.now() - brainMemo.at < 60_000) return brainMemo.value;
  const opts = { home, env, relayRoot };
  const wire = safe(() => wiring({ relayRoot }), null);
  const keys = safe(() => brainKeys(opts).keys, []);
  const value = {
    team: safe(() => loadTeam(relayRoot ?? RELAY_ROOT).length, 0),
    flows: wire?.flows?.length ?? 0,
    pieces: wire?.pieces?.length ?? 0,
    skills: safe(() => listSkills({ ...(home ? { home } : {}), ...(relayRoot ? { relayRoot } : {}) }).skills.length, 0),
    connectors: safe(() => brainConnectors(opts).connectors.length, 0),
    keys: keys.length,
    keysMissing: keys.filter((k) => k.status === 'missing').length,
  };
  brainMemo = { key, at: Date.now(), value };
  return value;
}

export function teamStatus(plans = []) {
  const working = new Set();
  for (const p of plans) for (const w of p.board?.waves ?? p.waves ?? []) for (const l of w.lanes) if (l.state === 'working' && l.agents?.[0]) working.add(l.agents[0]);
  return loadTeam(RELAY_ROOT).map((m) => ({ role: m.name, title: m.title, kind: m.kind, hex: m.hex, working: working.has(m.name) }));
}

export function ringFor({ projects = [], plans = [], runningPlans = [], launches = [], activityToday = 0, routines = 0, attentionRoutine = 0, recos = [], budget = {}, brain = {} } = {}) {
  const first = runningPlans[0];
  const hotBoard = runningPlans.some((p) => Object.values(p.groups ?? {}).flat().some((s) => s.status === 'blocked'));
  const running = launches.filter((l) => l.status === 'running').length;
  const five = budget?.fiveHour;
  const keys = brain.keys ?? 0;
  const missing = brain.keysMissing ?? 0;
  const lanes = first?.kpis?.lanes?.running ?? 0;
  const pctFive = typeof five === 'number' ? `${Math.round(five)}%` : '?';
  const item = (id, label, glyph, href, count, detail, hot = false) => ({ id, label, glyph, href, count: String(count), detail, hot: Boolean(hot) });
  return [
    item('projects', 'Projects', '▦', '#/projects', projects.length, `${projects.length} registered`),
    item('plans', 'Plans', '☰', '#/projects', plans.length, `${plans.length} total`),
    item('board', 'Board', '◫', first?.href ?? '#/projects', lanes, `${lanes} lanes running`, hotBoard),
    item('team', 'Team', '☺', '#/brain/team', brain.team ?? 0, `${brain.team ?? 0} roles`),
    item('flows', 'Flows', '⇄', '#/brain/flows', brain.flows ?? 0, `${brain.flows ?? 0} defined`),
    item('pieces', 'Pieces', '◆', '#/brain/flows', brain.pieces ?? 0, `${brain.pieces ?? 0} defined`),
    item('skills', 'Skills', '⚡', '#/brain/skills', brain.skills ?? 0, `${brain.skills ?? 0} installed`),
    item('connectors', 'Connectors', '⚭', '#/brain/connectors', brain.connectors ?? 0, `${brain.connectors ?? 0} configured`),
    item('keys', 'API keys', '⚿', '#/brain/keys', keys, missing > 0 ? `${missing} of ${keys} missing` : `${keys} set`, missing > 0),
    item('routines', 'Routines', '◷', '#/routines', routines, `${routines} today`, attentionRoutine > 0),
    item('launches', 'Launches', '▶', '#/launches', running, `${running} running`),
    item('activity', 'Activity', '≋', '#/activity', activityToday, `${activityToday} today`),
    item('recos', 'Recos', '✦', '#/recos', recos.length, `${recos.length} open`, recos.some((r) => r.priority === 'high')),
    item('budget', 'Budget', '◔', '#budget', pctFive, typeof five === 'number' ? `${pctFive} of 5h` : '5h unknown', budget?.level === 'tight' || budget?.level === 'critical'),
  ];
}
