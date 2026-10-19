// Numbers behind the whitepaper, computed with relay's model code (lib/forecast.mjs,
// lib/calibration.mjs) on example-plan.md at the placeholder rates.
// node docs/whitepaper/data.mjs > docs/whitepaper/data.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { forecast, laneWeights, simulate } from '../../lib/forecast.mjs';
import { computeLanes } from '../../lib/lanes.mjs';
import { parsePlan } from '../../lib/plan.mjs';
import { loadRouting } from '../../lib/routing.mjs';

const routing = loadRouting();
const cfg = routing.forecast;
const kappa = cfg.fixRoundCost;
const plan = parsePlan(readFileSync(fileURLToPath(new URL('./example-plan.md', import.meta.url)), 'utf8'));
const lanes = computeLanes(plan);
const taskById = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
const waves = laneWeights(lanes, taskById, cfg); // per lane: base W, p, expected weight W(1+κp)
const all = waves.flatMap((w) => w.lanes);
const L = all.length;
const r = cfg.defaults.pctPerUnit;
const m = cfg.defaults.minutesPerUnit;
const base = { critical: routing.budget.fiveHour.critical, windowHours: cfg.windowHours, maxParallel: routing.lanes.maxParallelLanes };

// every fix-round outcome B ∈ {0,1}^L, exactly: its probability, usage and run
const outcomes = [];
for (let mask = 0; mask < 1 << L; mask++) {
  let prob = 1;
  let i = 0;
  const realized = waves.map((w) => ({
    wave: w.wave,
    lanes: w.lanes.map((l) => {
      const b = (mask >> i++) & 1;
      prob *= b ? l.p : 1 - l.p;
      return { id: l.id, weight: l.base * (1 + kappa * b) };
    }),
  }));
  const usage = r * realized.flatMap((w) => w.lanes).reduce((a, l) => a + l.weight, 0);
  const sim = simulate({ ...base, waves: realized, pctPerUnit: r, minutesPerUnit: m });
  outcomes.push({ F: popcount(mask), prob, usage, windows: sim.windows, totalMinutes: sim.totalMinutes });
}
function popcount(x) {
  let n = 0;
  for (; x; x >>= 1) n += x & 1;
  return n;
}
const E = (f) => outcomes.reduce((a, o) => a + o.prob * f(o), 0);
const meanU = E((o) => o.usage);
const sdU = Math.sqrt(E((o) => (o.usage - meanU) ** 2));
const quantile = (q) => {
  const sorted = [...outcomes].sort((a, b) => a.usage - b.usage);
  let c = 0;
  for (const o of sorted) if ((c += o.prob) >= q) return o.usage;
  return sorted.at(-1).usage;
};
const pmfF = Array.from({ length: L + 1 }, (_, k) => outcomes.filter((o) => o.F === k).reduce((a, o) => a + o.prob, 0));
const windowsDist = {};
for (const o of outcomes) windowsDist[o.windows] = (windowsDist[o.windows] ?? 0) + o.prob;

const f = forecast({ plan, lanes, routing, calibration: { samples: [] } });
const expected = simulate({ ...base, waves, pctPerUnit: r, minutesPerUnit: m });
const sensitivity = [];
for (let x = 0.4; x <= 2.0001; x += 0.025) {
  const sim = simulate({ ...base, waves, pctPerUnit: x, minutesPerUnit: m });
  sensitivity.push({ r: Math.round(x * 1000) / 1000, windows: sim.windows, workMinutes: sim.workMinutes, waitMinutes: sim.waitMinutes, totalMinutes: sim.totalMinutes });
}

let firstWait;
for (let x = 0.4; x <= 2.0001 && firstWait === undefined; x += 0.001) {
  if (simulate({ ...base, waves, pctPerUnit: x, minutesPerUnit: m }).waitMinutes > 0) firstWait = Math.round(x * 1000) / 1000;
}

const out = {
  plan: { slug: plan.slug, tasks: plan.tasks.length, lanes: L, waves: lanes.waves.length, baseUnits: all.reduce((a, l) => a + l.base, 0), expectedUnits: all.reduce((a, l) => a + l.weight, 0) },
  lanes: waves.map((w) => ({ wave: w.wave, lanes: w.lanes })),
  usage: {
    mean: meanU,
    sd: sdU,
    sdFormula: r * kappa * Math.sqrt(all.reduce((a, l) => a + l.base ** 2 * l.p * (1 - l.p), 0)),
    min: Math.min(...outcomes.map((o) => o.usage)),
    max: Math.max(...outcomes.map((o) => o.usage)),
    q05: quantile(0.05),
    q95: quantile(0.95),
    forecast: f.usage.totalPct,
    forecastSd: f.usage.pctSd,
  },
  fixRounds: { mean: E((o) => o.F), variance: E((o) => (o.F - E((q) => q.F)) ** 2), pmf: pmfF },
  outcomes: outcomes.map((o) => ({ prob: o.prob, usage: o.usage, F: o.F, windows: o.windows, totalMinutes: o.totalMinutes })),
  runOverOutcomes: { meanTotalMinutes: E((o) => o.totalMinutes), windows: windowsDist },
  expected: { windows: expected.windows, workMinutes: expected.workMinutes, waitMinutes: expected.waitMinutes, totalMinutes: expected.totalMinutes, events: expected.events, trace: expected.trace },
  sensitivity,
  firstWait,
  priors: { tierWeight: cfg.tierWeight, riskFactor: cfg.riskFactor, fixRoundProbability: cfg.fixRoundProbability, fixRoundCost: kappa, pctPerUnit: r, minutesPerUnit: m, stopLine: routing.budget.fiveHour.critical },
};
console.log(JSON.stringify(out, null, 1));
