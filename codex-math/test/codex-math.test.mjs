import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadCodexRouting, loadHarness, windowsForPlan, effectiveContextWindow, autoCompactTokenLimit, maxConcurrentChildren, CODEX_MATH_ROOT } from '../lib/harness.mjs';
import { creditsForTokens, creditsPerToken, meterWeight, speedMultiplier, speedup, tierCreditRatios, tierProfile, windowCapacity } from '../lib/pricing.mjs';
import { fromAppServer, fromRelaySnapshot, fromRolloutJsonl, fromRolloutTokenCount, isStale, describe } from '../lib/windows.mjs';
import { makespan, simulate } from '../lib/walk.mjs';
import { capacitySamples, calibrationFromSummary, formatStamp, nnls, parseLedgerLine, summarize, tierSamples, usageFromRolloutJsonl, waveSample, waveSamplesFromLedger } from '../lib/calibration.mjs';
import { bindingWindow, levelFor, resetAdvice, routeSpawn } from '../lib/budget.mjs';
import { forecast, laneModels, taskUnits } from '../lib/forecast.mjs';
import { parsePlan } from '../../lib/plan.mjs';
import { computeLanes } from '../../lib/lanes.mjs';

const harness = loadHarness();
const routing = loadCodexRouting();
const RELAY_ROOT = join(CODEX_MATH_ROOT, '..');

test('harness facts: the models relay routes to exist with the observed context window', () => {
  for (const tier of ['cheap', 'mid', 'strong']) {
    const slug = routing.tiers[tier].model;
    const m = harness.models.find((x) => x.slug === slug);
    assert.ok(m, `${slug} is in the extracted catalog`);
    assert.equal(m.contextWindow, 272000, 'the static catalog');
    assert.equal(effectiveContextWindow(harness, slug), slug === 'gpt-6.1-sol' ? 475000 : 258400, 'what token_count.model_context_window reports (the remote catalog gave Sol 6.1 a 500k window)');
    assert.equal(autoCompactTokenLimit(harness, slug), slug === 'gpt-6.1-sol' ? 450000 : 244800, 'compaction at 90% of the window (decompiled)');
    assert.ok(m.reasoningEfforts.includes(routing.tiers[tier].effort), `${slug} advertises ${routing.tiers[tier].effort}`);
  }
  assert.deepEqual(windowsForPlan(harness, 'plus').map((w) => w.windowMinutes), [300, 10080]);
  assert.deepEqual(windowsForPlan(harness, 'pro').map((w) => w.windowMinutes), [10080]);
  assert.deepEqual(windowsForPlan(harness, 'self_serve_business_prolite').map((w) => w.windowMinutes), [10080], 'the live Business account: a weekly window only');
  assert.equal(autoCompactTokenLimit(harness, 'gpt-6-luna', 100000), 100000, 'the user limit wins');
  assert.equal(maxConcurrentChildren(harness), 3, 'compiled default 4 threads including the root; run 09 saw the 4th spawn fail');
  assert.equal(maxConcurrentChildren(harness, { max_concurrent_threads_per_session: 6 }), 6);
  assert.deepEqual(windowsForPlan(harness, 'nonsense').map((w) => w.id), ['primary', 'secondary']);
});

