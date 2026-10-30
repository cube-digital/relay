import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { levelFor as codexLevelFor } from '../codex-math/lib/budget.mjs';
import { loadCodexRouting } from '../codex-math/lib/harness.mjs';
import { fromRolloutJsonl, isStale as codexStale, describe as describeCodex } from '../codex-math/lib/windows.mjs';

export function relayHome() {
  return process.env.RELAY_HOME || join(homedir(), '.relay');
}

export function snapshotPath(harness = 'claude') {
  return harness === 'codex' ? join(relayHome(), 'codex', 'budget.json') : join(relayHome(), 'budget.json');
}

// windows: { fiveHour?: { percentUsed }, sevenDay?: { percentUsed } }
// Codex: a snapshot { windows: [{ id, usedPercent, windowMinutes }], reached? }, judged by the
// codex-routing lines (`budget` is ignored for it).
export function levelFor(windows, budget, codexRouting) {
  if (windows?.windows || windows?.reached) return codexLevelFor(windows, codexRouting ?? loadCodexRouting());
  const five = windows?.fiveHour?.percentUsed;
  const seven = windows?.sevenDay?.percentUsed;
  if (five === undefined && seven === undefined) return 'unknown';
  const p5 = five ?? 0;
  const p7 = seven ?? 0;
  if (p5 >= budget.fiveHour.critical || p7 >= budget.sevenDay.critical) return 'critical';
  if (p5 >= budget.fiveHour.tight || p7 >= budget.sevenDay.tight) return 'tight';
  return 'normal';
}

export function readSnapshot(path = snapshotPath()) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

export function writeSnapshot(snapshot, path = snapshotPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try { writeFileSync(temp, JSON.stringify(snapshot, null, 2) + '\n'); renameSync(temp,path); } finally { rmSync(temp,{force:true}); }
}

export function isStale(snapshot, staleAfterMinutes, now = Date.now()) {
  if (snapshot?.windows) return !Array.isArray(snapshot.windows) || snapshot.windows.some(w => !Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100 || w.resetsAt !== undefined && !Number.isFinite(Date.parse(w.resetsAt))) || codexStale(snapshot, staleAfterMinutes, now);
  if (!snapshot?.updatedAt) return true;
  const age = now - Date.parse(snapshot.updatedAt);
  if (Number.isNaN(age) || age > staleAfterMinutes * 60_000) return true;
  // A window that already reset says nothing about the new one.
  for (const w of [snapshot.fiveHour, snapshot.sevenDay]) {
    if (w?.resetsAt && Date.parse(w.resetsAt) < now) return true;
  }
  return false;
}

export function describeWindows(windows) {
  if (windows?.windows) return describeCodex(windows);
  const part = (label, w) => {
    if (!w) return undefined;
    const reset = w.resetsAt ? ` (resets ${new Date(w.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : '';
    return `${label} ${w.percentUsed}%${reset}`;
  };
  return [part('5h', windows.fiveHour), part('7d', windows.sevenDay)].filter(Boolean).join(', ') || 'no reading';
}

// Best-effort, unofficial: newest Codex rollout file's last rate_limits payload.
// Field names follow community tooling and may change between Codex releases.
export function parseCodexRateLimits(jsonlText) {
  const lines = jsonlText.trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('rate_limits')) continue;
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const rl = row?.payload?.rate_limits ?? row?.rate_limits ?? row?.msg?.rate_limits;
    if (!rl) continue;
    const toWindow = (w) => {
      if (!w || typeof w.used_percent !== 'number') return undefined;
      let resetsAt;
      if (typeof w.resets_at === 'number') resetsAt = new Date(w.resets_at * 1000).toISOString();
      else if (typeof w.resets_in_seconds === 'number' && row.timestamp) {
        resetsAt = new Date(Date.parse(row.timestamp) + w.resets_in_seconds * 1000).toISOString();
      }
      return { percentUsed: Math.round(w.used_percent * 10) / 10, resetsAt };
    };
    return {
      fiveHour: toWindow([rl.primary, rl.secondary].find(w => w && (w.window_minutes === 300 || w.window_minutes === undefined && w === rl.primary))),
      sevenDay: toWindow([rl.primary, rl.secondary].find(w => w && (w.window_minutes >= 10080 || w.window_minutes === undefined && w === rl.secondary))),
      updatedAt: row.timestamp ?? new Date().toISOString(),
    };
  }
  return undefined;
}

export function parseCodexSnapshot(text) { return fromRolloutJsonl(text); }
