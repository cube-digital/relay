// relay hq's HTTP server: 127.0.0.1 only, JSON in and out, and the static page.
// Every request passes the gate in order: Host, Origin, token (on /api/*),
// Content-Type (on POST). No CORS headers are ever sent.

import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStale, levelFor, readSnapshot } from '../budget.mjs';
import { git } from '../git.mjs';
import { loadRouting, RELAY_ROOT } from '../routing.mjs';
import { loadTeam } from '../team.mjs';
import { activityFor } from './activity.mjs';
import { deckOp, deckView } from './deck.mjs';
import { brainCounts, routineRows, ringFor, runningPlan, teamStatus, todayRows } from './home.mjs';
import { applyPreview, applyRecos, recoOp, recosView } from './recos-state.mjs';
import { brainConnectors, brainKeys, redact, verifyConnectors } from './brain.mjs';
import { listSkills, listTeam, wiring } from './catalog.mjs';
import { disableFromHq, dismissFinding, enableFromHq, previewEnable, routineAttention, routineDetail, routineEvents, routinesOverview } from './routines.mjs';
import { githubFor } from './github.mjs';
import { previewLaunch, startFromIntent } from './launch.mjs';
import { getLaunch, listLaunches, logTail, stopLaunch } from './launches.mjs';
import { applyRegistryOp, listRepos, readRegistry, updateRegistry } from './registry.mjs';
import { markMerged, planDetail, repoSummary, ridOf } from './repo.mjs';
import { onPath } from './sources.mjs';

const UI = join(dirname(fileURLToPath(import.meta.url)), 'ui');
// Every file in ui/ is served under its own name, so a new UI module cannot be
// forgotten here. Names come from the directory listing, never from the request.
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const STATIC = { '/': ['index.html', TYPES['.html']] };
for (const file of readdirSync(UI)) {
  const type = TYPES[/\.[a-z]+$/.exec(file)?.[0]];
  if (type && /^[a-z0-9-]+\.[a-z]+$/.test(file)) STATIC[`/${file}`] = [file, type];
}
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const MAX_BODY = 1 << 20;
const UNASSIGNED = '_unassigned';
const INSTANCE = '([a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9._-]*)';
const LAUNCH_ID = '(\\d{8}-\\d{6}-[0-9a-f]{4})';

const fail = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': CSP,
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

