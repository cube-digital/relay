// Loads the facts extracted from the Codex binary (config/codex-harness.json) and the
// relay-on-Codex policy (config/codex-routing.json), and answers the small questions the
// rest of the math asks about the harness: which model is a tier, what a window is for a
// plan, what the effective context window is.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CODEX_MATH_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TIERS = ['cheap', 'mid', 'strong'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const SPEEDS = ['standard', 'fast', 'ultrafast'];

export function loadHarness(root = CODEX_MATH_ROOT) {
  return JSON.parse(readFileSync(join(root, 'config', 'codex-harness.json'), 'utf8'));
}

export function loadCodexRouting(root = CODEX_MATH_ROOT) {
  return JSON.parse(readFileSync(join(root, 'config', 'codex-routing.json'), 'utf8'));
}

export function tierRank(tier) {
  const i = TIERS.indexOf(tier);
  if (i === -1) throw new Error(`unknown tier "${tier}" (expected ${TIERS.join(', ')})`);
  return i;
}

export function effortRank(effort) {
  const i = EFFORTS.indexOf(effort);
  if (i === -1) throw new Error(`unknown reasoning effort "${effort}" (expected ${EFFORTS.join(', ')})`);
  return i;
}

export function modelInfo(harness, slug) {
  return harness.models.find((m) => m.slug === slug);
}

// Classify a Codex model slug into a tier, for budget caps on spawns that name a model.
export function tierOfCodexModel(routing, model) {
  if (!model) return undefined;
  const m = String(model).toLowerCase();
  for (const tier of TIERS) if (routing.tiers[tier].model.toLowerCase() === m) return tier;
  if (m.includes('astra')) return 'strong';
  if (m.includes('sol')) return 'mid';
  if (m.includes('luna')) return 'cheap';
  return undefined;
}

// The windows an account meters, by plan type. Readings always win over this table.
export function windowsForPlan(harness, planType) {
  const table = harness.rateLimits.windowsByPlan;
  const key = planType && table[planType] ? planType : 'unknown';
  return table[key].map((w) => ({ id: w.id, windowMinutes: w.minutes }));
}

export function effectiveContextWindow(harness, slug) {
  const m = modelInfo(harness, slug);
  if (!m) return undefined;
  return Math.floor((m.contextWindow * m.effectiveContextWindowPercent) / 100);
}
