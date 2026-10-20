// The board: a traffic light for every task, lane and wave of a plan, computed
// from facts on disk, never from a model's say-so.
//
//   merged   green   the task's commit ("<id>: ...") is on the integration branch
//   done     green   the task's commit is on its lane branch, not merged yet
//   blocked  red     the lane's latest ledger line reports BLOCKED or a failing suite
//   working  yellow  the first task without a commit in a lane whose wave has started
//   queued   grey    a later task in that lane, waiting for the one before it
//   planned  grey    the lane's wave has not started
//
// A test-author's "<id>: acceptance tests" commit does not make a task done.

export const LIGHT = { planned: 'grey', queued: 'grey', working: 'yellow', done: 'green', merged: 'green', blocked: 'red' };
export const GLYPH = { planned: '○', queued: '·', working: '◐', done: '✓', merged: '✓', blocked: '✕' };
export const LABEL = { planned: 'planned', queued: 'queued in its lane', working: 'in progress', done: 'done, not merged yet', merged: 'merged', blocked: 'blocked' };

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "T3: CSV writer" → T3; "T1, T2: acceptance tests" and "T1: acceptance tests" → nothing
export function taskOfCommit(subject, ids) {
  const m = /^([^\s:,]+):\s*(.*)$/.exec(subject.trim());
  if (!m || !ids.has(m[1])) return undefined;
  if (/^acceptance tests\b/i.test(m[2])) return undefined;
  return m[1];
}

function ledgerEntries(text) {
  return (text ?? '')
    .split('\n')
    .map((l) => /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?: \[[^\]]*\])? (.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ at: m[1], text: m[2].trim() }));
}