// [status, message] when the request must be refused, else undefined.
export function gate(req, port, token) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.host ?? '')) return [403, 'forbidden host'];
  const origin = req.headers.origin;
  if (origin !== undefined && !hosts.some((h) => origin === `http://${h}`)) return [403, 'forbidden origin'];
  if ((req.url ?? '/').split('?')[0].startsWith('/api/')) {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? '');
    if (!m || !timingSafeEqual(Buffer.from(m[1]), Buffer.from(token))) return [401, 'missing or wrong token'];
  }
  if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return [415, 'POST needs Content-Type: application/json'];
  return undefined;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(fail(413, 'body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(fail(400, 'body must be a JSON object'));
        resolve(body);
      } catch {
        reject(fail(400, 'body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const cleanLaunch = (l) => (l ? { ...l, ...(l.error ? { error: redact(String(l.error)) } : {}), ...(l.display ? { display: redact(String(l.display)) } : {}) } : l);

const repos = (reg) => listRepos(reg).map((r) => ({ ...r, rid: ridOf(r.path), name: basename(r.path) }));

function repoByRid(reg, rid) {
  const r = repos(reg).find((x) => x.rid === rid);
  if (!r) throw fail(404, 'unknown repository');
  return r;
}

function budgetNow() {
  const routing = loadRouting();
  const snap = readSnapshot();
  if (!snap) return null;
  const stale = isStale(snap, routing.budget.staleAfterMinutes);
  return { level: stale ? 'unknown' : levelFor(snap, routing.budget), fiveHour: snap.fiveHour?.percentUsed ?? null, sevenDay: snap.sevenDay?.percentUsed ?? null, resetsAt: snap.fiveHour?.resetsAt ?? null, stale };
}

const RANK = { grey: 0, green: 1, yellow: 2, red: 3 };
function worstOf(summaries) {
  let worst = 'grey';
  const bump = (l) => (RANK[l] > RANK[worst] ? (worst = l) : worst);
  for (const s of summaries) {
    if (s.missing || s.error || s.attention?.length) bump('red');
    for (const p of s.plans ?? []) bump(p.status === 'running' ? 'yellow' : p.status === 'complete' ? 'green' : p.status === 'blocked' ? 'red' : 'grey');
  }
  return worst;
}

// The roles of lanes that are working or blocked, as tiles.
function rolesWorking(board) {
  const members = new Map(loadTeam(RELAY_ROOT).map((m) => [m.name, m]));
  const names = new Set();
  for (const w of board?.waves ?? []) for (const l of w.lanes) if (l.state === 'working' || l.state === 'blocked') for (const a of l.agents ?? []) names.add(a);
  return [...names].map((role) => members.get(role)).filter(Boolean).map((m) => ({ role: m.name, title: m.title, avatar: m.avatar, hex: m.hex }));
}

function home(reg) {
  const visible = repos(reg).filter((r) => !r.hidden);
  const summaries = visible.map((r) => repoSummary(r.path));
  const launches = listLaunches().map(cleanLaunch);
  const safe = (fn) => {
    try {
      return fn();
    } catch {
      return [];
    }
  };
  const safeObj = (fn) => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  const attention = [...summaries.flatMap((s) => s.attention ?? []), ...safe(routineAttention)].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
  const live = summaries.flatMap((s) => (s.plans ?? []).filter((p) => p.status === 'running' || p.status === 'blocked').map((p) => ({ s, p })));
  const runningPlans = live.map(({ s, p }) => {
    const rp = runningPlan(s, p, { launches });
    return { ...rp, roles: rolesWorking(p.board) };
  });
  const plans = summaries.flatMap((s) => (s.plans ?? []).filter((p) => !p.error).map((p) => ({ rid: s.rid, repoName: s.name, slug: p.slug, title: p.title, status: p.status })));
  const groups = [...reg.projects.map((p) => ({ id: p.id, name: p.name, paths: p.repos })), { id: UNASSIGNED, name: 'Unassigned', paths: visible.filter((r) => !r.project).map((r) => r.path) }];
  const projects = groups
    .map((g) => {
      const ss = summaries.filter((s) => g.paths.includes(s.path));
      const items = ss.flatMap((s) => s.attention ?? []);
      const first = runningPlans.find((rp) => ss.some((s) => s.rid === rp.rid) && rp.status === 'running');
      return {
        id: g.id,
        name: g.name,
        repos: ss.length,
        running: ss.reduce((n, s) => n + (s.plans ?? []).filter((p) => p.status === 'running').length, 0),
        worst: worstOf(ss),
        waiting: items.length,
        blocked: items.filter((i) => i.kind === 'lane-blocked').length,
        ready: items.filter((i) => i.kind === 'ready-to-merge').length,
        wave: first ? `${first.currentWave}/${first.waveCount}` : null,
      };
    })
    .filter((p) => p.id !== UNASSIGNED || p.repos > 0);
  const budget = budgetNow();
  const activity = [...activityFor(visible, { launches, limit: 100 }), ...safe(routineEvents)].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 100);
  const today = new Date().toDateString();
  const activityToday = activity.filter((e) => e.at && new Date(e.at).toDateString() === today).length;
  const routines = safe(routineRows);
  let recoList = [];
  let recosFailed = false;
  try {
    recoList = recosView().recos.filter((r) => r.state === 'open' || r.state === 'applied');
  } catch {
    recosFailed = true;
  }
  const ring = ringFor({
    projects,
    plans,
    runningPlans,
    launches,
    activityToday,
    routines: routines.length,
    attentionRoutine: safe(routineAttention).length,
    recos: recoList,
    budget,
    brain: safeObj(() => brainCounts({ home: homedir(), env: process.env, relayRoot: RELAY_ROOT })) ?? {},
  }).map((i) => (recosFailed && i.id === 'recos' ? { ...i, count: '?', detail: 'unavailable', hot: false } : i));
  return {
    user: (git(['config', 'user.name'], homedir(), { allowFail: true }) ?? '').trim() || null,
    budget,
    attention,
    running: { launches: launches.filter((l) => l.status === 'running'), plans: runningPlans },
    projects,
    repos: visible.map(({ rid, name, path, project }) => ({ rid, name, path, project: project ?? null })),
    activity,
    plans,
    today: safe(() => todayRows({ repos: visible, launches })),
    routines,
    deck: safeObj(deckView),
    ring,
  };
}

function project(reg, id) {
  const all = repos(reg);
  const p = id === UNASSIGNED ? { id, name: 'Unassigned', repos: all.filter((r) => !r.project).map((r) => r.path) } : reg.projects.find((x) => x.id === id);
  if (!p) throw fail(404, 'unknown project');
  const members = all.filter((r) => p.repos.includes(r.path));
  const launches = listLaunches().map(cleanLaunch);
  const mine = launches.filter((l) => p.repos.includes(l.repo));
  const summaries = members.map((r) => ({ ...repoSummary(r.path), hidden: Boolean(r.hidden) }));
  const shown = summaries.filter((s) => !s.hidden);
  const running = shown.flatMap((s) => (s.plans ?? []).filter((pl) => pl.status === 'running' || pl.status === 'blocked').map((pl) => {
    try {
      return { ...runningPlan(s, pl, { launches }), roles: rolesWorking(pl.board) };
    } catch {
      return null;
    }
  })).filter(Boolean);
  return {
    project: { id: p.id, name: p.name },
    projects: reg.projects.map(({ id: pid, name }) => ({ id: pid, name })),
    repos: summaries,
    attention: shown.flatMap((s) => s.attention ?? []).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))),
    running,
    launches: mine.filter((l) => l.status === 'running'),
    activity: activityFor(members, { launches: mine, limit: 100 }),
  };
}

