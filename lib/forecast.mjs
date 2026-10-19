// Forecast a plan run: agents, worktrees, parallelism, usage windows and hours.
// Structure (agents, worktrees, waves) is exact from the plan. Usage and time
// come from calibration when it exists, otherwise from placeholder rates that
// the output marks as such.
//
// The model works in expected lane weights W̃ = W·(1 + κ·p) (see calibration.mjs):
// usage of a wave = r·ΣW̃, its time = m·makespan(W̃). Calibration measures r and m
// against the same W̃, so fix rounds are counted once.

import { laneModel, makespan, summarize } from './calibration.mjs';

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

// Per wave, each lane's work (base), fix-round probability (p) and expected weight (weight).
export function laneWeights(lanes, taskById, cfg) {
  return lanes.waves.map((w) => ({ wave: w.wave, lanes: w.lanes.map((l) => laneModel(l, taskById, cfg)) }));
}

// Walk the waves in time, the way a run behaves: a wave starts whenever the
// window is below the stop line; when usage reaches the line mid-wave the run
// pauses, waits for the reset, and the rest of the wave continues in the next
// window. A window also ends when `windowHours` have passed since it opened.
// `resetInMinutes` places the current window's reset (from a budget reading);
// without it the current window is assumed to have just opened.
// Linear within a wave: a wave's usage and time are spent at a constant rate.
export function simulate({ waves, pctPerUnit, minutesPerUnit, critical, windowHours, startPct = 0, maxParallel = Infinity, resetInMinutes }) {
  const windowMinutes = windowHours * 60;
  let clock = 0; // minutes since the start of the run
  let windowStart = resetInMinutes === undefined ? 0 : Math.min(0, resetInMinutes - windowMinutes);
  let used = startPct;
  let windows = 1;
  let waitMinutes = 0;
  let workMinutes = 0;
  const events = [];
  const trace = [{ t: 0, used, window: windows }];
  const point = () => trace.push({ t: clock, used, window: windows });

  const rollOver = () => {
    windowStart = clock;
    used = 0;
    windows += 1;
    point();
  };
  const waitForReset = () => {
    const resetAt = windowStart + windowMinutes;
    if (clock < resetAt) {
      waitMinutes += resetAt - clock;
      clock = resetAt;
      point();
    }
    rollOver();
  };

  for (const w of waves) {
    const laneUnits = w.lanes.map((l) => l.weight);
    const pct = laneUnits.reduce((a, u) => a + u * pctPerUnit, 0);
    const minutes = makespan(laneUnits, maxParallel) * minutesPerUnit;
    const firstWindow = windows;
    const startedAt = clock;
    let remainingPct = pct;
    let remainingMinutes = minutes;
    while (remainingPct > 1e-9) {
      if (clock - windowStart >= windowMinutes) rollOver();
      if (critical - used <= 1e-9) {
        waitForReset();
        continue;
      }
      let share = Math.min(1, (critical - used) / remainingPct);
      const timeLeft = windowStart + windowMinutes - clock;
      if (remainingMinutes * share > timeLeft) share = timeLeft / remainingMinutes;
      const dt = remainingMinutes * share;
      used += remainingPct * share;
      clock += dt;
      workMinutes += dt;
      remainingPct -= remainingPct * share;
      remainingMinutes -= dt;
      point();
    }
    events.push({ wave: w.wave, pct: Math.round(pct * 10) / 10, minutes: Math.round(minutes), window: windows, windows: [firstWindow, windows], start: Math.round(startedAt), end: Math.round(clock) });
  }
  return { windows, workMinutes: Math.round(workMinutes), waitMinutes: Math.round(waitMinutes), totalMinutes: Math.round(workMinutes + waitMinutes), events, trace };
}