test('pricing: credits follow the published rates, cached input is a subset of input, speed multiplies', () => {
  // 1M uncached input on gpt-6.1-sol = 50 credits; 1M cached = 2.5; 1M output = 250
  assert.equal(creditsForTokens(harness, { model: 'gpt-6.1-sol', inputTokens: 1e6 }), 50);
  assert.equal(creditsForTokens(harness, { model: 'gpt-6.1-sol', inputTokens: 1e6, cachedInputTokens: 1e6 }), 2.5);
  assert.equal(creditsForTokens(harness, { model: 'gpt-6.1-sol', outputTokens: 1e6 }), 250);
  assert.equal(creditsForTokens(harness, { model: 'gpt-6.1-sol', inputTokens: 1e6, speed: 'fast' }), 125, 'Fast meters 2.5× included usage');
  assert.equal(creditsForTokens(harness, { model: 'gpt-6.1-sol', inputTokens: 1e6, speed: 'fast' }, 'credits'), 100, 'and 2× purchased credits');
  assert.equal(speedMultiplier(harness, 'ultrafast'), 8);
  // the subscription meter weighs Astra at half its published rate (fitted on the live weekly window); purchased credits do not
  assert.equal(meterWeight(harness, 'gpt-6-astra'), 0.5);
  assert.equal(creditsForTokens(harness, { model: 'gpt-6-astra', outputTokens: 1e6 }), 625);
  assert.equal(creditsForTokens(harness, { model: 'gpt-6-astra', outputTokens: 1e6 }, 'credits'), 1250);
  assert.equal(creditsForTokens(harness, { model: 'codex-auto-review', inputTokens: 1e6 }), 50, 'the review model is priced as Sol 6.1');
  assert.equal(speedup(harness, 'gpt-6-astra', 'fast'), 2);
  assert.equal(speedup(harness, 'gpt-6-luna', 'fast'), 1.5);
  // the tier ladder on this harness is 1 : 15 : 62 at the measured mix and weights, not relay's 1:3:7
  const r = tierCreditRatios(routing, harness);
  assert.equal(r.cheap, 1);
  assert.ok(r.mid > 12 && r.mid < 20, `mid/cheap ≈ 15 (got ${r.mid})`);
  assert.ok(r.strong > 50 && r.strong < 80, `strong/cheap ≈ 62 (got ${r.strong})`);
  // the priors reproduce what the nine scratch runs measured per unit (evidence/RESULTS.md §D)
  const unit = Object.fromEntries(['cheap', 'mid', 'strong'].map((t) => [t, tierProfile(routing, harness, t).creditsPerUnit]));
  assert.ok(unit.cheap > 0.018 && unit.cheap < 0.03, `cheap ≈ 0.02 (got ${unit.cheap})`);
  assert.ok(unit.mid > 0.3 && unit.mid < 0.5, `mid ≈ 0.4 (got ${unit.mid})`);
  assert.ok(unit.strong > 0.7 && unit.strong < 2.0, `strong ≈ 0.74–1.65 (got ${unit.strong})`);
  // overriding the speed of a tier changes credits and minutes together
  const std = tierProfile(routing, harness, 'mid');
  const fast = tierProfile(routing, harness, 'mid', { speed: 'fast' });
  assert.ok(Math.abs(fast.creditsPerUnit / std.creditsPerUnit - 2.5) < 1e-9);
  assert.equal(fast.minutesPerUnit, std.minutesPerUnit / 2);
  // a calibrated credits-per-unit is rescaled when the model changes
  const cal = { creditsPerUnit: { mid: 2 }, creditsPerUnitAt: { mid: { model: 'gpt-6.1-sol', effort: 'medium', speed: 'standard' } } };
  const onLuna = tierProfile(routing, harness, 'mid', { model: 'gpt-6-luna', effort: 'low' }, cal);
  const expected = 2 * (creditsPerToken(harness, 'gpt-6-luna', routing.forecast.prior.tokenMix) / creditsPerToken(harness, 'gpt-6.1-sol', routing.forecast.prior.tokenMix, { effortOutputMultiplier: 1.5 }));
  assert.ok(Math.abs(onLuna.creditsPerUnit - expected) < 1e-12);
  assert.equal(windowCapacity(routing, harness, 'primary', 'pro').credits, 15000);
  assert.equal(windowCapacity(routing, harness, 'primary', 'self_serve_business_prolite').credits, 6200, 'measured on the live account');
  assert.equal(windowCapacity(routing, harness, 'secondary', 'self_serve_business_prolite').credits, 1400, 'a window the plan does not have falls back to the unknown plan');
  assert.deepEqual(windowCapacity(routing, harness, 'primary', 'plus', { windowCapacityCredits: { primary: 123 } }), { credits: 123, calibrated: true });
});

test('windows: every protocol shape normalizes to the same snapshot', () => {
  const v2 = {
    rateLimits: { planType: 'plus', limitId: 'codex', primary: { usedPercent: 42, resetsAt: 1792670000, windowDurationMins: 300 }, secondary: { usedPercent: 17, resetsAt: 1793000000, windowDurationMins: 10080 }, credits: { hasCredits: false, unlimited: false, balance: null } },
    rateLimitResetCredits: { availableCount: 2, credits: null },
    rateLimitsByLimitId: { codex: { primary: { usedPercent: 42 } } },
    ordinaryUsageAllowed: true,
  };
  const a = fromAppServer(v2);
  assert.equal(a.source, 'app-server');
  assert.equal(a.planType, 'plus');
  assert.deepEqual(a.windows.map((w) => [w.id, w.usedPercent, w.windowMinutes]), [['primary', 42, 300], ['secondary', 17, 10080]]);
  assert.equal(a.windows[0].resetsAt, new Date(1792670000 * 1000).toISOString());
  assert.equal(a.resetCredits.availableCount, 2);
  assert.equal(a.byLimitId.codex.windows[0].usedPercent, 42);
  assert.equal(fromAppServer({ rateLimits: { primary: { usedPercent: 5 } } }).windows.length, 1, 'the sparse notification shape');
  const core = { type: 'token_count', info: { total_token_usage: { total_tokens: 1234 }, model_context_window: 258400 }, rate_limits: { plan_type: 'pro', primary: { used_percent: 61.5, window_minutes: 10080, resets_at: 1793000000 }, secondary: null, credits: { has_credits: true, unlimited: false, balance: '12.5' } } };
  const b = fromRolloutTokenCount(core, '2026-10-22T10:00:00.000Z');
  assert.equal(b.source, 'rollout');
  assert.equal(b.planType, 'pro');
  assert.deepEqual(b.windows, [{ id: 'primary', usedPercent: 61.5, windowMinutes: 10080, resetsAt: new Date(1793000000 * 1000).toISOString() }]);
  assert.equal(b.contextWindow, 258400);
  assert.equal(b.credits.hasCredits, true);
  const jsonl = ['{"timestamp":"2026-10-22T10:00:00.000Z","type":"session_meta","payload":{"id":"x"}}', JSON.stringify({ timestamp: '2026-10-22T10:05:00.000Z', type: 'event_msg', payload: core }), '{"timestamp":"2026-10-22T10:06:00.000Z","type":"event_msg","payload":{"type":"agent_message","message":"rate_limits mentioned in prose"}}'].join('\n');
  assert.equal(fromRolloutJsonl(jsonl).updatedAt, '2026-10-22T10:05:00.000Z');
  const relay = fromRelaySnapshot({ fiveHour: { percentUsed: 23.4, resetsAt: '2026-10-22T16:30:00.000Z' }, sevenDay: { percentUsed: 41 }, updatedAt: '2026-10-22T14:02:00.000Z' });
  assert.deepEqual(relay.windows.map((w) => [w.id, w.usedPercent, w.windowMinutes]), [['primary', 23.4, 300], ['secondary', 41, 10080]]);
  const now = Date.parse('2026-10-22T14:10:00.000Z');
  assert.equal(isStale(relay, 20, now), false);
  assert.equal(isStale(relay, 5, now), true, 'older than the allowance');
  assert.equal(isStale(relay, 20, Date.parse('2026-10-22T16:31:00.000Z')), true, 'a window that reset says nothing about the new one');
  assert.match(describe(a), /5h 42% resets .*7d 17%.*no credits.*2 reset credit/);
});

