// Credits: the unit the Codex backend meters in. Tokens become credits through the
// per-model rates OpenAI publishes (config/codex-harness.json → pricing), times the
// speed-tier multiplier. Relay's plan side (tier × risk weights = work units) becomes
// credits through tokensPerUnit and a token mix, both priors until calibrated.
//
// Conventions, from the harness: `input_tokens` is the whole prompt and
// `cached_input_tokens` the cached part of it; `output_tokens` includes
// `reasoning_output_tokens`. There is no cache-write charge.

import { TIERS } from './harness.mjs';

export function creditRates(harness, model) {
  const slug = harness.pricing.rateAliases?.[model] ?? model;
  const r = harness.pricing.creditsPerMillionTokens[slug];
  if (!r) throw new Error(`no credit rates for model "${model}"`);
  return r;
}

// What a published-rate credit of a model counts for on a subscription's usage windows, relative
// to gpt-6.1-sol (config/codex-harness.json → pricing.includedMeterWeight; measured on live
// windows, 1 when unmeasured). Purchased credits are charged at the published rates as they are.
export function meterWeight(harness, model, metering = 'included') {
  if (metering !== 'included') return 1;
  const slug = harness.pricing.rateAliases?.[model] ?? model;
  const w = harness.pricing.includedMeterWeight?.[slug];
  return typeof w === 'number' && w > 0 ? w : 1;
}

// Multiplier on credits for a speed tier. `included` is what a subscription's usage
// windows meter (Fast 2.5×, Ultrafast 8×); `credits` is purchased credits (2×, 6×).
export function speedMultiplier(harness, speed = 'standard', metering = 'included') {
  const s = harness.pricing.speedMultipliers[speed];
  if (!s) throw new Error(`unknown speed tier "${speed}"`);
  return s[metering];
}

// Wall-clock speedup of a speed tier on a model (Fast: 2× on astra and sol 6.1, 1.5× on sol 6 and luna).
export function speedup(harness, model, speed = 'standard') {
  const s = harness.pricing.speedMultipliers[speed];
  if (!s) throw new Error(`unknown speed tier "${speed}"`);
  if (typeof s.speedup === 'number') return s.speedup;
  if (s.speedup && typeof s.speedup === 'object') return s.speedup[model] ?? 1.5;
  return 1; // ultrafast: no number published; treated as time-neutral until measured
}

// Credits for one token breakdown (a turn, a thread, a group of account/usage/read).
export function creditsForTokens(harness, usage, metering = 'included') {
  const { model, speed = 'standard' } = usage;
  const p = creditRates(harness, model);
  const input = Math.max(0, usage.inputTokens ?? 0);
  const cached = Math.min(input, Math.max(0, usage.cachedInputTokens ?? 0));
  const output = Math.max(0, usage.outputTokens ?? 0);
  const raw = ((input - cached) * p.input + cached * p.cachedInput + output * p.output) / 1e6;
  return raw * speedMultiplier(harness, speed, metering) * meterWeight(harness, model, metering);
}

// Credits per token at a given mix of (uncached input, cached input, output) shares.
export function creditsPerToken(harness, model, mix, { speed = 'standard', effortOutputMultiplier = 1, metering = 'included' } = {}) {
  const p = creditRates(harness, model);
  const perMillion = mix.input * p.input + mix.cachedInput * p.cachedInput + mix.output * effortOutputMultiplier * p.output;
  return (perMillion / 1e6) * speedMultiplier(harness, speed, metering) * meterWeight(harness, model, metering);
}

// What a tier costs per work unit and how long it takes, with every routing choice applied.
// `overrides` can change model/effort/speed (a budget cap or a fast-lane decision).
export function tierProfile(routing, harness, tier, overrides = {}, calibration = {}) {
  if (!TIERS.includes(tier)) throw new Error(`unknown tier "${tier}"`);
  const base = routing.tiers[tier];
  const model = overrides.model ?? base.model;
  const effort = overrides.effort ?? base.effort;
  const speed = overrides.speed ?? base.speed ?? 'standard';
  const prior = routing.forecast.prior;
  const metering = routing.forecast.metering ?? 'included';
  const effortMult = prior.effortOutputMultiplier[effort] ?? 1;
  const tokensPerUnit = calibration.tokensPerUnit?.[tier] ?? prior.tokensPerUnit[tier];
  const mix = calibration.tokenMix?.[tier] ?? prior.tokenMix;
  // calibrated credits per unit (from attributed threads) win over the token model, but
  // they were measured at the tier's routed speed and effort: rescale for overrides.
  let creditsPerUnit;
  let calibratedCredits = false;
  if (calibration.creditsPerUnit?.[tier] !== undefined) {
    calibratedCredits = true;
    const measuredAt = calibration.creditsPerUnitAt?.[tier] ?? { model: base.model, effort: base.effort, speed: base.speed ?? 'standard' };
    const ratio =
      creditsPerToken(harness, model, mix, { speed, effortOutputMultiplier: effortMult, metering }) /
      creditsPerToken(harness, measuredAt.model, mix, { speed: measuredAt.speed, effortOutputMultiplier: prior.effortOutputMultiplier[measuredAt.effort] ?? 1, metering });
    creditsPerUnit = calibration.creditsPerUnit[tier] * ratio;
  } else {
    creditsPerUnit = tokensPerUnit * creditsPerToken(harness, model, mix, { speed, effortOutputMultiplier: effortMult, metering });
  }
  // calibrated minutes were measured at whatever speed the lanes ran; `calibration.minutesPerUnitSpeedup`
  // (default 1 = standard) says which, so a run calibrated on Fast is not sped up twice.
  const minutesMeasured = calibration.minutesPerUnit?.[tier] ?? calibration.minutesPerUnit ?? prior.minutesPerUnit;
  const minutesStandard = (typeof minutesMeasured === 'number' ? minutesMeasured : prior.minutesPerUnit) * (calibration.minutesPerUnit !== undefined ? calibration.minutesPerUnitSpeedup ?? 1 : 1);
  const minutesPerUnit = minutesStandard / speedup(harness, model, speed);
  return { tier, model, effort, speed, tokensPerUnit, creditsPerUnit, minutesPerUnit, calibratedCredits, calibratedTime: calibration.minutesPerUnit !== undefined };
}

// Relative price of the tiers in credits per unit: the number that decides routing on
// this harness (Claude's tiers were 1:3:7 in usage; Codex's are closer to 1:50:700).
export function tierCreditRatios(routing, harness, calibration = {}) {
  const cheap = tierProfile(routing, harness, 'cheap', {}, calibration).creditsPerUnit;
  return Object.fromEntries(TIERS.map((t) => [t, tierProfile(routing, harness, t, {}, calibration).creditsPerUnit / cheap]));
}

// Credits a window holds at 100%: calibrated, else the plan's placeholder.
export function windowCapacity(routing, harness, windowId, planType, calibration = {}) {
  const cal = calibration.windowCapacityCredits?.[windowId];
  if (typeof cal === 'number' && cal > 0) return { credits: cal, calibrated: true };
  const table = routing.forecast.prior.windowCapacityCredits;
  const plan = planType && table[planType] ? planType : 'unknown';
  const v = table[plan][windowId] ?? table.unknown[windowId] ?? table.unknown.primary;
  return { credits: v, calibrated: false };
}