// Every plan of every visible repository, with its project, newest activity first.
function allPlans(reg) {
  const visible = repos(reg).filter((r) => !r.hidden);
  const names = new Map(reg.projects.map((p) => [p.id, p.name]));
  const launches = listLaunches();
  const plans = [];
  for (const r of visible) {
    const s = repoSummary(r.path);
    for (const p of s.plans ?? []) {
      const live = launches.find((l) => l.status === 'running' && l.repo === r.path && l.plan === p.file);
      const { board, ...rest } = p;
      plans.push({
        ...rest,
        rid: r.rid,
        repoName: r.name,
        project: r.project ?? UNASSIGNED,
        projectName: r.project ? (names.get(r.project) ?? r.project) : 'Unassigned',
        blockedLanes: (board?.waves ?? []).flatMap((w) => w.lanes.filter((l) => l.state === 'blocked').map((l) => ({ lane: l.id, note: l.note, task: l.tasks[0]?.id ?? null }))),
        launch: live ? { id: live.id, action: live.action } : null,
      });
    }
  }
  plans.sort((a, b) => String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')));
  return { plans, projects: [...reg.projects.map(({ id, name }) => ({ id, name })), { id: UNASSIGNED, name: 'Unassigned' }] };
}

function brain(section) {
  const opts = { home: homedir(), env: process.env, relayRoot: RELAY_ROOT };
  if (section === 'connectors') return brainConnectors(opts);
  if (section === 'keys') return brainKeys(opts);
  if (section === 'skills') return listSkills(opts);
  if (section === 'team') return listTeam(opts);
  if (section === 'flows') return wiring(opts);
  throw fail(404, 'unknown Brain section');
}

const INTENT_FIELDS = ['action', 'plan', 'goal', 'skill', 'prompt', 'hours', 'harness', 'model', 'effort', 'permissionMode', 'confirmDangerous', 'confirm'];
function intentFrom(body) {
  const intent = Object.fromEntries(INTENT_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
  if (typeof body.rid === 'string') intent.repo = repos(readRegistry()).find((r) => r.rid === body.rid)?.path ?? `unregistered:${body.rid}`;
  return intent;
}

function registryOp(body) {
  return updateRegistry((reg) => {
    const repo = typeof body.rid === 'string' ? repoByRid(reg, body.rid).path : undefined;
    return { ok: true, ...applyRegistryOp(reg, { op: body.op, name: body.name, id: body.id, path: body.path, project: body.project ?? null, repo }) };
  });
}

function allowedRoots(reg) {
  const roots = [];
  for (const path of Object.keys(reg.repos)) {
    if (!existsSync(path)) continue;
    roots.push(path);
    for (const line of (git(['worktree', 'list', '--porcelain'], path, { allowFail: true }) ?? '').split('\n')) {
      if (line.startsWith('worktree ')) roots.push(line.slice('worktree '.length));
    }
  }
  return roots
    .map((r) => {
      try {
        return realpathSync(r);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

// Opens a folder, or a file in VS Code; without `code` a file is revealed, never executed.
function openPath(reg, path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw fail(400, 'path must be absolute');
  let real;
  try {
    real = realpathSync(path);
  } catch {
    throw fail(404, 'no such file or folder');
  }
  if (!allowedRoots(reg).some((r) => real === r || real.startsWith(r + sep))) throw fail(403, 'path is outside the registered repositories');
  const isDir = statSync(real).isDirectory();
  // On macOS everything is revealed (`open -R`), so a *.app folder is shown, never launched.
  const code = process.platform === 'darwin' ? undefined : onPath('code', process.env);
  let bin;
  let args;
  if (code) [bin, args] = [code, [real]];
  else if (process.platform === 'darwin') [bin, args] = ['open', ['-R', real]];
  else if (process.platform === 'win32') [bin, args] = ['explorer', isDir ? [real] : [`/select,${real}`]];
  else [bin, args] = ['xdg-open', [isDir ? real : dirname(real)]];
  spawn(bin, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  return { ok: true, with: code ? 'code' : bin };
}

function recosGet(reg) {
  const boards = repos(reg).filter((r) => !r.hidden).map((r) => repoSummary(r.path));
  const running = boards.flatMap((s) => (s.plans ?? []).filter((p) => p.status === 'running' || p.status === 'blocked'));
  return { ...recosView(), team: teamStatus(running) };
}

function recosApply(body) {
  const r = applyRecos(body);
  return { ...r, launches: r.launches.map((l) => {
    const c = cleanLaunch(l);
    return { id: c.id, action: c.action, display: c.display };
  }) };
}

const ROUTES = [
  ['GET', /^\/api\/deck$/, () => deckView()],
  ['POST', /^\/api\/deck$/, (m, body) => deckOp(body)],
  ['GET', /^\/api\/recos$/, () => recosGet(readRegistry())],
  ['POST', /^\/api\/recos$/, (m, body) => recoOp(body)],
  ['POST', /^\/api\/recos\/apply\/preview$/, (m, body) => applyPreview(body)],
  ['POST', /^\/api\/recos\/apply$/, (m, body) => recosApply(body)],
  ['GET', /^\/api\/health$/, () => ({ ok: true, pid: process.pid })],
  ['GET', /^\/api\/home$/, () => home(readRegistry())],
  ['GET', /^\/api\/projects\/([a-z0-9_-]+)$/, (m) => project(readRegistry(), m[1])],
  ['GET', /^\/api\/repos\/([0-9a-f]{10})$/, (m) => repoSummary(repoByRid(readRegistry(), m[1]).path)],
  ['GET', /^\/api\/repos\/([0-9a-f]{10})\/plans\/([a-z0-9][a-z0-9-]*)$/, (m) => planDetail(repoByRid(readRegistry(), m[1]).path, m[2])],
  ['GET', /^\/api\/repos\/([0-9a-f]{10})\/github$/, (m) => {
    const r = repoByRid(readRegistry(), m[1]);
    return githubFor(r.path, { rid: r.rid });
  }],
  ['GET', /^\/api\/plans$/, () => allPlans(readRegistry())],
  ['GET', /^\/api\/brain$/, () => brainCounts({ home: homedir(), env: process.env, relayRoot: RELAY_ROOT })],
  ['GET', /^\/api\/plans$/, () => allPlans(readRegistry())],
  ['GET', /^\/api\/brain$/, () => brainCounts({ home: homedir(), env: process.env, relayRoot: RELAY_ROOT })],
  ['GET', /^\/api\/brain\/([a-z]+)$/, (m) => brain(m[1])],
  ['POST', /^\/api\/brain\/verify$/, () => verifyConnectors({ env: process.env })],
  ['POST', /^\/api\/launches\/preview$/, (m, body) => previewLaunch(intentFrom(body))],
  ['POST', /^\/api\/launches$/, (m, body) => {
    const r = startFromIntent(intentFrom(body));
    return r?.launch ? { ...r, launch: cleanLaunch(r.launch) } : r;
  }],
  ['GET', /^\/api\/launches$/, () => ({ launches: listLaunches().map(cleanLaunch) })],
  ['GET', new RegExp(`^/api/launches/${LAUNCH_ID}$`), (m) => {
    const l = getLaunch(m[1]);
    if (!l) throw fail(404, 'unknown launch');
    return { ...cleanLaunch(l), log: redact(logTail(m[1])) };
  }],
  ['POST', new RegExp(`^/api/launches/${LAUNCH_ID}/stop$`), async (m) => {
    const r = await stopLaunch(m[1]);
    return r?.id ? cleanLaunch(r) : r;
  }],
  ['GET', /^\/api\/routines$/, () => routinesOverview()],
  ['GET', new RegExp(`^/api/routines/${INSTANCE}$`), (m) => routineDetail(m[1])],
  ['POST', /^\/api\/routines\/preview$/, (m, body) => previewEnable(body)],
  ['POST', /^\/api\/routines$/, (m, body) => enableFromHq(body)],
  ['POST', new RegExp(`^/api/routines/${INSTANCE}/run$`), (m) => {
    const r = startFromIntent({ action: 'routine', instance: m[1], confirm: true });
    return { ...r, launch: cleanLaunch(r.launch) };
  }],
  ['POST', new RegExp(`^/api/routines/${INSTANCE}/dismiss$`), (m, body) => dismissFinding(m[1], body.finding)],
  ['POST', new RegExp(`^/api/routines/${INSTANCE}/disable$`), (m) => disableFromHq(m[1])],
  ['POST', /^\/api\/registry$/, (m, body) => registryOp(body)],
  ['POST', /^\/api\/plans\/merged$/, (m, body) => {
    if (typeof body.rid !== 'string' || typeof body.slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(body.slug)) throw fail(400, 'rid and slug are required');
    return markMerged(repoByRid(readRegistry(), body.rid).path, body.slug);
  }],
  ['POST', /^\/api\/open$/, (m, body) => openPath(readRegistry(), body.path)],
];

export function createHqServer({ token }) {
  if (!/^[0-9a-f]{64}$/.test(String(token))) throw new Error('token must be 64 hex characters');
  const server = createServer(async (req, res) => {
    try {
      const denied = gate(req, server.address().port, token);
      if (denied) return send(res, denied[0], { error: denied[1] });
      const path = (req.url ?? '/').split('?')[0];
      if (req.method === 'GET' && Object.hasOwn(STATIC, path)) {
        const [file, type] = STATIC[path];
        const full = join(UI, file);
        if (!existsSync(full)) return send(res, 404, { error: 'not found' });
        return send(res, 200, readFileSync(full), type);
      }
      if (!path.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      for (const [method, re, fn] of ROUTES) {
        const m = re.exec(path);
        if (m && method === req.method) return send(res, 200, await fn(m, body));
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      const status = Number.isInteger(err.status) ? err.status : 500;
      send(res, status, { error: status === 500 ? `internal error: ${redact(String(err.message))}` : err.message, ...(err.guards ? { guards: err.guards } : {}), ...(err.refused ? { refused: err.refused } : {}) });
    }
  });
  return server;
}

// Binds 127.0.0.1 on port, else the next 10 ports; port 0 picks an ephemeral one.
export function listen(server, { port = 4747 } = {}) {
  return new Promise((resolve, reject) => {
    let p = port;
    let left = port === 0 ? 1 : 11;
    const attempt = () => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && --left > 0) {
          p += 1;
          attempt();
        } else reject(err);
      };
      server.once('error', onError);
      server.listen(p, '127.0.0.1', () => {
        server.off('error', onError);
        resolve(server.address().port);
      });
    };
    attempt();
  });
}