test('walk: no pause below the line, a pause at the line, a reset credit instead of a pause, Pro has one window', () => {
  const lanes = (credits, minutes) => [{ id: 'a', credits, minutes }];
  const win = (over = {}) => ({ id: 'primary', capacityCredits: 100, windowMinutes: 300, usedPercent: 0, stopLine: 85, ...over });
  const fits = simulate({ waves: [{ wave: 1, lanes: lanes(50, 60) }], windows: [win()] });
  assert.deepEqual([fits.waitMinutes, fits.workMinutes, fits.windows.primary.windowsUsed], [0, 60, 1]);
  // 120 credits at 100 per window: the line (85) is hit after 85 credits = 170 min; wait until minute 300, then 35 more credits
  const pause = simulate({ waves: [{ wave: 1, lanes: lanes(120, 240) }], windows: [win()] });
  assert.equal(pause.workMinutes, 240);
  assert.equal(pause.waitMinutes, 130);
  assert.equal(pause.windows.primary.windowsUsed, 2);
  assert.equal(pause.waits[0].window, 'primary');
  // a reset credit restores the window immediately when the wait is long enough
  const credit = simulate({ waves: [{ wave: 1, lanes: lanes(120, 240) }], windows: [win()], resetCredits: { available: 1, minWaitMinutes: 60 } });
  assert.deepEqual([credit.waitMinutes, credit.resetsConsumed], [0, 1]);
  const noCredit = simulate({ waves: [{ wave: 1, lanes: lanes(120, 240) }], windows: [win()], resetCredits: { available: 1, minWaitMinutes: 200 } });
  assert.deepEqual([noCredit.waitMinutes, noCredit.resetsConsumed], [130, 0], 'a wait shorter than the threshold keeps the credit');
  // a reading places the current window: 40% used, reset in 60 minutes
  const placed = simulate({ waves: [{ wave: 1, lanes: lanes(60, 120) }], windows: [win({ usedPercent: 40, resetInMinutes: 60 })] });
  assert.equal(placed.windows.primary.windowsUsed, 2, 'the window rolls over at minute 60');
  assert.equal(placed.waitMinutes, 0, '40 + 30 = 70 < 85 before the rollover; the rest lands in the new window');
  // two windows: the secondary binds when the primary does not
  const two = simulate({ waves: [{ wave: 1, lanes: lanes(50, 60) }], windows: [win({ capacityCredits: 1000 }), { id: 'secondary', capacityCredits: 50, windowMinutes: 10080, usedPercent: 0, stopLine: 95 }] });
  assert.equal(two.waits[0].window, 'secondary');
  assert.ok(two.longestWaitMinutes > 9000, 'a weekly pause is days long and reported as such');
  assert.equal(makespan([5, 3, 2, 2], 2), 7, 'heaviest first on the slot that frees first (greedy, as relay)');
});

