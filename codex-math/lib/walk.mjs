// The window walk for an account with any number of usage windows: a wave starts whenever
// every window is below its stop line; credits and time are spent linearly within a wave;
// when a window reaches its stop line the run pauses until that window resets (or, when the
// rule allows, consumes a reset credit, which restores every window at once); a window also
// rolls over on its own schedule. Plus and Business accounts have a 300-minute primary and a
// 10080-minute secondary window; Pro accounts have the weekly window alone.
//
// Lanes carry expected `credits` and expected `minutes` (units × minutes per unit at the lane's
// speed tier); a wave's duration is the makespan of its lanes on `maxParallel` slots. A reading's
// reset time wins over the window's nominal length for the current window.

export function makespan(laneMinutes, parallel = Infinity) {
  if (!laneMinutes.length) return 0;
  const slots = new Array(Math.max(1, Math.min(parallel, laneMinutes.length))).fill(0);
  for (const w of [...laneMinutes].sort((a, b) => b - a)) {
    const i = slots.indexOf(Math.min(...slots));
    slots[i] += w;
  }
  return Math.max(...slots);
}

const EPS = 1e-9;

function checkWindow(w) {
  const num = (x) => typeof x === 'number' && Number.isFinite(x);
  if (!w || typeof w.id !== 'string') throw new Error('simulate: every window needs an id');
  if (!num(w.capacityCredits) || w.capacityCredits <= 0) throw new Error(`simulate: window ${w.id} needs capacityCredits > 0`);
  if (!num(w.windowMinutes) || w.windowMinutes <= 0) throw new Error(`simulate: window ${w.id} needs windowMinutes > 0`);
  if (w.usedPercent !== undefined && !num(w.usedPercent)) throw new Error(`simulate: window ${w.id} has a non-numeric usedPercent`);
  if (!num(w.stopLine) || w.stopLine <= 0) throw new Error(`simulate: window ${w.id} needs a stopLine > 0`);
  if (w.resetInMinutes !== undefined && !num(w.resetInMinutes)) throw new Error(`simulate: window ${w.id} has a non-numeric resetInMinutes`);
}

export function simulate({ waves, windows, maxParallel = Infinity, resetCredits = { available: 0, minWaitMinutes: Infinity } }) {
  for (const w of windows) checkWindow(w);
  for (const wave of waves) for (const l of wave.lanes) if (!(l.credits >= 0) || !(l.minutes >= 0)) throw new Error(`simulate: lane ${l.id} of wave ${wave.wave} needs credits >= 0 and minutes >= 0`);
  // window state: used (%), nextReset (clock minutes), crossings
  const ws = windows.map((w) => ({
    id: w.id,
    capacity: w.capacityCredits,
    minutes: w.windowMinutes,
    stopLine: w.stopLine,
    used: Math.max(0, w.usedPercent ?? 0),
    nextReset: w.resetInMinutes === undefined ? w.windowMinutes : Math.max(0, w.resetInMinutes),
    crossings: 0,
  }));
  let clock = 0;
  let workMinutes = 0;
  let waitMinutes = 0;
  let resetsConsumed = 0;
  let creditsLeft = resetCredits.available ?? 0;
  const events = [];
  const waits = [];
  const trace = [{ t: 0, used: Object.fromEntries(ws.map((w) => [w.id, w.used])) }];
  const point = () => trace.push({ t: clock, used: Object.fromEntries(ws.map((w) => [w.id, w.used])) });

  const rollOverDue = () => {
    for (const w of ws) {
      while (clock >= w.nextReset - EPS) {
        w.nextReset += w.minutes;
        w.used = 0;
        w.crossings += 1;
      }
    }
  };
  const resetAll = () => {
    for (const w of ws) {
      w.used = 0;
      w.nextReset = clock + w.minutes;
      w.crossings += 1;
    }
  };

  for (const wave of waves) {
    const credits = wave.lanes.reduce((a, l) => a + l.credits, 0);
    const minutes = makespan(wave.lanes.map((l) => l.minutes), maxParallel);
    const startedAt = clock;
    const crossingsBefore = ws.map((w) => w.crossings);
    let remC = credits;
    let remT = minutes;
    let guard = 0;
    while ((remC > EPS || remT > EPS) && guard++ < 100_000) {
      rollOverDue();
      const binding = remC > EPS ? ws.find((w) => w.stopLine - w.used <= EPS) : undefined;
      if (binding) {
        const wait = Math.max(0, binding.nextReset - clock);
        if (creditsLeft > 0 && wait >= (resetCredits.minWaitMinutes ?? Infinity)) {
          creditsLeft -= 1;
          resetsConsumed += 1;
          waits.push({ wave: wave.wave, window: binding.id, at: clock, minutes: 0, resetCredit: true });
          resetAll();
          point();
          continue;
        }
        waits.push({ wave: wave.wave, window: binding.id, at: clock, minutes: wait, resetCredit: false });
        waitMinutes += wait;
        clock = binding.nextReset;
        point();
        rollOverDue();
        continue;
      }
      // the largest share of the remaining wave that fits every stop line and every window edge
      let share = 1;
      for (const w of ws) {
        if (remC > EPS) {
          const pctOfRemaining = (remC / w.capacity) * 100;
          share = Math.min(share, (w.stopLine - w.used) / pctOfRemaining);
        }
        if (remT > EPS) share = Math.min(share, (w.nextReset - clock) / remT);
      }
      share = Math.max(0, Math.min(1, share));
      if (share <= EPS) {
        // numerical corner: sit exactly on a line or an edge; let the next pass roll over or wait
        const atLine = ws.find((x) => x.stopLine - x.used <= 1e-6);
        if (atLine && remC > EPS) atLine.used = atLine.stopLine;
        else clock += 1e-6;
        continue;
      }
      const dC = remC * share;
      const dT = remT * share;
      for (const w of ws) w.used += (dC / w.capacity) * 100;
      clock += dT;
      workMinutes += dT;
      remC -= dC;
      remT -= dT;
      if (remC < EPS) remC = 0;
      if (remT < EPS) remT = 0;
      point();
    }
    events.push({
      wave: wave.wave,
      credits: Math.round(credits * 100) / 100,
      minutes: Math.round(minutes),
      usagePct: Object.fromEntries(ws.map((w) => [w.id, Math.round((credits / w.capacity) * 1000) / 10])),
      start: Math.round(startedAt),
      end: Math.round(clock),
      crossed: Object.fromEntries(ws.map((w, i) => [w.id, w.crossings - crossingsBefore[i]])),
    });
  }
  const longestWait = waits.reduce((m, w) => Math.max(m, w.minutes), 0);
  return {
    windows: Object.fromEntries(ws.map((w) => [w.id, { crossings: w.crossings, windowsUsed: w.crossings + 1, finalUsedPct: Math.round(w.used * 10) / 10 }])),
    workMinutes: Math.round(workMinutes),
    waitMinutes: Math.round(waitMinutes),
    totalMinutes: Math.round(workMinutes + waitMinutes),
    longestWaitMinutes: Math.round(longestWait),
    resetsConsumed,
    waits,
    events,
    trace,
  };
}
