// Forecast a plan run on the Codex harness: credits, usage of every window the account has,
// windows crossed, hours, and the two levers the harness adds (speed tier, reset credits).
//
// Model (see docs/whitepaper): task t weighs w_t = T(tier) R(risk) work units; on tier τ a
// unit costs c_τ credits and m_τ minutes (priors, then calibrated); lane l needs a fix round
// with probability p_l that re-works κ of the lane; expected lane credits C̃_l = C_l (1 + κ p_l).
// Window j holds Q_j credits, so the plan uses U_j = Σ C̃_l / Q_j of it; the walk in
// lib/walk.mjs turns that into windows crossed and waits.

import { TIERS } from './harness.mjs';
import { speedup, tierProfile, windowCapacity } from './pricing.mjs';
import { makespan, simulate } from './walk.mjs';
import { windowsForPlan } from './harness.mjs';
import { minutesToReset } from './windows.mjs';
import { stopLinesFor } from './budget.mjs';

export function taskUnits(task, cfg) {
  const tier = cfg.tierWeight[task.tier] ?? cfg.tierWeight.mid;
  const risk = cfg.riskFactor[task.risk] ?? 1;
  return tier * risk;
}

// One lane in the model: credits and minutes of its work, its fix-round probability, and the
// expected values with the fix round. `profiles` maps tier → tierProfile (model, speed, rates).
export function laneModel(lane, taskById, cfg, profiles, laneOverrides = {}) {
  const tasks = lane.tasks.map((id) => taskById[id]);
  let credits = 0;
  let minutes = 0;
  let units = 0;
  const byTier = Object.fromEntries(TIERS.map((t) => [t, { units: 0, credits: 0 }]));
  for (const t of tasks) {
    const tier = TIERS.includes(t.tier) ? t.tier : 'mid';
    const prof = laneOverrides[tier] ?? profiles[tier];
    const u = taskUnits(t, cfg);
    units += u;
    credits += u * prof.creditsPerUnit;
    minutes += u * prof.minutesPerUnit;
    byTier[tier].units += u;
    byTier[tier].credits += u * prof.creditsPerUnit;
  }
  const p = Math.max(...tasks.map((t) => cfg.fixRoundProbability[t.risk] ?? 0.5));
  const kappa = cfg.fixRoundCost ?? 0.35;
  return {
    id: lane.id,
    units,
    credits,
    minutes,
    p,
    byTier,
    expectedCredits: credits * (1 + kappa * p),
    expectedMinutes: minutes * (1 + kappa * p),
  };
}

export function laneModels(lanes, taskById, cfg, profiles) {
  return lanes.waves.map((w) => ({ wave: w.wave, lanes: w.lanes.map((l) => laneModel(l, taskById, cfg, profiles)) }));
}

export function roleCounts(lanes, taskById, cfg) {
  const counts = { conductor: 1, architect: 1 };
  const add = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  let expectedFixRounds = 0;
  for (const w of lanes.waves) {
    for (const lane of w.lanes) {
      for (const seg of lane.segments ?? [{ role: 'implementer' }]) add(seg.role);
      add('reviewer');
      const tasks = lane.tasks.map((id) => taskById[id]);
      if (tasks.some((t) => t.risk !== 'low' && t.tests > 0)) add('test-author');
      expectedFixRounds += Math.max(...tasks.map((t) => cfg.fixRoundProbability[t.risk] ?? 0.5));
    }
  }
  return { counts, expectedFixRounds };
}

// The windows the walk runs: the plan's windows, with the reading's values where the reading
// has them. A window the reading omits (a sparse update, a partial reading) keeps its place at 0%
// and is flagged `fromReading: false`; a window the reading has but the plan table does not is added.
function windowsFromSnapshot(snapshot, harness, routing, calibration, now) {
  const planType = snapshot?.planType ?? calibration?.planType;
  const defaults = windowsForPlan(harness, planType);
  const byId = new Map(defaults.map((w) => [w.id, { ...w, usedPercent: 0, fromReading: false }]));
  for (const w of snapshot?.windows ?? []) {
    const base = byId.get(w.id) ?? {};
    byId.set(w.id, { ...base, ...w, windowMinutes: w.windowMinutes ?? base.windowMinutes ?? 300, usedPercent: w.usedPercent ?? 0, fromReading: true });
  }
  return [...byId.values()].map((w) => {
    const cap = windowCapacity(routing, harness, w.id, planType, calibration);
    const lines = stopLinesFor(w, routing);
    return {
      id: w.id,
      capacityCredits: cap.credits,
      calibrated: cap.calibrated,
      windowMinutes: w.windowMinutes,
      usedPercent: w.usedPercent,
      fromReading: w.fromReading,
      resetInMinutes: minutesToReset(w, now),
      stopLine: lines.critical,
      tightLine: lines.tight,
    };
  });
}