test('calibration: capacity ratio estimator, attributed tiers, NNLS over waves, ledger stamps', () => {
  const readings = [
    { at: 0, windows: { primary: { usedPercent: 10, resetsAt: 300 * 60_000 }, secondary: { usedPercent: 5 } }, credits: 0 },
    { at: 60 * 60_000, windows: { primary: { usedPercent: 40 }, secondary: { usedPercent: 10 } }, credits: 45 },
    { at: 120 * 60_000, windows: { primary: { usedPercent: 70 }, secondary: { usedPercent: 15 } }, credits: 90 },
    { at: 400 * 60_000, windows: { primary: { usedPercent: 5 }, secondary: { usedPercent: 20 } }, credits: 135 }, // the primary reset: dropped for primary, kept for secondary
  ];
  const cap = capacitySamples(readings);
  const s1 = summarize({ samples: cap.samples });
  assert.equal(s1.windowCapacityCredits.primary, 150, '45 credits moved the primary 30 points → 150 credits per window');
  assert.equal(s1.windowCapacityCredits.secondary, 900);
  assert.equal(s1.nCapacity.primary, 2);
  assert.equal(s1.nCapacity.secondary, 3);
  assert.ok(cap.skipped.some((x) => /primary window reset/.test(x)));
  const tiers = tierSamples(
    [
      { tier: 'mid', units: 3, credits: 4.5, model: 'gpt-6.1-sol', effort: 'medium' },
      { tier: 'mid', units: 3, usage: { model: 'gpt-6.1-sol', inputTokens: 200000, cachedInputTokens: 150000, outputTokens: 10000 }, model: 'gpt-6.1-sol', effort: 'medium' },
      { tier: 'cheap', units: 1, credits: 0.1, model: 'gpt-6-luna', effort: 'low' },
    ],
    harness,
  );
  assert.equal(tiers[1].measured, 'tokens');
  assert.ok(Math.abs(tiers[1].credits - (50000 * 50 + 150000 * 2.5 + 10000 * 250) / 1e6) < 1e-12);
  const s2 = summarize({ samples: tiers });
  assert.ok(Math.abs(s2.creditsPerUnit.mid - (4.5 + tiers[1].credits) / 6) < 1e-12);
  assert.equal(s2.creditsPerUnitAt.mid.model, 'gpt-6.1-sol');
  // waves without attribution: NNLS recovers the coefficients of a clean system
  const waves = [waveSample({ cheap: 2, mid: 4, strong: 0 }, 2 * 0.1 + 4 * 1.5, { wallMinutes: 40, makespanUnits: 10 }), waveSample({ cheap: 5, mid: 1, strong: 0 }, 5 * 0.1 + 1 * 1.5, { wallMinutes: 44, makespanUnits: 11 })];
  const s3 = summarize({ samples: waves });
  assert.ok(Math.abs(s3.creditsPerUnit.cheap - 0.1) < 1e-6 && Math.abs(s3.creditsPerUnit.mid - 1.5) < 1e-6);
  assert.equal(s3.creditsPerUnit.strong, undefined, 'a tier that never ran gets no rate');
  assert.equal(s3.minutesPerUnit, 84 / 21);
  assert.deepEqual(nnls([{ x: [1, 0], y: -5 }, { x: [0, 1], y: 3 }], 2), [0, 3], 'non-negative');
  const cal = calibrationFromSummary({ ...summarize({ samples: [...cap.samples, ...tiers] }), minutesPerUnit: 4.2, planType: 'plus' });
  assert.deepEqual(Object.keys(cal).sort(), ['creditsPerUnit', 'creditsPerUnitAt', 'minutesPerUnit', 'planType', 'windowCapacityCredits']);
  // stamps
  const stamp = formatStamp({ windows: [{ id: 'primary', usedPercent: 23.4, resetsAt: '2026-10-19T16:30:00.000Z' }, { id: 'secondary', usedPercent: 41 }] }, 12.345);
  assert.equal(stamp, ' [primary 23.4% resets 2026-10-19T16:30:00.000Z · secondary 41% · credits 12.35]');
  const line = parseLedgerLine(`- 2026-10-19 14:02${stamp} wave 1: merged @ abc, suite pass`);
  assert.equal(line.windows.primary.usedPercent, 23.4);
  assert.equal(line.windows.primary.resetsAt, Date.parse('2026-10-19T16:30:00.000Z'));
  assert.equal(line.windows.secondary.usedPercent, 41);
  assert.equal(line.credits, 12.35);
  assert.equal(parseLedgerLine('- 2026-10-19 14:02 [5h 10% resets 16:30 · 7d 2%] start: run').windows.primary.usedPercent, 10, "relay's own labels still parse");
});

test('calibration from a ledger: a wave with readings at both ends gives credits, time and capacity samples', () => {
  const plan = parsePlan(readFileSync(join(CODEX_MATH_ROOT, 'docs', 'whitepaper', 'example-plan.md'), 'utf8'));
  const lanes = computeLanes(plan);
  const taskById = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
  const profiles = Object.fromEntries(['cheap', 'mid', 'strong'].map((t) => [t, tierProfile(routing, harness, t)]));
  const models = laneModels(lanes, taskById, routing.forecast, profiles);
  const ledger = [
    '# relay ledger',
    '- 2026-10-19 14:00 [primary 10% resets 18:30 · secondary 20% · credits 100] start: run',
    '- 2026-10-19 15:30 [primary 40% resets 18:30 · secondary 25% · credits 145] wave 1: merged @ a1, suite pass',
    '- 2026-10-19 19:30 [primary 10% resets 23:30 · secondary 60% · credits 700] wave 2: merged @ b2, suite pass',
  ].join('\n');
  const { samples, skipped } = waveSamplesFromLedger(ledger, models, { slug: plan.slug, maxParallel: 4 });
  const waves = samples.filter((s) => s.kind === 'wave');
  assert.equal(waves.length, 2);
  assert.equal(waves[0].credits, 45);
  assert.equal(waves[0].wallMinutes, 90);
  assert.ok(waves[0].unitsByTier.mid > 0);
  assert.ok(samples.some((s) => s.kind === 'capacity' && s.window === 'primary' && s.dU === 30 && s.dC === 45));
  assert.ok(skipped.some((x) => /wave 2: the primary window reset/.test(x)), 'wave 2 crossed the primary reset: no primary capacity sample from it');
  assert.ok(samples.some((s) => s.kind === 'capacity' && s.window === 'secondary' && s.dC === 555));
  const sum = summarize({ samples });
  assert.equal(sum.windowCapacityCredits.primary, 150);
  assert.ok(sum.minutesPerUnit > 0);
});

