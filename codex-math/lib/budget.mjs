// Budget levels and spawn routing on the Codex harness.
//
// The level is the worst of the account's windows (primary, secondary — whatever the plan has)
// against per-window stop lines, or critical outright when the backend reports a limit reached.
// Degrading a spawn follows the order the prices dictate: speed first (Fast meters 2.5× the
// included usage for a 1.5–2× speedup), then reasoning effort (output tokens cost 5× input), then
// the model (astra : sol 6.1 : luna ≈ 100 : 14 : 1 per token at published rates and the prior token mix; 62 : 15 : 1 per relay unit on the included meter, where Astra counts half and effort scales output). Relay's Claude mod only had the
// third lever.

import { TIERS, effortRank, tierOfCodexModel } from './harness.mjs';
import { minutesToReset } from './windows.mjs';

// The stop lines of a window: a window of seven days or more takes the weekly lines whatever
// its position (on Pro the weekly window is the primary one); shorter windows take the lines
// of their position.
export function stopLinesFor(window, routing) {
  const b = routing.budget;
  if ((window.windowMinutes ?? 0) >= 7 * 1440 && b.weekly) return b.weekly;
  return b.windows[window.id] ?? b.windows.primary;
}

export function levelFor(snapshot, routing) {
  if (!snapshot?.windows?.length && !snapshot?.reached) return 'unknown';
  if (snapshot.reached && routing.budget.creditsExhaustedIsCritical !== false) return 'critical';
  let level = 'normal';
  for (const w of snapshot.windows ?? []) {
    const lines = stopLinesFor(w, routing);
    if (w.usedPercent >= lines.critical) return 'critical';
    if (w.usedPercent >= lines.tight) level = 'tight';
  }
  return level;
}

// Which window sets the level, and how long until it resets.
export function bindingWindow(snapshot, routing, now = Date.now()) {
  let worst;
  for (const w of snapshot?.windows ?? []) {
    const lines = stopLinesFor(w, routing);
    const margin = lines.critical - w.usedPercent;
    if (!worst || margin < worst.margin) worst = { id: w.id, usedPercent: w.usedPercent, margin, resetInMinutes: minutesToReset(w, now), critical: lines.critical, tight: lines.tight };
  }
  return worst;
}

function roleOf(subagentType, routing) {
  const name = String(subagentType ?? '').replace(/^relay:/, '').replace(/^relay-/, '');
  return name in routing.roles ? name : undefined;
}

// The spawn relay should make, given the budget level. `spawn` is what the plan asked for:
// { subagentType, model?, effort?, speed? }. Returns the routed parameters, every change made,
// and `deny` with a message when no new spawn of that role may start.
export function routeSpawn(spawn, level, routing, harness) {
  const role = roleOf(spawn.subagentType, routing);
  const roleTier = role ? routing.roles[role] : undefined;
  const modelTier = tierOfCodexModel(routing, spawn.model);
  const tier = modelTier ?? roleTier ?? routing.defaultSubagentTier ?? 'mid';
  const base = routing.tiers[tier];
  let model = spawn.model ?? base.model;
  let effort = spawn.effort ?? base.effort;
  let speed = spawn.speed ?? base.speed ?? 'standard';
  const changes = [];
  const cap = level === 'tight' || level === 'critical' ? routing.budget[level] : undefined;
  if (cap) {
    const exempt = role !== undefined && cap.exempt.includes(role);
    if (level === 'critical' && role && cap.denyNewSpawns?.includes(role)) {
      return { role, tier, model, effort, speed, changes, deny: `relay: usage budget is critical. Finish the current wave, commit, and write a handoff (relay:handoff). Start no new ${role} until a window resets.` };
    }
    if (!exempt) {
      for (const lever of routing.budget.degradeOrder ?? ['speed', 'effort', 'model']) {
        if (lever === 'speed' && cap.speedTo && speed !== cap.speedTo && speed !== 'standard') {
          changes.push(`speed ${speed} → ${cap.speedTo}`);
          speed = cap.speedTo;
        }
        if (lever === 'effort' && cap.effortCap && effortRank(effort) > effortRank(cap.effortCap)) {
          changes.push(`effort ${effort} → ${cap.effortCap}`);
          effort = cap.effortCap;
        }
        if (lever === 'model' && cap.capStrongTo && tierOfCodexModel(routing, model) === 'strong') {
          const to = routing.tiers[cap.capStrongTo];
          changes.push(`model ${model} → ${to.model}`);
          model = to.model;
          if (effortRank(effort) > effortRank(to.effort)) {
            changes.push(`effort ${effort} → ${to.effort}`);
            effort = to.effort;
          }
        }
      }
    }
  }
  // a model that does not advertise the effort falls back to its default (the harness validates spawn efforts)
  const info = harness?.models?.find((m) => m.slug === model);
  if (info && !info.reasoningEfforts.includes(effort)) {
    changes.push(`effort ${effort} → ${info.defaultReasoningEffort} (not advertised by ${model})`);
    effort = info.defaultReasoningEffort;
  }
  return { role, tier, model, effort, speed, changes };
}

// Whether to spend a reset credit now: the binding window is at its stop line, a credit is
// available, and the wait would be at least the policy's minimum.
export function resetAdvice(snapshot, routing, now = Date.now()) {
  const policy = routing.budget.resetCredit ?? {};
  const available = (snapshot?.resetCredits?.availableCount ?? 0) - (policy.keepAtLeast ?? 0);
  const w = bindingWindow(snapshot, routing, now);
  if (!w) return { consume: false, reason: 'no reading' };
  if (w.margin > 0) return { consume: false, reason: `${w.id} window at ${w.usedPercent}%, below the ${w.critical}% stop line` };
  const wait = w.resetInMinutes;
  if (wait === undefined) return { consume: false, reason: 'no reset time in the reading' };
  if (available <= 0) return { consume: false, reason: `no reset credit available; the ${w.id} window resets in ${Math.round(wait)} min`, waitMinutes: wait, purchasable: ['plus', 'pro', 'prolite', 'promax'].includes(snapshot?.planType) };
  if (wait < (policy.consumeWhenWaitMinutesAtLeast ?? Infinity)) return { consume: false, reason: `the ${w.id} window resets in ${Math.round(wait)} min, under the ${policy.consumeWhenWaitMinutesAtLeast} min threshold`, waitMinutes: wait };
  return { consume: true, reason: `the ${w.id} window is at its stop line and resets in ${Math.round(wait)} min; a reset credit restores every window now`, waitMinutes: wait, method: 'account/rateLimitResetCredit/consume { idempotencyKey }' };
}

// The line relay adds to the prompt when the level changes.
export function describeLevel(level, snapshot) {
  const where = snapshot?.windows?.map((w) => `${w.id} ${w.usedPercent}%`).join(', ') || 'no reading';
  const advice =
    level === 'normal'
      ? 'Route by plan tier.'
      : level === 'tight'
        ? 'Standard speed only; cap effort at medium; strong only for the architect; prefer cheap tiers where the plan has complete code.'
        : level === 'critical'
          ? 'Finish the current wave, commit, write a handoff; start nothing new.'
          : 'No usage reading (API-key session or no ChatGPT auth): behave as if tight.';
  return `[relay budget] ${level}: ${where}. ${advice}`;
}

export { TIERS };
