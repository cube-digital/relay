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

// The usable context window: the remote catalog's size when one was observed (it overrides the
// binary's static catalog; gpt-6.1-sol grew to 500k tokens on 2026-10-14), else the static one.
export function effectiveContextWindow(harness, slug) {
  const m = modelInfo(harness, slug);
  if (!m) return undefined;
  return Math.floor(((m.observedContextWindow ?? m.contextWindow) * m.effectiveContextWindowPercent) / 100);
}

// Where auto-compaction triggers by default: 90% of the context window (decompiled; the catalog's
// auto_compact_token_limit is null for every model), unless the user sets model_auto_compact_token_limit.
export function autoCompactTokenLimit(harness, slug, userLimit) {
  const m = modelInfo(harness, slug);
  if (!m) return undefined;
  const contextLimit = Math.floor(((m.observedContextWindow ?? m.contextWindow) * 9) / 10);
  const catalogLimit = m.autoCompactTokenLimit;
  const modelLimit = typeof catalogLimit === 'number' ? Math.min(catalogLimit, contextLimit) : contextLimit;
  return typeof userLimit === 'number' ? userLimit : modelLimit;
}

// Child threads a session may run at once: [agents].max_concurrent_threads_per_session when set
// (it counts children), else the compiled default of 4 total threads including the root.
export function maxConcurrentChildren(harness, agentsConfig = {}) {
  const n = agentsConfig.max_concurrent_threads_per_session ?? agentsConfig.max_threads;
  if (typeof n === 'number' && n >= 0) return n;
  return (harness.multiAgent?.concurrencyDefault?.totalThreads ?? 4) - 1;
}
