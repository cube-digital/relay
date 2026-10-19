// Forecast a plan run: agents, worktrees, parallelism, usage windows and hours.
// Structure (agents, worktrees, waves) is exact from the plan. Usage and time
// come from calibration when it exists, otherwise from placeholder rates that
// the output marks as such.

import { summarize, taskWeight } from './calibration.mjs';

export function roleCounts(lanes, taskById, cfg) {
  const counts = { conductor: 1, architect: 1 };
  const add = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  let expectedFixRounds = 0;
  let escalations = 0;
  for (const w of lanes.waves) {
    for (const lane of w.lanes) {
      for (const seg of lane.segments) add(seg.role);
      add('reviewer');
      const tasks = lane.tasks.map((id) => taskById[id]);
      if (tasks.some((t) => t.risk !== 'low' && t.tests > 0)) add('test-author');
      const p = Math.max(...tasks.map((t) => cfg.fixRoundProbability[t.risk] ?? 0.5));
      expectedFixRounds += p;
      escalations += lane.risk === 'high' ? 0.1 : 0;
    }
  }
  return { counts, expectedFixRounds, escalations };
}

export function laneWeights(lanes, taskById, cfg) {
  return lanes.waves.map((w) => ({
    wave: w.wave,
    lanes: w.lanes.map((l) => ({ id: l.id, weight: l.tasks.reduce((a, id) => a + taskWeight(taskById[id], cfg), 0) })),
  }));
}

// Walk the waves in time. A window ends when usage reaches `critical` or when
// `windowHours` have elapsed since its first request, whichever comes first.
export function simulate({ waves, pctPerUnit, minutesPerUnit, critical, windowHours, startPct = 0, maxParallel = Infinity }) {
  const windowMinutes = windowHours * 60;
  let clock = 0; // minutes since the start of the run
  let windowStart = 0;
  let used = startPct;
  let windows = 1;
  let waitMinutes = 0;
  let workMinutes = 0;
  const events = [];

  const openNewWindow = () => {
    const resetAt = windowStart + windowMinutes;
    if (clock < resetAt) {
      waitMinutes += resetAt - clock;
      clock = resetAt;
    }
    windowStart = clock;
    used = 0;
    windows += 1;
  };

  for (const w of waves) {
    const laneUnits = w.lanes.map((l) => l.weight);
    const pct = laneUnits.reduce((a, u) => a + u * pctPerUnit, 0);
    const parallel = Math.max(1, Math.min(maxParallel, laneUnits.length));
    // wall time: lanes run in parallel; the wave takes as long as its heaviest lane,
    // rounded up for packing when lanes exceed the parallel cap
    const sorted = [...laneUnits].sort((a, b) => b - a);
    let minutes = 0;
    for (let i = 0; i < sorted.length; i += parallel) minutes += sorted[i] * minutesPerUnit;
    if (clock - windowStart >= windowMinutes) {
      windowStart = clock;
      used = 0;
      windows += 1;
    }
    if (used + pct > critical && used > 0) openNewWindow();
    // a wave bigger than one whole window still runs; it just spans windows
    let remainingPct = pct;
    let remainingMinutes = minutes;
    while (remainingPct > 0) {
      const room = Math.max(critical - used, 0);
      const share = Math.min(1, room / remainingPct);
      const slice = Math.max(share, 0.05);
      used += remainingPct * slice;
      const dt = remainingMinutes * slice;
      clock += dt;
      workMinutes += dt;
      remainingPct -= remainingPct * slice;
      remainingMinutes -= dt;
      if (remainingPct > 0.0001) openNewWindow();
      else break;
    }
    events.push({ wave: w.wave, pct: Math.round(pct * 10) / 10, minutes: Math.round(minutes), window: windows });
  }
  return { windows, workMinutes: Math.round(workMinutes), waitMinutes: Math.round(waitMinutes), totalMinutes: Math.round(workMinutes + waitMinutes), events };
}