// The fast-lane lever, per wave: speed up the lane that sets the wave's makespan.
function fastLaneAdvice(wave, models, harness, routing, cfg, taskById, profiles, calibration, maxParallel) {
  const base = makespan(models.map((l) => l.expectedMinutes), maxParallel);
  const heaviest = models.reduce((a, b) => (b.expectedMinutes > a.expectedMinutes ? b : a), models[0]);
  const lane = wave.lanes.find((l) => l.id === heaviest.id);
  const fastProfiles = Object.fromEntries(TIERS.map((t) => [t, tierProfile(routing, harness, t, { speed: 'fast' }, calibration)]));
  const fast = laneModel(lane, taskById, cfg, profiles, fastProfiles);
  const others = models.filter((l) => l.id !== heaviest.id).map((l) => l.expectedMinutes);
  const withFast = makespan([...others, fast.expectedMinutes], maxParallel);
  const minutesSaved = Math.max(0, base - withFast);
  const extraCredits = Math.max(0, fast.expectedCredits - heaviest.expectedCredits);
  return { wave: wave.wave, lane: heaviest.id, minutesSaved: Math.round(minutesSaved), extraCredits: Math.round(extraCredits * 100) / 100, minutesPerCredit: extraCredits > 0 ? Math.round((minutesSaved / extraCredits) * 10) / 10 : undefined };
}

export function forecast({ plan, lanes, routing, harness, calibration = {}, snapshot, now = Date.now() }) {
  const cfg = routing.forecast;
  const taskById = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
  const profiles = Object.fromEntries(TIERS.map((t) => [t, tierProfile(routing, harness, t, {}, calibration)]));
  const waves = laneModels(lanes, taskById, cfg, profiles);
  const all = waves.flatMap((w) => w.lanes);
  const kappa = cfg.fixRoundCost ?? 0.35;
  const baseCredits = all.reduce((a, l) => a + l.credits, 0);
  const credits = all.reduce((a, l) => a + l.expectedCredits, 0);
  const creditsSd = kappa * Math.sqrt(all.reduce((a, l) => a + l.credits ** 2 * l.p * (1 - l.p), 0));
  const units = all.reduce((a, l) => a + l.units, 0);
  const byTier = Object.fromEntries(TIERS.map((t) => [t, { units: 0, credits: 0 }]));
  for (const l of all) for (const t of TIERS) {
    byTier[t].units += l.byTier[t].units;
    byTier[t].credits += l.byTier[t].credits * (1 + kappa * l.p);
  }
  const windows = windowsFromSnapshot(snapshot, harness, routing, calibration, now);
  const maxParallel = routing.lanes.maxParallelLanes;
  const resetPolicy = routing.budget.resetCredit ?? {};
  const sim = simulate({
    waves: waves.map((w) => ({ wave: w.wave, lanes: w.lanes.map((l) => ({ id: l.id, credits: l.expectedCredits, minutes: l.expectedMinutes })) })),
    windows,
    maxParallel,
    resetCredits: { available: Math.max(0, (snapshot?.resetCredits?.availableCount ?? 0) - (resetPolicy.keepAtLeast ?? 0)), minWaitMinutes: resetPolicy.consumeWhenWaitMinutesAtLeast ?? Infinity },
  });
  const noResets = snapshot?.resetCredits?.availableCount
    ? simulate({ waves: waves.map((w) => ({ wave: w.wave, lanes: w.lanes.map((l) => ({ id: l.id, credits: l.expectedCredits, minutes: l.expectedMinutes })) })), windows, maxParallel })
    : sim;
  const round1 = (x) => Math.round(x * 10) / 10;
  const round2 = (x) => Math.round(x * 100) / 100;
  const usage = windows.map((w) => ({
    id: w.id,
    windowMinutes: w.windowMinutes,
    capacityCredits: w.capacityCredits,
    calibrated: w.calibrated,
    fromReading: w.fromReading,
    startPct: round1(w.usedPercent),
    pct: round1((credits / w.capacityCredits) * 100),
    pctSd: round1((creditsSd / w.capacityCredits) * 100),
    stopLine: w.stopLine,
    left: round1(Math.max(0, w.stopLine - w.usedPercent)),
    fits: (credits / w.capacityCredits) * 100 <= Math.max(0, w.stopLine - w.usedPercent),
    windowsUsed: sim.windows[w.id].windowsUsed,
  }));
  const fast = waves.map((w, i) => fastLaneAdvice(lanes.waves[i], w.lanes, harness, routing, cfg, taskById, profiles, calibration, maxParallel));
  // what the plan would cost if its mid tasks ran on the cheap tier, and its strong tasks on mid
  const downshift = (from, to) => all.reduce((a, l) => a + l.byTier[from].credits * (1 + kappa * l.p) * (profiles[to].creditsPerUnit / profiles[from].creditsPerUnit), 0);
  const tierSensitivity = {
    midOnCheap: round2(credits - byTier.mid.credits + downshift('mid', 'cheap')),
    strongOnMid: round2(credits - byTier.strong.credits + downshift('strong', 'mid')),
  };
  const widest = Math.max(...lanes.waves.map((w) => w.lanes.length));
  const { counts, expectedFixRounds } = roleCounts(lanes, taskById, cfg);
  return {
    slug: plan.slug,
    harness: 'codex',
    planType: snapshot?.planType ?? calibration?.planType ?? 'unknown',
    tasks: plan.tasks.length,
    lanes: all.length,
    waves: lanes.waves.length,
    agents: { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), expectedFixRounds: round1(expectedFixRounds) },
    parallel: { widest, cap: maxParallel },
    worktrees: Math.min(widest, maxParallel) + 1,
    units: round1(units),
    credits: { base: round2(baseCredits), expected: round2(credits), sd: round2(creditsSd), byTier: Object.fromEntries(TIERS.map((t) => [t, { units: round1(byTier[t].units), credits: round2(byTier[t].credits) }])) },
    profiles,
    calibrated: { credits: TIERS.every((t) => profiles[t].calibratedCredits), time: profiles.mid.calibratedTime, capacity: windows.every((w) => w.calibrated) },
    usage,
    time: { workMinutes: sim.workMinutes, waitMinutes: sim.waitMinutes, totalMinutes: sim.totalMinutes, longestWaitMinutes: sim.longestWaitMinutes, waitMinutesWithoutResets: noResets.waitMinutes },
    resets: { available: snapshot?.resetCredits?.availableCount ?? 0, consumed: sim.resetsConsumed, minutesSaved: Math.max(0, noResets.waitMinutes - sim.waitMinutes) },
    perWave: sim.events,
    fastLane: fast,
    tierSensitivity,
    walk: sim,
  };
}