test('budget: levels per window, degrade order speed → effort → model, deny at critical', () => {
  const snap = (p, s, extra = {}) => ({ windows: [{ id: 'primary', usedPercent: p, resetsAt: new Date(Date.now() + 90 * 60_000).toISOString() }, ...(s === undefined ? [] : [{ id: 'secondary', usedPercent: s }])], ...extra });
  assert.equal(levelFor(undefined, routing), 'unknown');
  assert.equal(levelFor(snap(10, 10), routing), 'normal');
  assert.equal(levelFor(snap(61, 10), routing), 'tight');
  assert.equal(levelFor(snap(10, 81), routing), 'tight');
  assert.equal(levelFor(snap(86, 10), routing), 'critical');
  assert.equal(levelFor(snap(10, 10, { reached: 'rate_limit_reached' }), routing), 'critical', 'the backend said so');
  assert.equal(levelFor(snap(70), routing), 'tight', 'Pro: one window');
  assert.equal(bindingWindow(snap(70, 90), routing).id, 'secondary');
  const plain = routeSpawn({ subagentType: 'relay:implementer-deep' }, 'normal', routing, harness);
  assert.deepEqual([plain.model, plain.effort, plain.speed, plain.changes], ['gpt-6-astra', 'high', 'standard', []]);
  const tight = routeSpawn({ subagentType: 'relay:implementer-deep', speed: 'fast' }, 'tight', routing, harness);
  assert.deepEqual([tight.model, tight.effort, tight.speed], ['gpt-6.1-sol', 'medium', 'standard']);
  assert.deepEqual(tight.changes, ['speed fast → standard', 'effort high → medium', 'model gpt-6-astra → gpt-6.1-sol']);
  const architect = routeSpawn({ subagentType: 'relay:architect', speed: 'fast' }, 'tight', routing, harness);
  assert.deepEqual([architect.model, architect.effort, architect.speed, architect.changes], ['gpt-6-astra', 'high', 'fast', []], 'exempt at tight');
  const critical = routeSpawn({ subagentType: 'relay:implementer' }, 'critical', routing, harness);
  assert.match(critical.deny, /critical/);
  const reviewer = routeSpawn({ subagentType: 'relay:reviewer', model: 'gpt-6-astra', effort: 'xhigh' }, 'critical', routing, harness);
  assert.deepEqual([reviewer.model, reviewer.effort, reviewer.deny], ['gpt-6.1-sol', 'medium', undefined]);
  const unrouted = routeSpawn({ subagentType: 'explorer' }, 'normal', routing, harness);
  assert.equal(unrouted.model, routing.tiers[routing.defaultSubagentTier].model, 'a spawn without a role gets the default tier, never the session model');
  const badEffort = routeSpawn({ subagentType: 'relay:scout', effort: 'ultra' }, 'normal', routing, harness);
  assert.equal(badEffort.effort, 'medium', 'gpt-6-luna does not advertise ultra; its default effort applies');
  // reset credits
  const atLine = { planType: 'plus', windows: [{ id: 'primary', usedPercent: 90, resetsAt: new Date(Date.now() + 120 * 60_000).toISOString() }], resetCredits: { availableCount: 1 } };
  assert.equal(resetAdvice(atLine, routing).consume, true);
  assert.equal(resetAdvice({ ...atLine, resetCredits: { availableCount: 0 } }, routing).purchasable, true);
  assert.equal(resetAdvice({ ...atLine, windows: [{ ...atLine.windows[0], resetsAt: new Date(Date.now() + 30 * 60_000).toISOString() }] }, routing).consume, false, 'a short wait keeps the credit');
  assert.equal(resetAdvice(snap(10, 10), routing).consume, false);
});

