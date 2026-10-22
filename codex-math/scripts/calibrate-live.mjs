#!/usr/bin/env node
// Turn the live evidence (probes, calibration runs, extracted readings) into calibration samples and a
// summary, with the model code in codex-math/lib. Safe to run on a partial set: it reports what it found.
//
//   node codex-math/scripts/calibrate-live.mjs [--live codex-math/evidence/live]
//
// Writes <live>/calibration-summary.json and prints the summary.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadHarness, loadCodexRouting, tierOfCodexModel } from '../lib/harness.mjs';
import { creditsForTokens } from '../lib/pricing.mjs';
import { fromAppServer } from '../lib/windows.mjs';
import { capacitySamples, tierSamples, summarize, calibrationFromSummary } from '../lib/calibration.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};
const live = resolve(opt('--live', 'codex-math/evidence/live'));
const harness = loadHarness();
const routing = loadCodexRouting();
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const report = { live, runs: [], readingsFromRollouts: 0, samples: [], notes: [] };

// 1. controlled runs: before/after probes bracket one thread each
const runsDir = join(live, 'runs');
const readings = []; // for capacity: { at, windows, credits }
let cumulativeCredits = 0;
if (existsSync(runsDir)) {
  for (const label of readdirSync(runsDir).sort()) {
    const dir = join(runsDir, label);
    if (!existsSync(join(dir, 'meta.json'))) continue;
    const meta = read(join(dir, 'meta.json'));
    const before = existsSync(join(dir, 'probe-before.json')) ? read(join(dir, 'probe-before.json')) : undefined;
    const after = existsSync(join(dir, 'probe-after.json')) ? read(join(dir, 'probe-after.json')) : undefined;
    const rlB = before?.responses?.['account/rateLimits/read']?.[0]?.result;
    const rlA = after?.responses?.['account/rateLimits/read']?.[0]?.result;
    const snapB = rlB ? fromAppServer(rlB, { updatedAt: before.startedAt }) : undefined;
    const snapA = rlA ? fromAppServer(rlA, { updatedAt: after.finishedAt }) : undefined;
    const usageRes = after?.responses?.['account/usage/read']?.find((r) => r.params?.threadId)?.result;
    const estimate = usageRes?.threadUsage;
    const backendCredits = estimate ? estimate.estimatedUsageCreditsMicros / 1e6 : undefined;
    const tc = meta.turnCompleted?.usage;
    const usage = tc ? { model: meta.model, speed: meta.speed, inputTokens: tc.input_tokens, cachedInputTokens: tc.cached_input_tokens, outputTokens: tc.output_tokens, reasoningOutputTokens: tc.reasoning_output_tokens } : undefined;
    const ratedCredits = usage ? creditsForTokens(harness, usage) : undefined;
    const tier = tierOfCodexModel(routing, meta.model);
    const run = { label, model: meta.model, effort: meta.effort, speed: meta.speed, units: meta.units, threadId: meta.threadId, wallSeconds: meta.wallSeconds, exitStatus: meta.exitStatus, usage, backendCredits, ratedCredits, groups: estimate?.groups, before: snapB?.windows, after: snapA?.windows, planType: snapA?.planType ?? snapB?.planType };
    report.runs.push(run);
    const credits = backendCredits ?? ratedCredits;
    if (credits !== undefined && snapB && snapA) {
      const win = (s) => Object.fromEntries(s.windows.map((w) => [w.id, { usedPercent: w.usedPercent, resetsAt: w.resetsAt }]));
      readings.push({ at: Date.parse(snapB.updatedAt), windows: win(snapB), credits: cumulativeCredits, label });
      cumulativeCredits += credits;
      readings.push({ at: Date.parse(snapA.updatedAt), windows: win(snapA), credits: cumulativeCredits, label });
    }
    if (credits !== undefined && tier && meta.units > 0) {
      report.samples.push(...tierSamples([{ tier, units: meta.units, credits, model: meta.model, effort: meta.effort, speed: meta.speed }], harness, { slug: 'live', wave: label }));
    }
    if (backendCredits !== undefined && ratedCredits !== undefined) report.notes.push(`${label}: backend ${backendCredits.toFixed(3)} credits vs published rates ${ratedCredits.toFixed(3)} (ratio ${(backendCredits / ratedCredits).toFixed(2)})`);
  }
}
if (readings.length) {
  const cap = capacitySamples(readings, { slug: 'live' });
  report.samples.push(...cap.samples);
  report.notes.push(...cap.skipped);
}

// 2. readings mined from existing rollouts: consecutive token_count events of one thread give the
// window movement per token delta; credits are computed from the published rates (no backend estimate per turn)
const rfile = join(live, 'readings.json');
if (existsSync(rfile)) {
  const r = read(rfile).readings.filter((x) => x.rateLimits?.primary && x.total && x.model);
  report.readingsFromRollouts = r.length;
  const byThread = new Map();
  for (const x of r) byThread.set(x.threadId, [...(byThread.get(x.threadId) ?? []), x]);
  const rows = [];
  const unpriced = new Set();
  for (const [thread, xs] of byThread) {
    let prev;
    for (const x of xs) {
      let credits;
      try {
        credits = creditsForTokens(harness, { model: x.model, inputTokens: x.total.input_tokens, cachedInputTokens: x.total.cached_input_tokens, outputTokens: x.total.output_tokens });
      } catch {
        unpriced.add(x.model); // e.g. codex-auto-review: no published rates, so no credit estimate for its readings
        continue;
      }
      const windows = {};
      for (const id of ['primary', 'secondary']) {
        const w = x.rateLimits[id];
        if (w && typeof w.used_percent === 'number') windows[id] = { usedPercent: w.used_percent, resetsAt: typeof w.resets_at === 'number' ? w.resets_at * 1000 : undefined };
      }
      rows.push({ at: Date.parse(x.at), windows, credits, thread });
      prev = x;
    }
  }
  // readings across threads interleave in time; credits must be cumulative over the account, which a single
  // thread cannot give, so only within-thread consecutive pairs are used
  for (const [thread, xs] of byThread) {
    const seq = rows.filter((row) => row.thread === thread).sort((a, b) => a.at - b.at);
    const cap = capacitySamples(seq, { slug: `rollout:${thread.slice(0, 8)}` });
    report.samples.push(...cap.samples);
  }
  if (unpriced.size) report.notes.push(`rollouts: readings of models without published rates skipped: ${[...unpriced].join(", ")}`);
  const plans = [...new Set(r.map((x) => x.rateLimits.planType).filter(Boolean))];
  const durations = [...new Set(r.flatMap((x) => [x.rateLimits.primary?.window_minutes, x.rateLimits.secondary?.window_minutes]).filter((v) => v != null))];
  report.notes.push(`rollouts: plan types ${plans.join(', ') || 'none'}; window minutes seen: ${durations.join(', ') || 'none'}`);
  if (plans.length) report.planType = plans.at(-1);
}

const summary = summarize({ samples: report.samples, planType: report.planType ?? report.runs.find((x) => x.planType)?.planType });
report.summary = summary;
report.calibration = calibrationFromSummary(summary);
writeFileSync(join(live, 'calibration-summary.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ runs: report.runs.length, readingsFromRollouts: report.readingsFromRollouts, samples: report.samples.length, summary, notes: report.notes }, null, 1));
