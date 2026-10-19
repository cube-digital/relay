// Pure helpers for `relay marathon`: classify a leg's outcome, parse reset times,
// decide what to do next. No process spawning here, so tests can cover it.

const LIMIT_RE = /hit your (session|weekly|opus|sonnet|fable) limit/i;
const LEG_RE = /RELAY_LEG:\s*(DONE|PAUSED|BLOCKED)\b\s*[—:-]?\s*(.*)$/im;

// "resets 3:45pm", "resets 3pm", "resets Mon 12:00am" → ISO time of the next such moment.
export function parseResetTime(text, now = new Date()) {
  const m = /resets?\s+(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text ?? '');
  if (!m) return undefined;
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  let hour = Number(m[2]) % 12;
  if (m[4].toLowerCase() === 'pm') hour += 12;
  const minute = Number(m[3] ?? 0);
  const t = new Date(now);
  t.setSeconds(0, 0);
  t.setHours(hour, minute);
  if (m[1]) {
    const want = days.indexOf(m[1].toLowerCase());
    let delta = (want - t.getDay() + 7) % 7;
    if (delta === 0 && t <= now) delta = 7;
    t.setDate(t.getDate() + delta);
  } else if (t <= now) {
    t.setDate(t.getDate() + 1);
  }
  return t.toISOString();
}

export function parseLegMarker(text) {
  const m = LEG_RE.exec(text ?? '');
  return m ? { status: m[1].toUpperCase(), reason: m[2].trim() } : undefined;
}

// Outcome of one leg from the claude -p JSON result, the ledger growth and the budget snapshot.
export function classifyLeg({ result, ledgerGrew, planComplete, budget, now = new Date() }) {
  const text = [result?.result, result?.error, result?.message].filter(Boolean).join('\n');
  if (planComplete) return { kind: 'done', reason: 'plan complete (ledger)' };
  const marker = parseLegMarker(text);
  if (marker?.status === 'DONE') return { kind: 'done', reason: marker.reason || 'conductor reported DONE' };
  if (marker?.status === 'BLOCKED') return { kind: 'blocked', reason: marker.reason || 'conductor reported BLOCKED' };
  if (LIMIT_RE.test(text)) {
    const which = LIMIT_RE.exec(text)[1].toLowerCase();
    const fromText = parseResetTime(text, now);
    const fromBudget = which === 'weekly' ? budget?.sevenDay?.resetsAt : budget?.fiveHour?.resetsAt;
    return { kind: 'limit', which, resetsAt: pickReset(fromBudget, fromText, now), reason: `usage limit (${which})` };
  }
  if (marker?.status === 'PAUSED' || budget?.level === 'critical') {
    const resetsAt = pickReset(budget?.fiveHour?.resetsAt, undefined, now) ?? pickReset(budget?.sevenDay?.resetsAt, undefined, now);
    return { kind: 'paused', resetsAt, reason: marker?.reason || `budget ${budget?.level ?? 'unknown'}` };
  }
  if (result?.is_error) return { kind: 'error', reason: (text || 'claude exited with an error').slice(0, 300) };
  if (ledgerGrew) return { kind: 'progress', reason: 'leg ended with progress; continuing' };
  return { kind: 'stalled', reason: 'leg ended without progress or a RELAY_LEG marker' };
}

function pickReset(a, b, now) {
  const future = (iso) => iso && Date.parse(iso) > now.getTime() ? iso : undefined;
  return future(a) ?? future(b);
}

// What the loop does after a leg. Returns { action: 'continue' | 'wait' | 'stop', until?, reason }.
export function decideNext({ outcome, now = new Date(), deadline, legsRun, maxLegs, stalledStreak }) {
  const past = (iso) => Date.parse(iso) > deadline.getTime();
  if (outcome.kind === 'done') return { action: 'stop', reason: 'plan complete' };
  if (outcome.kind === 'blocked') return { action: 'stop', reason: `blocked: ${outcome.reason}` };
  if (legsRun >= maxLegs) return { action: 'stop', reason: `reached --max-legs ${maxLegs}` };
  if (outcome.kind === 'stalled' && stalledStreak >= 2) return { action: 'stop', reason: 'two legs in a row made no progress' };
  if (outcome.kind === 'error' && stalledStreak >= 2) return { action: 'stop', reason: `repeated errors: ${outcome.reason}` };
  if (outcome.kind === 'limit' || outcome.kind === 'paused') {
    const until = outcome.resetsAt ?? new Date(now.getTime() + 30 * 60_000).toISOString();
    if (past(until)) return { action: 'stop', reason: `next window opens ${until}, after the deadline` };
    return { action: 'wait', until, reason: outcome.reason };
  }
  if (now >= deadline) return { action: 'stop', reason: 'deadline reached' };
  return { action: 'continue', reason: outcome.reason };
}

export function legPrompt({ planPath, leg, deadline, slug }) {
  return [
    `Use the relay run-lanes skill to continue the plan at ${planPath}.`,
    `This is leg ${leg} of an unattended marathon run (deadline ${deadline}); nobody can answer questions, so rule and continue.`,
    `Start by reading \`relay ledger ${planPath}\`: lanes and waves marked complete are done, never redo them.`,
    `Run \`relay budget\` before each wave. At critical, or after any usage-limit error: finish only in-flight lanes, merge what is clean, write the handoff, and end your turn.`,
    `When the plan is complete: \`relay ledger ${planPath} "plan: complete (relay/${slug}/integration @ <sha>)"\` then \`relay calibrate ${planPath}\`.`,
    `End your final message with exactly one line: RELAY_LEG: DONE | PAUSED | BLOCKED — <reason>.`,
  ].join('\n');
}

export function parseClaudeJson(stdout) {
  const lines = (stdout ?? '').trim().split('\n').filter((l) => l.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(lines[i]);
      if (o && (o.type === 'result' || 'result' in o || 'is_error' in o)) return o;
    } catch {
      // keep looking
    }
  }
  return undefined;
}
