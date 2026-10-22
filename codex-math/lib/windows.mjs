// Usage windows as the Codex harness reports them, in one shape whatever the source:
//
//   { source, updatedAt, planType, limitId, windows: [{ id, usedPercent, windowMinutes, resetsAt }],
//     credits: { hasCredits, unlimited, balance }, resetCredits: { availableCount }, reached, byLimitId }
//
// Sources (see config/codex-harness.json → rateLimits):
//   - app-server v2: account/rateLimits/read response or account/rateLimits/updated params (camelCase,
//     resetsAt in unix seconds, windowDurationMins);
//   - core protocol: the token_count event_msg in a rollout .jsonl (snake_case, window_minutes, resets_at);
//   - relay's own ~/.relay/budget.json (fiveHour / sevenDay) for the Claude Code mod and older Codex readers.
// A window is identified by its position (primary, secondary), not by "5h"/"7d": on Pro the
// primary window is the weekly one and there is no secondary.

const toIso = (unixSeconds) => (typeof unixSeconds === 'number' && Number.isFinite(unixSeconds) ? new Date(unixSeconds * 1000).toISOString() : undefined);

function windowFromV2(id, w) {
  if (!w || typeof w.usedPercent !== 'number') return undefined;
  return { id, usedPercent: w.usedPercent, windowMinutes: w.windowDurationMins ?? undefined, resetsAt: toIso(w.resetsAt) };
}

function snapshotFromV2(rl, extra = {}) {
  const windows = [windowFromV2('primary', rl.primary), windowFromV2('secondary', rl.secondary)].filter(Boolean);
  return {
    source: 'app-server',
    updatedAt: extra.updatedAt ?? new Date().toISOString(),
    planType: rl.planType ?? undefined,
    limitId: rl.limitId ?? undefined,
    limitName: rl.limitName ?? undefined,
    windows,
    credits: rl.credits ? { hasCredits: !!rl.credits.hasCredits, unlimited: !!rl.credits.unlimited, balance: rl.credits.balance ?? undefined } : undefined,
    reached: rl.rateLimitReachedType ?? undefined,
    spendControlReached: rl.spendControlReached ?? undefined,
  };
}

// account/rateLimits/read result, or account/rateLimits/updated params ({ rateLimits }).
export function fromAppServer(msg, { updatedAt } = {}) {
  const rl = msg?.rateLimits ?? msg;
  if (!rl || typeof rl !== 'object') return undefined;
  const snap = snapshotFromV2(rl, { updatedAt });
  if (msg.rateLimitsByLimitId && typeof msg.rateLimitsByLimitId === 'object') {
    snap.byLimitId = Object.fromEntries(Object.entries(msg.rateLimitsByLimitId).map(([k, v]) => [k, snapshotFromV2(v, { updatedAt })]));
  }
  if (msg.rateLimitResetCredits && typeof msg.rateLimitResetCredits.availableCount === 'number') {
    snap.resetCredits = { availableCount: msg.rateLimitResetCredits.availableCount, credits: msg.rateLimitResetCredits.credits ?? undefined };
  }
  if (typeof msg.ordinaryUsageAllowed === 'boolean') snap.ordinaryUsageAllowed = msg.ordinaryUsageAllowed;
  return snap;
}

function windowFromCore(id, w) {
  if (!w || typeof w.used_percent !== 'number') return undefined;
  return { id, usedPercent: w.used_percent, windowMinutes: w.window_minutes ?? undefined, resetsAt: toIso(w.resets_at) };
}

// The rate_limits object of a token_count event (rollout event_msg payload) or of a TokenCountEvent.
export function fromRolloutTokenCount(payload, timestamp) {
  const rl = payload?.rate_limits ?? payload;
  if (!rl || typeof rl !== 'object' || (!rl.primary && !rl.secondary)) return undefined;
  const windows = [windowFromCore('primary', rl.primary), windowFromCore('secondary', rl.secondary)].filter(Boolean);
  return {
    source: 'rollout',
    updatedAt: timestamp ?? new Date().toISOString(),
    planType: rl.plan_type ?? undefined,
    limitId: rl.limit_id ?? undefined,
    limitName: rl.limit_name ?? undefined,
    windows,
    credits: rl.credits ? { hasCredits: !!rl.credits.has_credits, unlimited: !!rl.credits.unlimited, balance: rl.credits.balance ?? undefined } : undefined,
    reached: rl.rate_limit_reached_type ?? undefined,
    spendControlReached: rl.spend_control_reached ?? undefined,
    contextWindow: payload?.info?.model_context_window ?? undefined,
    totalTokens: payload?.info?.total_token_usage?.total_tokens ?? undefined,
  };
}

