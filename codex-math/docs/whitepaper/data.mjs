// Numbers behind the Codex whitepaper, computed with the codex-math model code on relay's
// 30-task example plan (example-plan.md, the same plan as the relay whitepaper) at the priors.
// node codex-math/docs/whitepaper/data.mjs > codex-math/docs/whitepaper/data.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePlan } from '../../../lib/plan.mjs';
import { computeLanes } from '../../../lib/lanes.mjs';
import { loadCodexRouting, loadHarness, TIERS } from '../../lib/harness.mjs';
import { tierProfile, tierCreditRatios, creditRates, windowCapacity } from '../../lib/pricing.mjs';
import { forecast, laneModels } from '../../lib/forecast.mjs';
import { simulate } from '../../lib/walk.mjs';

const harness = loadHarness();
const routing = loadCodexRouting();
const cfg = routing.forecast;
const kappa = cfg.fixRoundCost;
const plan = parsePlan(readFileSync(fileURLToPath(new URL('./example-plan.md', import.meta.url)), 'utf8'));
const lanes = computeLanes(plan);
const taskById = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
const profiles = Object.fromEntries(TIERS.map((t) => [t, tierProfile(routing, harness, t)]));
const waves = laneModels(lanes, taskById, cfg, profiles);
const all = waves.flatMap((w) => w.lanes);
const L = all.length;
const planType = 'plus';
const windows = ['primary', 'secondary'].map((id) => ({
  id,
  capacityCredits: windowCapacity(routing, harness, id, planType).credits,
  windowMinutes: id === 'primary' ? 300 : 10080,
  usedPercent: 0,
  stopLine: routing.budget.windows[id].critical,
}));
const maxParallel = routing.lanes.maxParallelLanes;
const run = (realized, extra = {}) => simulate({ waves: realized, windows: windows.map((w) => ({ ...w, ...(extra.windows?.[w.id] ?? {}) })), maxParallel, ...extra });

// every fix-round outcome B ∈ {0,1}^L exactly: probability, credits, usage, run
const outcomes = [];
for (let mask = 0; mask < 1 << L; mask++) {
  let prob = 1;
  let i = 0;
  const realized = waves.map((w) => ({
    wave: w.wave,
    lanes: w.lanes.map((l) => {
      const b = (mask >> i++) & 1;
      prob *= b ? l.p : 1 - l.p;
      return { id: l.id, credits: l.credits * (1 + kappa * b), minutes: l.minutes * (1 + kappa * b) };
    }),
  }));
  const credits = realized.flatMap((w) => w.lanes).reduce((a, l) => a + l.credits, 0);
  const sim = run(realized);
  outcomes.push({ F: popcount(mask), prob, credits, windows: sim.windows.primary.windowsUsed, totalMinutes: sim.totalMinutes, waitMinutes: sim.waitMinutes });
}
function popcount(x) {
  let n = 0;
  for (; x; x >>= 1) n += x & 1;
  return n;
}
const E = (f) => outcomes.reduce((a, o) => a + o.prob * f(o), 0);
const meanC = E((o) => o.credits);
const sdC = Math.sqrt(E((o) => (o.credits - meanC) ** 2));
const quantile = (q) => {
  const sorted = [...outcomes].sort((a, b) => a.credits - b.credits);
  let c = 0;
  for (const o of sorted) if ((c += o.prob) >= q) return o.credits;
  return sorted.at(-1).credits;
};

const f = forecast({ plan, lanes, routing, harness, snapshot: { planType, updatedAt: new Date().toISOString(), windows: windows.map((w) => ({ id: w.id, usedPercent: 0, windowMinutes: w.windowMinutes })) } });
const expected = run(waves.map((w) => ({ wave: w.wave, lanes: w.lanes.map((l) => ({ id: l.id, credits: l.expectedCredits, minutes: l.expectedMinutes })) })));

// sensitivity to the one number calibration must supply first: the primary window's capacity
const sensitivity = [];
for (let q = 60; q <= 1500.001; q += 10) {
  const sim = simulate({
    waves: waves.map((w) => ({ wave: w.wave, lanes: w.lanes.map((l) => ({ id: l.id, credits: l.expectedCredits, minutes: l.expectedMinutes })) })),
    windows: windows.map((w) => (w.id === 'primary' ? { ...w, capacityCredits: q } : { ...w, capacityCredits: q * 6 })),
    maxParallel,
  });
  sensitivity.push({ q, windows: sim.windows.primary.windowsUsed, workMinutes: sim.workMinutes, waitMinutes: sim.waitMinutes, totalMinutes: sim.totalMinutes });
}
let lastWait;
for (let q = 60; q <= 5000 && lastWait === undefined; q += 1) {
  const sim = simulate({
    waves: waves.map((w) => ({ wave: w.wave, lanes: w.lanes.map((l) => ({ id: l.id, credits: l.expectedCredits, minutes: l.expectedMinutes })) })),
    windows: windows.map((w) => (w.id === 'primary' ? { ...w, capacityCredits: q } : { ...w, capacityCredits: q * 6 })),
    maxParallel,
  });
  if (sim.waitMinutes === 0) lastWait = q;
}