test('forecast: credits add up, usage is credits over capacity, the walk and the levers are reported', () => {
  const plan = parsePlan(readFileSync(join(CODEX_MATH_ROOT, 'docs', 'whitepaper', 'example-plan.md'), 'utf8'));
  const lanes = computeLanes(plan);
  const f = forecast({ plan, lanes, routing, harness });
  assert.deepEqual([f.tasks, f.lanes, f.waves, f.units], [30, 7, 3, 108.4]);
  const byTier = Object.values(f.credits.byTier).reduce((a, t) => a + t.credits, 0);
  assert.ok(Math.abs(byTier - f.credits.expected) < 0.05);
  assert.ok(f.credits.byTier.strong.credits / f.credits.expected > 0.7, 'on this harness the strong tier holds most of the credits');
  const primary = f.usage.find((u) => u.id === 'primary');
  assert.ok(Math.abs(primary.pct - (f.credits.expected / primary.capacityCredits) * 100) < 0.11);
  assert.equal(f.calibrated.credits, false);
  assert.ok(f.time.workMinutes > 0 && f.time.totalMinutes >= f.time.workMinutes);
  assert.ok(f.fastLane.every((x) => x.extraCredits >= 0 && x.minutesSaved >= 0));
  assert.ok(f.tierSensitivity.strongOnMid < f.credits.expected);
  // a Pro reading: one weekly window, no five-hour pauses
  const pro = forecast({ plan, lanes, routing, harness, snapshot: { planType: 'pro', updatedAt: new Date().toISOString(), windows: [{ id: 'primary', usedPercent: 10, windowMinutes: 10080 }] } });
  assert.equal(pro.usage.length, 1);
  assert.equal(pro.time.waitMinutes, 0);
  // calibration changes the numbers and the labels
  const cal = { windowCapacityCredits: { primary: 300, secondary: 2000 }, creditsPerUnit: { cheap: 0.05, mid: 1, strong: 8 }, minutesPerUnit: 3 };
  const c = forecast({ plan, lanes, routing, harness, calibration: cal });
  assert.equal(c.calibrated.credits, true);
  assert.equal(c.calibrated.capacity, true);
  assert.equal(c.usage[0].capacityCredits, 300);
  assert.ok(c.time.workMinutes < f.time.workMinutes);
  assert.ok(Math.abs(taskUnits({ tier: 'strong', risk: 'high' }, routing.forecast) - 9.8) < 1e-9);
});

test('reading the harness stores: a real rollout written by codex exec 0.163.0', () => {
  const text = readFileSync(join(CODEX_MATH_ROOT, 'evidence', 'captures', 'rollout-exec-json-sample.jsonl'), 'utf8');
  const first = JSON.parse(text.split('\n')[0]);
  assert.equal(first.type, 'session_meta');
  assert.equal(first.payload.cli_version, '0.163.0');
  const started = text.split('\n').map((l) => l && JSON.parse(l)).find((r) => r && r.type === 'event_msg' && r.payload.type === 'task_started');
  assert.equal(started.payload.model_context_window, 258400);
  assert.equal(fromRolloutJsonl(text), undefined, 'no token_count was written: the request never reached the model');
  assert.equal(usageFromRolloutJsonl(text), undefined);
});