export function forecast({ plan, lanes, routing, calibration, budget }) {
  const cfg = routing.forecast;
  const taskById = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
  const { counts, expectedFixRounds, escalations } = roleCounts(lanes, taskById, cfg);
  const weights = laneWeights(lanes, taskById, cfg);
  const all = weights.flatMap((w) => w.lanes);
  const baseUnits = all.reduce((a, l) => a + l.base, 0);
  const totalUnits = all.reduce((a, l) => a + l.weight, 0);
  // fix rounds are independent Bernoullis per lane: U = r·Σ W_l(1 + κ·B_l), so SD[U] = r·κ·√(Σ W_l² p_l(1−p_l))
  const kappa = cfg.fixRoundCost ?? 0.35;
  const spreadUnits = kappa * Math.sqrt(all.reduce((a, l) => a + l.base ** 2 * l.p * (1 - l.p), 0));
  const summary = summarize(calibration ?? { samples: [] });
  const calibratedUsage = summary.pctPerUnit !== undefined;
  const calibratedTime = summary.minutesPerUnit !== undefined;
  const pctPerUnit = summary.pctPerUnit ?? cfg.defaults.pctPerUnit;
  const minutesPerUnit = summary.minutesPerUnit ?? cfg.defaults.minutesPerUnit;
  const critical = routing.budget.fiveHour.critical;
  const startPct = budget?.fiveHour?.percentUsed ?? 0;
  const resetsAt = Date.parse(budget?.fiveHour?.resetsAt ?? '');
  const resetInMinutes = Number.isFinite(resetsAt) ? Math.max(0, (resetsAt - Date.now()) / 60_000) : undefined;
  const sim = simulate({
    waves: weights,
    pctPerUnit,
    minutesPerUnit,
    critical,
    windowHours: cfg.windowHours,
    startPct,
    maxParallel: routing.lanes.maxParallelLanes,
    resetInMinutes,
  });
  const round1 = (x) => Math.round(x * 10) / 10;
  const totalPct = round1(totalUnits * pctPerUnit);
  const pctSd = round1(spreadUnits * pctPerUnit);
  const pctRange = summary.pctRange?.map((r) => round1(totalUnits * r));
  const weeklyPct = summary.pct7dPerUnit === undefined ? undefined : round1(totalUnits * summary.pct7dPerUnit);
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
    units: round1(totalUnits),
    baseUnits: round1(baseUnits),
    calibrated: calibratedUsage && calibratedTime,
    calibratedUsage,
    calibratedTime,
    calibration: summary,
    rates: { pctPerUnit, minutesPerUnit },
    usage: { totalPct, pctSd, pctRange, startPct, critical, windows: sim.windows, weeklyPct, weeklyLeft, fitsWeekly: weeklyLeft === undefined || weeklyPct === undefined ? undefined : weeklyPct <= weeklyLeft },
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
  const placeholder = 'PLACEHOLDER rate, not your data: run a plan, then `relay calibrate`';
  const usageTag = f.calibratedUsage ? `calibrated from ${f.calibration.n5h} wave(s)` : placeholder;
  const spread = f.usage.pctRange ? `; calibrated range ${f.usage.pctRange[0]}–${f.usage.pctRange[1]}%` : '';
  const fixUnits = Math.round((f.units - f.baseUnits) * 10) / 10;
  out.push(`usage        ~${f.usage.totalPct}% of a 5h window ± ${f.usage.pctSd}% from fix rounds${spread} — ${f.baseUnits} units of work + ${fixUnits} expected in fix rounds, at ${f.rates.pctPerUnit.toFixed(2)}% per unit — ${usageTag}; the final review is extra`);
  const start = f.usage.startPct ? `, starting from ${f.usage.startPct}% used` : '';
  const simTag = f.calibrated ? '' : ' — from placeholder rates';
  out.push(`windows      ~${f.usage.windows} five-hour window(s) at the ${f.usage.critical}% stop line${start}${simTag}`);
  if (f.usage.weeklyPct === undefined) {
    out.push('weekly       unknown until calibrated (the weekly window is a different unit from the 5h one)');
  } else if (f.usage.weeklyLeft === undefined) {
    out.push(`weekly       needs ~${f.usage.weeklyPct}% of the weekly limit (no current reading to compare with)`);
  } else {
    out.push(`weekly       needs ~${f.usage.weeklyPct}% of the weekly limit; ${f.usage.weeklyLeft}% left before its stop line` + (f.usage.fitsWeekly ? '' : ' — DOES NOT FIT: split the plan or offload reviews to Codex'));
  }
  out.push(`time         ~${hhmm(f.time.workMinutes)} of work` + (f.time.waitMinutes ? ` + ~${hhmm(f.time.waitMinutes)} waiting for resets = ~${hhmm(f.time.totalMinutes)}` : '') + simTag);
  for (const e of f.perWave) out.push(`  wave ${e.wave}: ~${e.pct}% · ~${hhmm(e.minutes)} · ` + (e.windows[0] === e.windows[1] ? `window ${e.window}` : `windows ${e.windows[0]}–${e.windows[1]} (pauses at the stop line, resumes after the reset)`));
  return out.join('\n');
}