// the same plan with the strong tier on gpt-6.1-sol/xhigh instead of gpt-6-astra/high
const solRouting = structuredClone(routing);
solRouting.tiers.strong = { model: 'gpt-6.1-sol', effort: 'xhigh', speed: 'standard' };
const fSol = forecast({ plan, lanes, routing: solRouting, harness, snapshot: { planType, updatedAt: new Date().toISOString(), windows: windows.map((w) => ({ id: w.id, usedPercent: 0, windowMinutes: w.windowMinutes })) } });

// the same sensitivity with the strong tier on gpt-6.1-sol/xhigh
const solProfiles = Object.fromEntries(TIERS.map((t) => [t, tierProfile(solRouting, harness, t)]));
const solWaves = laneModels(lanes, taskById, cfg, solProfiles);
const sensitivitySol = [];
for (let q = 60; q <= 1500.001; q += 10) {
  const sim = simulate({
    waves: solWaves.map((w) => ({ wave: w.wave, lanes: w.lanes.map((l) => ({ id: l.id, credits: l.expectedCredits, minutes: l.expectedMinutes })) })),
    windows: windows.map((w) => (w.id === 'primary' ? { ...w, capacityCredits: q } : { ...w, capacityCredits: q * 6 })),
    maxParallel,
  });
  sensitivitySol.push({ q, windows: sim.windows.primary.windowsUsed, workMinutes: sim.workMinutes, waitMinutes: sim.waitMinutes, totalMinutes: sim.totalMinutes });
}

// credits per unit on every model relay could route a tier to, at the tier's effort
const ladder = {};
for (const model of Object.keys(harness.pricing.creditsPerMillionTokens)) {
  ladder[model] = {};
  for (const effort of ['low', 'medium', 'high', 'xhigh']) {
    for (const speed of ['standard', 'fast']) {
      ladder[model][`${effort}/${speed}`] = tierProfile(routing, harness, 'mid', { model, effort, speed }).creditsPerUnit;
    }
  }
}

const out = {
  harness: { version: harness.target.version, sha256: harness.target.sha256 },
  plan: { slug: plan.slug, tasks: plan.tasks.length, lanes: L, waves: lanes.waves.length, units: all.reduce((a, l) => a + l.units, 0), baseCredits: all.reduce((a, l) => a + l.credits, 0), expectedCredits: all.reduce((a, l) => a + l.expectedCredits, 0) },
  profiles,
  ratios: tierCreditRatios(routing, harness),
  claudeRatios: { cheap: 1, mid: 3, strong: 7 },
  rates: harness.pricing.creditsPerMillionTokens,
  ladder,
  lanes: waves.map((w) => ({ wave: w.wave, lanes: w.lanes.map((l) => ({ id: l.id, units: l.units, credits: l.credits, p: l.p, expectedCredits: l.expectedCredits, expectedMinutes: l.expectedMinutes, byTier: l.byTier })) })),
  credits: { mean: meanC, sd: sdC, sdFormula: kappa * Math.sqrt(all.reduce((a, l) => a + l.credits ** 2 * l.p * (1 - l.p), 0)), min: Math.min(...outcomes.map((o) => o.credits)), max: Math.max(...outcomes.map((o) => o.credits)), q05: quantile(0.05), q95: quantile(0.95), forecast: f.credits.expected, forecastSd: f.credits.sd, byTier: f.credits.byTier },
  fixRounds: { mean: E((o) => o.F) },
  outcomes: outcomes.map((o) => ({ prob: o.prob, credits: o.credits, F: o.F, windows: o.windows, totalMinutes: o.totalMinutes })),
  runOverOutcomes: { meanTotalMinutes: E((o) => o.totalMinutes), meanWaitMinutes: E((o) => o.waitMinutes) },
  usage: f.usage,
  windows: windows.map((w) => ({ id: w.id, capacityCredits: w.capacityCredits, windowMinutes: w.windowMinutes, stopLine: w.stopLine })),
  expected: { windows: expected.windows, workMinutes: expected.workMinutes, waitMinutes: expected.waitMinutes, totalMinutes: expected.totalMinutes, events: expected.events, waits: expected.waits, trace: expected.trace },
  fastLane: f.fastLane,
  tierSensitivity: f.tierSensitivity,
  strongOnSol: { credits: fSol.credits, usage: fSol.usage, time: fSol.time, profile: fSol.profiles.strong },
  sensitivity,
  sensitivitySol,
  lastWaitCapacity: lastWait,
  priors: { tierWeight: cfg.tierWeight, riskFactor: cfg.riskFactor, fixRoundProbability: cfg.fixRoundProbability, fixRoundCost: kappa, ...cfg.prior, stopLines: routing.budget.windows, planType },
};
console.log(JSON.stringify(out, null, 1));
