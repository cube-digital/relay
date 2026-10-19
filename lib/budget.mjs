import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function relayHome() {
  return process.env.RELAY_HOME || join(homedir(), '.relay');
}

export function snapshotPath() {
  return join(relayHome(), 'budget.json');
}

// windows: { fiveHour?: { percentUsed }, sevenDay?: { percentUsed } }
export function levelFor(windows, budget) {
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
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n');
}

export function isStale(snapshot, staleAfterMinutes, now = Date.now()) {
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
      fiveHour: toWindow(rl.primary),
      sevenDay: toWindow(rl.secondary),
      updatedAt: row.timestamp ?? new Date().toISOString(),
    };
  }
  return undefined;
}