test('review fixes: identification, zero-credit waves, ISO resets, quantized readings, partial snapshots, Pro lines', async () => {
  const { matrixRank } = await import('../lib/calibration.mjs');
  const { mergeSnapshots } = await import('../lib/windows.mjs');
  const { stopLinesFor } = await import('../lib/budget.mjs');
  // 1. wave totals that never separate strong from mid do not calibrate either tier
  const collinear = [waveSample({ cheap: 1, mid: 1, strong: 2 }, 20.47), waveSample({ cheap: 2, mid: 2, strong: 4 }, 40.94), waveSample({ cheap: 3, mid: 1, strong: 2 }, 20.59)];
  const s = summarize({ samples: collinear });
  assert.equal(s.nnlsIdentified, false);
  assert.deepEqual(s.creditsPerUnit, {}, 'rank-deficient waves leave the priors alone');
  assert.equal(matrixRank([[1, 1, 2], [2, 2, 4], [3, 1, 2]]), 2);
  assert.equal(matrixRank([[2, 4, 0], [5, 1, 0]]), 2);
  const identified = summarize({ samples: [waveSample({ cheap: 2, mid: 4, strong: 1 }, 2 * 0.1 + 4 * 1.5 + 8), waveSample({ cheap: 5, mid: 1, strong: 0 }, 5 * 0.1 + 1.5), waveSample({ cheap: 1, mid: 1, strong: 3 }, 0.1 + 1.5 + 24)] });
  assert.equal(identified.nnlsIdentified, true);
  assert.ok(Math.abs(identified.creditsPerUnit.strong - 8) < 1e-6);
  // 2. a wave without credits still takes its time
  const free = simulate({ waves: [{ wave: 1, lanes: [{ id: 'a', credits: 0, minutes: 50 }] }, { wave: 2, lanes: [{ id: 'b', credits: 10, minutes: 10 }] }], windows: [{ id: 'primary', capacityCredits: 100, windowMinutes: 300, usedPercent: 0, stopLine: 85 }] });
  assert.deepEqual([free.workMinutes, free.events[0].end, free.events[1].start], [60, 50, 50]);
  // 3. an ISO reset time between two readings drops the interval
  const iso = capacitySamples([
    { at: Date.parse('2026-10-22T10:00:00Z'), windows: { primary: { usedPercent: 70, resetsAt: '2026-10-22T11:00:00Z' } }, credits: 0 },
    { at: Date.parse('2026-10-22T13:00:00Z'), windows: { primary: { usedPercent: 75 } }, credits: 120 },
  ]);
  assert.equal(iso.samples.length, 0);
  assert.match(iso.skipped[0], /reset in between/);
  // 4. integer readings: credits spent while the percent stands still are carried, not lost
  const q = capacitySamples([
    { at: 0, windows: { primary: { usedPercent: 10 } }, credits: 0 },
    { at: 1, windows: { primary: { usedPercent: 10 } }, credits: 0.5 },
    { at: 2, windows: { primary: { usedPercent: 11 } }, credits: 1.0 },
  ]);
  assert.deepEqual(q.samples.map((x) => [x.dU, x.dC]), [[1, 1.0]]);
  assert.equal(summarize({ samples: q.samples }).windowCapacityCredits.primary, 100);
  // 5. a reading with only the secondary window keeps the plan's primary window at 0%
  const plan = parsePlan(readFileSync(join(CODEX_MATH_ROOT, 'docs', 'whitepaper', 'example-plan.md'), 'utf8'));
  const lanes = computeLanes(plan);
  const partial = forecast({ plan, lanes, routing, harness, snapshot: { planType: 'plus', updatedAt: new Date().toISOString(), windows: [{ id: 'secondary', usedPercent: 30, windowMinutes: 10080 }] } });
  assert.deepEqual(partial.usage.map((u) => [u.id, u.fromReading, u.startPct]), [['primary', false, 0], ['secondary', true, 30]]);
  const merged = mergeSnapshots({ source: 'app-server', updatedAt: 't0', planType: 'plus', windows: [{ id: 'primary', usedPercent: 10, windowMinutes: 300 }, { id: 'secondary', usedPercent: 5, windowMinutes: 10080 }], resetCredits: { availableCount: 1 } }, { updatedAt: 't1', windows: [{ id: 'primary', usedPercent: 12 }] });
  assert.deepEqual(merged.windows.map((w) => [w.id, w.usedPercent, w.windowMinutes]), [['primary', 12, 300], ['secondary', 5, 10080]]);
  assert.deepEqual([merged.planType, merged.resetCredits.availableCount, merged.updatedAt], ['plus', 1, 't1']);
  // 6. malformed windows are refused instead of producing NaN
  assert.throws(() => simulate({ waves: [], windows: [{ id: 'primary', capacityCredits: 0, windowMinutes: 300, stopLine: 85 }] }), /capacityCredits/);
  assert.throws(() => simulate({ waves: [], windows: [{ id: 'primary', capacityCredits: 10, stopLine: 85 }] }), /windowMinutes/);
  // 7. a reading whose reset lies beyond the nominal window length is believed
  const late = simulate({ waves: [{ wave: 1, lanes: [{ id: 'a', credits: 60, minutes: 120 }] }], windows: [{ id: 'primary', capacityCredits: 100, windowMinutes: 300, usedPercent: 50, resetInMinutes: 400, stopLine: 85 }] });
  assert.equal(late.waitMinutes, 400 - 70, '35 credits fit before the line at minute 70; the rest waits for the reset at 400');
  // 8. a weekly window is gated by the weekly lines wherever it sits
  assert.deepEqual(stopLinesFor({ id: 'primary', windowMinutes: 10080 }, routing), routing.budget.weekly);
  assert.equal(levelFor({ windows: [{ id: 'primary', usedPercent: 70, windowMinutes: 10080 }] }, routing), 'normal', 'Pro at 70% of the week is not tight');
  assert.equal(levelFor({ windows: [{ id: 'primary', usedPercent: 81, windowMinutes: 10080 }] }, routing), 'tight');
});