export function forecast({ plan, lanes, routing, calibration, budget }) {
  const cfg = routing.forecast;
  const taskById = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
  const { counts, expectedFixRounds, escalations } = roleCounts(lanes, taskById, cfg);
  const weights = laneWeights(lanes, taskById, cfg);
  const totalUnits = weights.flatMap((w) => w.lanes).reduce((a, l) => a + l.weight, 0);
  const summary = summarize(calibration ?? { samples: [] });
  const calibrated = Boolean(summary.n);
  const pctPerUnit = summary.pctPerUnit ?? cfg.defaults.pctPerUnit;
  const minutesPerUnit = summary.minutesPerUnit ?? cfg.defaults.minutesPerUnit;
  const overhead = 1 + 0.35 * (expectedFixRounds / Math.max(1, weights.flatMap((w) => w.lanes).length));
  const critical = routing.budget.fiveHour.critical;
  const startPct = budget?.fiveHour?.percentUsed ?? 0;
  const sim = simulate({
    waves: weights,
    pctPerUnit: pctPerUnit * overhead,
    minutesPerUnit: minutesPerUnit * overhead,
    critical,
    windowHours: cfg.windowHours,
    startPct,
    maxParallel: routing.lanes.maxParallelLanes,
  });
  const totalPct = Math.round(totalUnits * pctPerUnit * overhead * 10) / 10;
  const widest = Math.max(...lanes.waves.map((w) => w.lanes.length));
  const worktrees = Math.min(widest, routing.lanes.maxParallelLanes) + 1;
  const weeklyLeft = budget?.sevenDay ? Math.max(0, routing.budget.sevenDay.critical - budget.sevenDay.percentUsed) : undefined;
  return {
    slug: plan.slug,
    tasks: plan.tasks.length,
    lanes: lanes.waves.reduce((n, w) => n + w.lanes.length, 0),
    waves: lanes.waves.length,
    agents: { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), expectedFixRounds: Math.round(expectedFixRounds * 10) / 10, escalations: Math.round(escalations * 10) / 10 },
    parallel: { widest, cap: routing.lanes.maxParallelLanes },
    worktrees,
    units: Math.round(totalUnits * 10) / 10,
    calibrated,
    calibration: summary,
    rates: { pctPerUnit, minutesPerUnit, overhead: Math.round(overhead * 100) / 100 },
    usage: { totalPct, startPct, critical, windows: sim.windows, weeklyPct: totalPct, weeklyLeft, fitsWeekly: weeklyLeft === undefined ? undefined : totalPct <= weeklyLeft },
    time: { workMinutes: sim.workMinutes, waitMinutes: sim.waitMinutes, totalMinutes: sim.totalMinutes },
    perWave: sim.events,
  };
}

function hhmm(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

export function formatForecast(f) {
  const out = [];
  out.push(`forecast for ${f.slug}: ${f.tasks} tasks · ${f.lanes} lanes · ${f.waves} wave(s)`);
  const roles = Object.entries(f.agents.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  out.push(`agents       ~${f.agents.total} starts (${roles}), plus ~${f.agents.expectedFixRounds} fix round(s) on resumed agents` + (f.agents.escalations ? `, ~${f.agents.escalations} escalation(s)` : ''));
  out.push(`parallel     up to ${Math.min(f.parallel.widest, f.parallel.cap)} lane(s) at once (plan allows ${f.parallel.widest}, cap ${f.parallel.cap})`);
  out.push(`worktrees    ${f.worktrees} (${f.worktrees - 1} lane slot(s) reused across waves + 1 integration)`);
  const tag = f.calibrated ? `calibrated from ${f.calibration.n} wave(s)` : 'PLACEHOLDER rates, not your data: run a plan, then `relay calibrate`';
  out.push(`usage        ~${f.usage.totalPct}% of a 5h window in total (${f.units} units × ${f.rates.pctPerUnit.toFixed(2)}% × ${f.rates.overhead} review overhead) — ${tag}`);
  const start = f.usage.startPct ? `, starting from ${f.usage.startPct}% used` : '';
  out.push(`windows      ~${f.usage.windows} five-hour window(s) at the ${f.usage.critical}% stop line${start}`);
  if (f.usage.weeklyLeft !== undefined) {
    out.push(`weekly       needs ~${f.usage.weeklyPct}% of the weekly limit; ${f.usage.weeklyLeft}% left before its stop line` + (f.usage.fitsWeekly ? '' : ' — DOES NOT FIT: split the plan or offload reviews to Codex'));
  }
  out.push(`time         ~${hhmm(f.time.workMinutes)} of work` + (f.time.waitMinutes ? ` + ~${hhmm(f.time.waitMinutes)} waiting for resets = ~${hhmm(f.time.totalMinutes)}` : ''));
  for (const e of f.perWave) out.push(`  wave ${e.wave}: ~${e.pct}% · ~${hhmm(e.minutes)} · window ${e.window}`);
  return out.join('\n');
}
