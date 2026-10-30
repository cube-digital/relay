// Bridges shared Relay workflows to the tested Codex math. Credits are optional
// user measurements; no private account APIs or SQLite are queried.
import { loadHarness, loadCodexRouting, maxConcurrentChildren } from '../codex-math/lib/harness.mjs';
import { summarize, calibrationFromSummary as baseCalibration, parseLedgerLine, waveSample, waveSamplesFromLedger } from '../codex-math/lib/calibration.mjs';
import { laneModels } from '../codex-math/lib/forecast.mjs';
import { tierProfile } from '../codex-math/lib/pricing.mjs';
import { makespan } from '../codex-math/lib/walk.mjs';

const TIERS = ['cheap', 'mid', 'strong'];
export { loadHarness };

export function summarizeCodex(cal) {
  const summary = summarize(cal);
  const samples = (cal.samples ?? []).filter(x => x.v === 'codex-1');
  const timed = samples.filter(x => x.kind === 'wave' && x.wallMinutes > 0 && x.makespanUnits > 0);
  if (timed.length) {
    summary.minutesPerUnit = timed.reduce((sum, x) => sum + x.wallMinutes, 0) / timed.reduce((sum, x) => sum + x.makespanUnits, 0);
    summary.nTime = timed.length;
  }
  // The account API measures percentages, not per-thread credits. This derives
  // a useful usage scale for the measured tier mix while preserving the fact
  // that its credit valuation is still a prior.
  const usage = samples.filter(x => x.kind === 'usage' && x.dU > 0 && x.estimatedCredits > 0);
  const sums = new Map();
  for (const sample of usage) {
    const previous = sums.get(sample.window) ?? { dU: 0, estimatedCredits: 0, n: 0 };
    previous.dU += sample.dU;
    previous.estimatedCredits += sample.estimatedCredits;
    previous.n++;
    sums.set(sample.window, previous);
  }
  summary.estimatedWindowCapacityCredits = Object.fromEntries([...sums].map(([id, x]) => [id, 100 * x.estimatedCredits / x.dU]));
  summary.nUsage = Object.fromEntries([...sums].map(([id, x]) => [id, x.n]));
  summary.planType ??= samples.findLast(x => x.planType)?.planType;
  return summary;
}

export function calibrationFromSummary(summary) {
  const calibration = baseCalibration(summary);
  calibration.estimatedUsageWindows = Object.keys(summary.estimatedWindowCapacityCredits ?? {}).filter(id => !calibration.windowCapacityCredits?.[id]);
  calibration.windowCapacityCredits = {
    ...summary.estimatedWindowCapacityCredits,
    ...calibration.windowCapacityCredits,
  };
  return calibration;
}

export function labelCodexForecast(result, calibration) {
  for (const window of result.usage) {
    if (calibration.estimatedUsageWindows.includes(window.id)) {
      window.measuredUsage = true;
      window.capacityBasis = 'measured usage; credit and tier mix priors';
      window.calibrated = false;
    }
  }
  result.calibrated.capacity = result.usage.every(window => window.calibrated);
  return result;
}

// The Codex routing source as is; lanes capped at the child threads Codex runs at once
// (3 by default: 4 threads including the root, decompiled and observed in run 09).
export function codexRouting() {
  const routing = loadCodexRouting();
  const cap = maxConcurrentChildren(loadHarness());
  routing.lanes = { ...routing.lanes, maxParallelLanes: Math.min(routing.lanes.maxParallelLanes, cap) };
  return routing;
}

export function codexWaveSamples(text, lanes, slug, taskById, snapshot) {
  // Old Claude stamps must never train Codex rates.
  text = text.split('\n').filter(line => !/\[(?:5h|7d) /.test(line)).join('\n');
  const routing = codexRouting();
  const harness = loadHarness();
  const profiles = Object.fromEntries(TIERS.map(tier => [tier, tierProfile(routing, harness, tier)]));
  const models = laneModels(lanes, taskById, routing.forecast, profiles);
  const out = waveSamplesFromLedger(text, models, { slug, maxParallel: routing.lanes.maxParallelLanes });
  const entries = text.split('\n').map(parseLedgerLine).filter(Boolean);
  const start = entries.find(entry => /^start:/.test(entry.text));
  const merges = new Map();
  for (const entry of entries) {
    const match = /^wave (\d+): merged/.exec(entry.text);
    if (match) merges.set(Number(match[1]), entry);
  }
  for (const [number, end] of merges) {
    const previous = number === 1 ? start : merges.get(number - 1);
    const wave = models[number - 1];
    if (!previous || !wave) continue;
    const metadata = { slug, wave: number, at: new Date(end.at).toISOString(), planType: snapshot?.planType };
    // Require the same known reset at both ends: an increase alone cannot prove
    // that the account stayed in the same usage window.
    const sameWindow = id => {
      const from = previous.windows[id];
      const to = end.windows[id];
      return from && to && from.resetsAt && from.resetsAt === to.resetsAt && end.at < from.resetsAt && to.usedPercent >= from.usedPercent;
    };
    const windows = Object.keys(previous.windows);
    const estimatedCredits = wave.lanes.reduce((sum, lane) => sum + lane.expectedCredits, 0);
    for (const id of windows.filter(sameWindow)) {
      const dU = end.windows[id].usedPercent - previous.windows[id].usedPercent;
      if (!(dU > 0) || typeof previous.credits === 'number' && typeof end.credits === 'number') continue;
      out.samples.push({
        v: 'codex-1', kind: 'usage', ...metadata, window: id, dU, estimatedCredits,
        windowMinutes: snapshot?.windows?.find(window => window.id === id)?.windowMinutes,
        basis: 'measured usage; credit and tier mix priors',
        profiles: Object.fromEntries(TIERS.map(tier => [tier, { model: profiles[tier].model, effort: profiles[tier].effort, creditsPerUnit: profiles[tier].creditsPerUnit }])),
      });
    }
    if (out.samples.some(sample => sample.kind === 'wave' && sample.wave === number)) continue;
    if (!windows.length || !windows.every(sameWindow)) continue;
    const unitsByTier = Object.fromEntries(TIERS.map(tier => [tier, 0]));
    const weights = [];
    for (const lane of wave.lanes) {
      const fix = lane.credits > 0 ? lane.expectedCredits / lane.credits : 1;
      weights.push(lane.units * fix);
      for (const tier of TIERS) unitsByTier[tier] += lane.byTier[tier].units * fix;
    }
    out.skipped = out.skipped.filter(message => message !== `wave ${number}: no credits reading at its start or merge; skipped`);
    out.samples.push({
      ...waveSample(unitsByTier, undefined, {
        slug, wave: number, wallMinutes: (end.at - previous.at) / 60_000,
        makespanUnits: makespan(weights, routing.lanes.maxParallelLanes),
      }),
      ...metadata,
    });
  }
  return out;
}