// Newest usage reading in a rollout file: the last event_msg whose payload is a token_count with rate_limits.
export function fromRolloutJsonl(text) {
  const lines = text.trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('rate_limits')) continue;
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const payload = row?.type === 'event_msg' ? row.payload : row?.payload ?? row;
    const snap = fromRolloutTokenCount(payload, row?.timestamp);
    if (snap) return snap;
  }
  return undefined;
}

// relay's ~/.relay/budget.json: { fiveHour: { percentUsed, resetsAt }, sevenDay: { percentUsed, resetsAt }, updatedAt }
export function fromRelaySnapshot(s) {
  if (!s) return undefined;
  const windows = [];
  if (s.fiveHour && typeof s.fiveHour.percentUsed === 'number') windows.push({ id: 'primary', usedPercent: s.fiveHour.percentUsed, windowMinutes: 300, resetsAt: s.fiveHour.resetsAt });
  if (s.sevenDay && typeof s.sevenDay.percentUsed === 'number') windows.push({ id: 'secondary', usedPercent: s.sevenDay.percentUsed, windowMinutes: 10080, resetsAt: s.sevenDay.resetsAt });
  if (!windows.length) return undefined;
  return { source: s.source ?? 'relay', updatedAt: s.updatedAt ?? new Date().toISOString(), planType: s.planType, windows };
}

// Merge a sparse account/rateLimits/updated snapshot into the last full read: windows the update
// carries replace the old ones, everything the update leaves out is kept (the docs say nullable
// metadata in a rolling update does not clear an observed value).
export function mergeSnapshots(base, update) {
  if (!base) return update;
  if (!update) return base;
  const windows = new Map((base.windows ?? []).map((w) => [w.id, w]));
  for (const w of update.windows ?? []) windows.set(w.id, { ...windows.get(w.id), ...w });
  const out = { ...base };
  for (const [k, v] of Object.entries(update)) if (v !== undefined && v !== null && k !== 'windows') out[k] = v;
  out.windows = [...windows.values()];
  out.updatedAt = update.updatedAt ?? base.updatedAt;
  return out;
}

export function windowById(snapshot, id) {
  return snapshot?.windows?.find((w) => w.id === id);
}

// A reading is stale after `minutes`, or once any window it describes has already reset.
export function isStale(snapshot, minutes, now = Date.now()) {
  if (!snapshot?.updatedAt) return true;
  const age = now - Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(age) || age > minutes * 60_000) return true;
  for (const w of snapshot.windows ?? []) {
    const reset = Date.parse(w.resetsAt ?? '');
    if (Number.isFinite(reset) && reset < now) return true;
  }
  return false;
}

// Minutes until a window resets, from its reading; undefined without a reset time.
export function minutesToReset(window, now = Date.now()) {
  const t = Date.parse(window?.resetsAt ?? '');
  return Number.isFinite(t) ? Math.max(0, (t - now) / 60_000) : undefined;
}

export function describe(snapshot) {
  if (!snapshot?.windows?.length) return 'no reading';
  const label = (w) => (w.windowMinutes ? (w.windowMinutes % 1440 === 0 ? `${w.windowMinutes / 1440}d` : w.windowMinutes % 60 === 0 ? `${w.windowMinutes / 60}h` : `${w.windowMinutes}m`) : w.id);
  const parts = snapshot.windows.map((w) => `${label(w)} ${w.usedPercent}%` + (w.resetsAt ? ` resets ${w.resetsAt.slice(11, 16)}Z` : ''));
  if (snapshot.credits && !snapshot.credits.unlimited) parts.push(snapshot.credits.hasCredits ? `credits ${snapshot.credits.balance ?? 'yes'}` : 'no credits');
  if (snapshot.resetCredits?.availableCount) parts.push(`${snapshot.resetCredits.availableCount} reset credit(s)`);
  return parts.join(' · ');
}