test('live evidence: pooled readings give the Business weekly capacity, stale readings are not resets, the runs price as published', async () => {
  const { accountTimeline, capacitySamples, summarize } = await import('../lib/calibration.mjs');
  // 1. interleaved readings of two threads: the percent dips (5 → 4 → 5) without a reset; credits are pooled over both threads
  const t = (at, u, credits, resetsAt = 7 * 24 * 3600 * 1000) => ({ at, windows: { primary: { usedPercent: u, resetsAt } }, credits });
  const dip = capacitySamples([t(0, 5, 0), t(1, 5, 10), t(2, 4, 20), t(3, 5, 30), t(4, 6, 40), t(5, 7, 50)]);
  assert.deepEqual(dip.samples.map((x) => [x.dU, x.dC]), [[1, 40], [1, 10]], 'the dip neither counts as a reset nor as movement; its credits are carried');
  assert.ok(!dip.skipped.some((x) => /reset/.test(x)));
  // a reset is a reset time that moved while the window was in use, or a reset time that passed
  const moved = capacitySamples([t(0, 5, 0), t(1, 6, 10), t(2, 1, 20, 14 * 24 * 3600 * 1000), t(3, 2, 30, 14 * 24 * 3600 * 1000)]);
  assert.deepEqual(moved.samples.map((x) => [x.dU, x.dC]), [[1, 10], [1, 10]]);
  assert.ok(moved.skipped.some((x) => /reset in between/.test(x)));
  // an unused window's reset time slides with the clock: not a reset
  const slide = capacitySamples([t(0, 0, 0, 1000), t(1, 0, 5, 1001), t(2, 1, 10, 1002)]);
  assert.deepEqual(slide.samples.map((x) => [x.dU, x.dC]), [[1, 10]]);
  // 2. a thread whose cumulative total falls opens a new stream instead of counting the drop
  const r = (at, threadId, model, input, cached, output, u) => ({ at, threadId, model, rateLimits: { planType: 'pro', primary: { used_percent: u, window_minutes: 10080, resets_at: 1800000000 }, secondary: null }, total: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } });
  const tl = accountTimeline(
    [r('2026-10-20T10:00:00Z', 'a', 'gpt-6.1-sol', 1e6, 0, 0, 10), r('2026-10-20T10:01:00Z', 'b', 'gpt-6.1-sol', 2e6, 2e6, 0, 10), r('2026-10-20T10:02:00Z', 'a', 'gpt-6.1-sol', 1e5, 0, 0, 10), r('2026-10-20T10:03:00Z', 'a', 'gpt-6.1-sol', 2e6, 0, 0, 11), r('2026-10-20T10:04:00Z', 'c', 'nonesuch', 5e6, 0, 0, 11)],
    harness,
    { planType: 'pro' },
  );
  assert.deepEqual(tl.readings.map((x) => Math.round(x.credits * 100) / 100), [50, 55, 60, 110, 110], 'a: 50; b: 5 (cached); a side stream at 0.1M → 5; a continues its 1M stream to 2M → +50; the unpriced model adds nothing');
  assert.deepEqual([tl.threads, tl.streams, tl.unpricedModels], [3, 4, ['nonesuch']]);
  assert.equal(summarize({ samples: capacitySamples(tl.readings).samples }).windowCapacityCredits.primary, 6000, 'the 60 credits spent between the first reading (10%) and the first at 11% moved the window one point');
  // 3. the live evidence: the Business account's weekly window moves ≈ 62 credits per point, consistently over two windows
  const live = join(CODEX_MATH_ROOT, 'evidence', 'live');
  if (existsSync(join(live, 'readings.json'))) {
    const readings = JSON.parse(readFileSync(join(live, 'readings.json'), 'utf8')).readings;
    const timeline = accountTimeline(readings, harness, { planType: 'self_serve_business_prolite' });
    assert.deepEqual(timeline.windowMinutes, [10080]);
    const cap = capacitySamples(timeline.readings, { slug: 'rollouts' });
    const s = summarize({ samples: cap.samples });
    assert.equal(s.nCapacity.primary, 29);
    assert.ok(s.windowCapacityCredits.primary > 5800 && s.windowCapacityCredits.primary < 6600, `Q̂ ≈ 6 176 (got ${s.windowCapacityCredits.primary})`);
    const perDay = {};
    for (const x of cap.samples) {
      const d = (perDay[x.at.slice(0, 10)] = perDay[x.at.slice(0, 10)] ?? { dU: 0, dC: 0 });
      d.dU += x.dU;
      d.dC += x.dC;
    }
    for (const [day, d] of Object.entries(perDay)) assert.ok(Math.abs((100 * d.dC) / d.dU / s.windowCapacityCredits.primary - 1) < 0.1, `${day} within 10% of the pooled estimate`);
    assert.equal(windowCapacity(routing, harness, 'primary', 'self_serve_business_prolite').credits, Math.round(s.windowCapacityCredits.primary / 100) * 100, 'the routing prior is the measurement, rounded');
  }
  // 4. the nine runs: turn.completed usage priced at the published rates is what RESULTS.md tabulates
  const runs = join(live, 'runs');
  if (existsSync(runs)) {
    // [label, metering, credits]: Fast is 2.5× on the included meter; Astra is weighted 0.5 there and unweighted on purchased credits
    const expected = [['01-luna-low-mid', 'included', 0.078714], ['03-sol61-medium-mid', 'included', 1.45974], ['07-sol61-medium-fast', 'included', 1.761575], ['08-astra-high-mid', 'credits', 4.42815], ['08-astra-high-mid', 'included', 2.214075]];
    for (const [label, metering, credits] of expected) {
      const meta = JSON.parse(readFileSync(join(runs, label, 'meta.json'), 'utf8'));
      const u = meta.turnCompleted.usage;
      const rated = creditsForTokens(harness, { model: meta.model, speed: meta.speed, inputTokens: u.input_tokens, cachedInputTokens: u.cached_input_tokens, outputTokens: u.output_tokens }, metering);
      assert.ok(Math.abs(rated - credits) < 1e-9, `${label} (${metering}): ${rated} credits`);
    }
  }
});
