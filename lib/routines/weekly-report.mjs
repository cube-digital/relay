// The weekly-report check: a markdown report of the week (plans, tasks, rulings, launches,
// other routines) and the repeated-launch data for the suggestion step. Reads facts only.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { git } from '../git.mjs';
import { listLaunches } from '../hq/launches.mjs';
import { readRegistry } from '../hq/registry.mjs';
import { boardFor } from '../../scripts/relay-board.mjs';
import { DAYS, describeSchedule, localDate } from './schedule.mjs';
import { listInstances, listRuns } from './store.mjs';
import { loadTemplates } from './templates.mjs';

const DAY_MS = 86_400_000;
const LEDGER_RE = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: \[[^\]]*\])? (.*)$/;
const PIECE_RE = /^piece ([a-z0-9][a-z0-9-]*)(?: lane ([a-z]+))?: (pass|findings|blocked|skipped)\b(?: \(([^)]*)\))?/;
const list = (a) => (a.length ? a.join(', ') : 'none');
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const pad = (n) => String(n).padStart(2, '0');
const localStamp = (d) => `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

function ledgerFacts(path, since) {
  const f = { started: [], completed: [], rulings: [], pieces: [] };
  const runs = join(path, '.relay', 'runs');
  let slugs = [];
  try { slugs = readdirSync(runs).sort(); } catch { return f; }
  for (const slug of slugs) {
    const file = join(runs, slug, 'ledger.md');
    if (!existsSync(file)) continue;
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = LEDGER_RE.exec(line);
      if (!m) continue;
      const at = Date.parse(`${m[1]}T${m[2]}:00Z`);
      if (Number.isNaN(at) || at < since.getTime() - 60_000) continue;
      const t = m[3].trim();
      const p = PIECE_RE.exec(t);
      if (/^start:/.test(t)) f.started.push(slug);
      else if (/^plan: complete\b/.test(t)) f.completed.push(slug);
      else if (/^Ruling:/.test(t)) f.rulings.push(`${slug}: ${t}`);
      else if (p && (p[3] === 'findings' || p[3] === 'blocked')) f.pieces.push(`${slug}: ${t}`);
    }
  }
  return f;
}

function greenTasks(path, since) {
  const out = git(['log', '--branches=relay/*', `--since=${since.toISOString()}`, '--format=%s'], path, { allowFail: true });
  return new Set((out ?? '').split('\n').filter((s) => /^T\d+[a-z]?:\s/.test(s))).size;
}

function blockedLanes(path) {
  const dir = join(path, 'docs', 'relay', 'plans');
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const r = boardFor(join(dir, f));
      if (r.errors) continue;
      for (const w of r.board.waves) for (const l of w.lanes) if (l.state === 'blocked') out.push(`${r.board.slug} lane ${l.id}: ${l.note}`);
    } catch { /* an unreadable plan has no blocked lanes to report */ }
  }
  return out;
}

const launchSkill = (l) => (l.action === 'skill' ? /^Use the (\S+) skill\./.exec(l.argv?.[1] ?? '')?.[1] : undefined);
const repoName = (l) => (l.repo ? basename(l.repo) : '-');

function repeated(launches, now, { suggestWeeks = 4, suggestMinRepeats = 3 }) {
  const from = now.getTime() - suggestWeeks * 7 * DAY_MS;
  const groups = new Map();
  for (const l of launches) {
    const at = Date.parse(l.startedAt);
    if (!(at >= from)) continue;
    const skill = launchSkill(l);
    const key = `${l.action}|${skill ?? ''}|${l.repo ?? ''}`;
    const g = groups.get(key) ?? { action: l.action, skill, repo: l.repo, count: 0, slots: new Map() };
    g.count++;
    const d = new Date(at);
    const slot = `${DAYS[(d.getDay() + 6) % 7]} ${pad(d.getHours())}h`;
    g.slots.set(slot, (g.slots.get(slot) ?? 0) + 1);
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.count >= suggestMinRepeats).sort((a, b) => b.count - a.count).map((g) => {
    const slots = [...g.slots].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ×${n}`).join(', ');
    return `- ${g.action}${g.skill ? ` ${g.skill}` : ''} · ${g.repo ? basename(g.repo) : '-'} · ${g.count}× · ${slots}`;
  });
}

export async function check({ repos, options = {}, now = new Date(), instance }) {
  const days = options.days ?? 7;
  const since = new Date(now.getTime() - days * DAY_MS);
  const launches = listLaunches({ limit: 1000 });
  const lines = [`# Weekly report · ${localDate(now)}`, '', `${localDate(since)} – ${localDate(now)}`, ''];

  const reg = readRegistry();
  const order = [...reg.projects.map((p) => p.name), null];
  const groups = new Map(order.map((n) => [n, []]));
  for (const r of repos) {
    const key = r.project?.name ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const [name, members] of groups) {
    if (!members.length) continue;
    lines.push(`## ${name ?? 'Unassigned'}`, '');
    for (const r of members) {
      const f = ledgerFacts(r.path, since);
      lines.push(`### ${r.name}`, '',
        `- Plans started: ${list(f.started)}`,
        `- Plans completed: ${list(f.completed)}`,
        `- Tasks green: ${greenTasks(r.path, since)}`,
        `- Lanes blocked: ${blockedLanes(r.path).join('; ') || 'none'}`,
        `- Rulings: ${f.rulings.length ? '' : 'none'}`.trimEnd(), ...f.rulings.map((x) => `  - ${x}`),
        `- Pieces: ${f.pieces.length ? '' : 'none'}`.trimEnd(), ...f.pieces.map((x) => `  - ${x}`), '');
    }
  }

  lines.push('## Launches', '', '| When | Action | Repository | Harness | Model | Outcome |', '|---|---|---|---|---|---|');
  const week = launches.filter((l) => Date.parse(l.startedAt) >= since.getTime()).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  if (!week.length) lines.push('| none | | | | | |');
  for (const l of week) lines.push(`| ${[localStamp(new Date(l.startedAt)), l.action, repoName(l), l.harness, l.model, l.outcome ?? l.status].map(cell).join(' | ')} |`);

  lines.push('', '## Routines', '', '| Instance | Opened | Resolved |', '|---|---|---|');
  const instances = listInstances();
  for (const i of instances.filter((x) => x.id !== instance?.id)) {
    const runs = listRuns(i.id, { limit: 200 }).filter((r) => Date.parse(r.startedAt) >= since.getTime());
    const sum = (k) => runs.reduce((n, r) => n + (r[k]?.length ?? 0), 0);
    lines.push(`| ${cell(i.id)} | ${sum('new')} | ${sum('resolved')} |`);
  }

  const weeks = options.suggestWeeks ?? 4;
  const minRepeats = options.suggestMinRepeats ?? 3;
  const rep = repeated(launches, now, options);
  const data = [`Repeated launches, last ${weeks} weeks (at least ${minRepeats}):`, ...(rep.length ? rep : ['(none)']), 'Existing routines:',
    ...loadTemplates().templates.map((t) => `- template ${t.id} (${t.kind}, ${describeSchedule(t.schedule)}): ${t.title}`),
    ...instances.map((i) => `- instance ${i.id} (${i.harness}, ${describeSchedule(i.schedule)})`)].join('\n');

  return { findings: [], notes: [], report: `${lines.join('\n')}\n`, judgmentData: data };
}
