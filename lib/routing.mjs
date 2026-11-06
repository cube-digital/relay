import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELAY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TIERS = ['cheap', 'mid', 'strong'];

// config/routing.json holds the Claude tiers; each tier's `codex` entry is read from the single
// Codex source, codex-math/config/codex-routing.json, so callers see one routing table.
export function loadRouting(root = RELAY_ROOT) {
  const routing = JSON.parse(readFileSync(join(root, 'config', 'routing.json'), 'utf8'));
  const codexFile = join(root, 'codex-math', 'config', 'codex-routing.json');
  if (existsSync(codexFile)) {
    const codex = JSON.parse(readFileSync(codexFile, 'utf8')).tiers ?? {};
    for (const [tier, entry] of Object.entries(routing.tiers ?? {})) if (codex[tier]) entry.codex = codex[tier];
  }
  return routing;
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
