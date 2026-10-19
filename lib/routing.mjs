import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELAY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TIERS = ['cheap', 'mid', 'strong'];

export function loadRouting(root = RELAY_ROOT) {
  return JSON.parse(readFileSync(join(root, 'config', 'routing.json'), 'utf8'));
}

export function tierRank(tier) {
  const rank = TIERS.indexOf(tier);
  if (rank === -1) throw new Error(`unknown tier "${tier}" (expected ${TIERS.join(', ')})`);
  return rank;
}

export function maxTier(tiers) {
  return tiers.reduce((best, t) => (tierRank(t) > tierRank(best) ? t : best), 'cheap');
}

export function modelFor(routing, tier, harness) {
  const entry = routing.tiers?.[tier]?.[harness];
  if (!entry) throw new Error(`routing.json has no ${harness} entry for tier "${tier}"`);
  return entry;
}

// Classify a Claude model alias or id into a tier, for budget caps.
export function tierOfClaudeModel(model) {
  if (!model) return undefined;
  const m = String(model).toLowerCase();
  if (m.includes('opus') || m.includes('fable') || m === 'best') return 'strong';
  if (m.includes('sonnet')) return 'mid';
  if (m.includes('haiku')) return 'cheap';
  return undefined;
}