function hhmm(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

function windowName(w) {
  return w.windowMinutes % 1440 === 0 ? `${w.windowMinutes / 1440}-day` : w.windowMinutes % 60 === 0 ? `${w.windowMinutes / 60}-hour` : `${w.windowMinutes}-minute`;
}

export function formatForecast(f) {
  const out = [];
  out.push(`forecast for ${f.slug} on Codex (${f.planType} plan): ${f.tasks} tasks · ${f.lanes} lanes · ${f.waves} wave(s)`);
  const roles = Object.entries(f.agents.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  out.push(`agents       ~${f.agents.total} starts (${roles}), plus ~${f.agents.expectedFixRounds} fix round(s)`);
  out.push(`parallel     up to ${Math.min(f.parallel.widest, f.parallel.cap)} lane(s) at once (plan allows ${f.parallel.widest}, cap ${f.parallel.cap}); worktrees ${f.worktrees}`);
  const tiers = Object.entries(f.credits.byTier)
    .map(([t, v]) => `${t} ${v.units}u → ${v.credits}cr on ${f.profiles[t].model}/${f.profiles[t].effort}/${f.profiles[t].speed}`)
    .join(' · ');
  const tag = f.calibrated.credits ? 'calibrated credits per unit' : 'PRIOR credits per unit, not your data: run a plan, then calibrate';
  out.push(`credits      ~${f.credits.expected} ± ${f.credits.sd} (${f.credits.base} of work + fix rounds) — ${tiers} — ${tag}`);
  for (const u of f.usage) {
    const ctag = u.calibrated ? 'calibrated capacity' : `PLACEHOLDER capacity ${u.capacityCredits}cr`;
    const start = u.startPct ? `, starting from ${u.startPct}% used` : '';
    out.push(`${u.id.padEnd(12)} ~${u.pct}% ± ${u.pctSd}% of the ${windowName(u)} window${start}; ${u.left}% left before the ${u.stopLine}% stop line — ${u.fits ? 'fits' : 'DOES NOT FIT in the current window'}; ~${u.windowsUsed} window(s) — ${ctag}`);
  }
  const timeTag = f.calibrated.time ? '' : ' — from placeholder rates';
  const waits = f.time.waitMinutes ? ` + ~${hhmm(f.time.waitMinutes)} waiting for resets = ~${hhmm(f.time.totalMinutes)}` : '';
  out.push(`time         ~${hhmm(f.time.workMinutes)} of work${waits}${timeTag}`);
  if (f.resets.available) out.push(`resets       ${f.resets.available} reset credit(s) available; the walk consumes ${f.resets.consumed}, saving ~${hhmm(f.resets.minutesSaved)} of waiting`);
  for (const e of f.perWave) {
    const u = Object.entries(e.usagePct)
      .map(([k, v]) => `${k} ${v}%`)
      .join(', ');
    const crossed = Object.entries(e.crossed).filter(([, n]) => n > 0).map(([k, n]) => `${k} resets ×${n}`);
    out.push(`  wave ${e.wave}: ~${e.credits}cr (${u}) · ~${hhmm(e.minutes)}` + (crossed.length ? ` · ${crossed.join(', ')} (pauses at the stop line, resumes after the reset)` : ''));
  }
  const fast = f.fastLane.filter((x) => x.minutesSaved > 0);
  if (fast.length) out.push(`fast lane    ` + fast.map((x) => `wave ${x.wave}: lane ${x.lane} on Fast saves ~${hhmm(x.minutesSaved)} for +${x.extraCredits}cr (${x.minutesPerCredit} min/cr)`).join('; '));
  out.push(`tiers        every mid task on cheap would cost ~${f.tierSensitivity.midOnCheap}cr; every strong task on mid ~${f.tierSensitivity.strongOnMid}cr (vs ${f.credits.expected}cr as planned)`);
  return out.join('\n');
}