// facts: { ledgerText, integrationSubjects: string[], laneSubjects: { [laneId]: string[] },
//          activeWave?: number, marathon?: object, budget?: object, now?: Date }
export function computeBoard({ plan, lanes, planPath, facts }) {
  const ids = new Set(plan.tasks.map((t) => t.id));
  const byId = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
  const entries = ledgerEntries(facts.ledgerText);
  const started = entries.some((e) => /^start:/.test(e.text));
  const complete = entries.some((e) => /^plan: complete/.test(e.text));
  const mergedWaves = new Map(); // wave → 'pass' | 'fail', last word wins
  for (const e of entries) {
    const m = /^wave (\d+): merged\b(.*)$/.exec(e.text);
    if (m) mergedWaves.set(Number(m[1]), /suite fail/i.test(m[2]) ? 'fail' : 'pass');
  }
  const passed = [...mergedWaves].filter(([, s]) => s === 'pass').map(([w]) => w);
  const currentWave = complete ? lanes.waves.length : Math.max(facts.activeWave ?? 0, started ? Math.max(0, ...passed) + 1 : 0);
  const inInt = new Set((facts.integrationSubjects ?? []).map((s) => taskOfCommit(s, ids)).filter(Boolean));
  const rulings = entries.filter((e) => /^Ruling:/i.test(e.text)).map((e) => e.text.replace(/^Ruling:\s*/i, ''));

  const waves = lanes.waves.map((w) => {
    const laneViews = w.lanes.map((lane) => {
      const onLane = new Set((facts.laneSubjects?.[lane.id] ?? []).map((s) => taskOfCommit(s, ids)).filter(Boolean));
      const mention = new RegExp(`\\blane[- ]${escapeRe(lane.id)}(?![a-z])|\\b(?:${lane.tasks.map(escapeRe).join('|')})\\b`, 'i');
      const last = [...entries].reverse().find((e) => mention.test(e.text) && !/^Ruling:/i.test(e.text));
      const waveFailed = mergedWaves.get(w.wave) === 'fail';
      const blocked = waveFailed || Boolean(last && /\bBLOCKED\b|suite fail/i.test(last.text));
      const begun = complete || w.wave <= currentWave || Boolean(last);
      let ahead = false; // a task before this one in the lane is still open
      const tasks = lane.tasks.map((id) => {
        const t = byId[id];
        let state = 'planned';
        if (complete || inInt.has(id)) state = 'merged';
        else if (onLane.has(id)) state = 'done';
        else if (begun && ahead) state = 'queued';
        else if (blocked) state = 'blocked';
        else if (begun) state = 'working';
        if (state === 'working' || state === 'blocked') ahead = true;
        return { id, title: t.title, tier: t.tier, risk: t.risk, tests: t.tests ?? 0, files: t.files ?? [], behaviors: t.behaviors ?? [], done: t.done, state, light: LIGHT[state] };
      });
      const states = tasks.map((t) => t.state);
      const state = states.every((s) => s === 'merged')
        ? 'merged'
        : states.includes('blocked')
          ? 'blocked'
          : states.every((s) => s === 'merged' || s === 'done')
            ? 'done'
            : states.every((s) => s === 'planned' || s === 'queued')
              ? 'planned'
              : 'working';
      const fix = last && /fix round (\d+)\s*\/\s*(\d+)/i.exec(last.text);
      const note = state === 'merged' ? 'merged' : fix ? `fix round ${fix[1]}/${fix[2]}` : last ? last.text.replace(/\s+/g, ' ').slice(0, 90) : state === 'planned' ? 'waiting for its wave' : 'started';
      return { id: lane.id, wave: w.wave, risk: lane.risk, tier: lane.tier, agents: lane.segments.map((s) => s.role), state, light: LIGHT[state], note, tasks };
    });
    const waveState = mergedWaves.get(w.wave) === 'pass' || complete ? 'merged' : laneViews.some((l) => l.state === 'blocked') ? 'blocked' : laneViews.every((l) => l.state === 'planned') ? 'planned' : laneViews.every((l) => ['done', 'merged'].includes(l.state)) ? 'done' : 'working';
    return { wave: w.wave, state: waveState, light: LIGHT[waveState], lanes: laneViews };
  });

  const all = waves.flatMap((w) => w.lanes.flatMap((l) => l.tasks));
  const count = (s) => all.filter((t) => t.state === s).length;
  const totals = { tasks: all.length, planned: count('planned') + count('queued'), working: count('working'), done: count('done'), merged: count('merged'), blocked: count('blocked') };
  const status = complete ? 'complete' : totals.blocked ? 'blocked' : started || totals.working || totals.done ? 'running' : 'planned';
  return {
    slug: plan.slug,
    goal: plan.goal,
    plan: planPath,
    updatedAt: (facts.now ?? new Date()).toISOString(),
    status,
    currentWave: Math.min(currentWave, lanes.waves.length),
    waveCount: lanes.waves.length,
    totals,
    green: totals.done + totals.merged,
    waves,
    rulings,
    ledgerTail: entries.slice(-5).map((e) => `${e.at} ${e.text}`),
    marathon: facts.marathon,
    budget: facts.budget,
  };
}

const COLOR = { grey: '\x1b[90m', yellow: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m', reset: '\x1b[0m' };

export function formatBoard(b, { color = false } = {}) {
  const c = (light, s) => (color ? `${COLOR[light]}${s}${COLOR.reset}` : s);
  const out = [];
  const head = b.status === 'complete' ? 'complete' : b.status === 'planned' ? 'not started' : `${b.status}, wave ${b.currentWave} of ${b.waveCount}`;
  out.push(`${color ? COLOR.bold : ''}relay board · ${b.slug}${color ? COLOR.reset : ''} · ${b.green}/${b.totals.tasks} tasks green · ${head}`);
  for (const w of b.waves) {
    out.push(`wave ${w.wave}  ${c(w.light, `${GLYPH[w.state]} ${LABEL[w.state]}`)}`);
    for (const l of w.lanes) {
      const tasks = l.tasks.map((t) => c(t.light, `${GLYPH[t.state]} ${t.id}`) + ` ${t.title}`).join('   ');
      out.push(`  lane ${l.id.padEnd(2)} ${c(l.light, GLYPH[l.state])} ${l.note}`);
      out.push(`          ${tasks}`);
    }
  }
  if (b.rulings.length) out.push(`rulings  ${b.rulings.length} (relay ledger <plan> --rulings)`);
  out.push(`legend   ${c('grey', '○ planned')}  ${c('grey', '· queued')}  ${c('yellow', '◐ in progress')}  ${c('green', '✓ done')}  ${c('red', '✕ blocked')}`);
  return out.join('\n');
}
