// relay HQ Recos builder: reads relay's own files (routine findings, ledgers, keys, connectors,
// skill folders, routine registrations) and turns them into recos with stable ids. Reading
// (collectRecoSources) touches disk and git; building, reconciling and ordering are pure.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { ledgerSaysMerged } from '../board.mjs';
import { git } from '../git.mjs';
import { loadRouting, RELAY_ROOT } from '../routing.mjs';
import { listInstances, listReports, readState } from '../routines/store.mjs';
import { loadTemplates } from '../routines/templates.mjs';
import { brainConnectors, brainKeys } from './brain.mjs';
import { listRepos, readRegistry } from './registry.mjs';
import { ridOf } from './repo.mjs';
import { suggestionsFrom } from './routines.mjs';
import { onPath, scanSkills } from './sources.mjs';

export const AREAS = ['repos', 'runs', 'routines', 'brain'];
export const PRIORITIES = ['high', 'mid', 'low'];

const KNOWN_MAX = 500;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const LEDGER_LINE = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: \[[^\]]*\])? (.*)$/;
const STARTED = /^start:/;
const COMPLETE = /^plan: complete\b/;
const DEFERRED = /\bdeferred minors?:\s*(.+)$/i;
const SKIPPED_PIECE = /^piece ([a-z0-9][a-z0-9-]*): skipped \(requires (.+) missing\)$/;
const LINK_KINDS = {
  'pr-stale': { title: (n) => `${n} PRs wait for review`, benefit: 'Reviews stop waiting.' },
  'pr-approved-unmerged': { title: (n) => `${n} approved PRs are not merged`, benefit: 'Approved work lands.' },
  'review-requested': { title: (n) => `${n} PRs ask for your review`, benefit: 'Reviewers stop waiting on you.' },
};
const GIT_KINDS = ['relay-branches', 'relay-worktrees', 'branch-merged-old'];

const s = (n) => (n === 1 ? '' : 's');
const keyOf = (findingId) => String(findingId).split(':').slice(2).join(':');

// ---------------------------------------------------------------- reading

// Visible repositories on disk, and the rids of visible ones missing on disk: their recos are held,
// not auto-done, until the repository comes back (a hidden or removed one is legitimately gone).
function visibleRepos(registry) {
  const visible = listRepos(registry).filter((r) => !r.hidden).map((r) => ({ path: r.path, rid: ridOf(r.path), name: basename(r.path) }));
  return { repos: visible.filter((r) => existsSync(r.path)), missing: visible.filter((r) => !existsSync(r.path)).map((r) => r.rid) };
}

// Reads that may find nothing: ENOENT is empty, any other failure throws so the source reports ok: false.
function readOrNull(fn) {
  try {
    return fn();
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

function ghSignedIn(home, env) {
  if (env.GH_TOKEN || env.GITHUB_TOKEN) return true;
  try {
    return /^\s+user:\s*\S/m.test(readFileSync(join(env.GH_CONFIG_DIR ?? join(home, '.config', 'gh'), 'hosts.yml'), 'utf8'));
  } catch {
    return false;
  }
}

// git calls that fail throw (the source is then not read); only "no common ancestor" is a plain no.
const branchList = (repo, prefix) => git(['for-each-ref', '--format=%(refname:short)', prefix], repo).split('\n').filter(Boolean);
function isMerged(repo, branch) {
  const ref = `refs/heads/${branch}`;
  if (!git(['for-each-ref', '--format=%(refname)', ref], repo).split('\n').includes(ref)) return false;
  const [tip, head] = git(['rev-parse', ref, 'HEAD'], repo).split('\n');
  return git(['merge-base', tip, head], repo, { allowFail: true }) === tip;
}

const markedMerged = (repo, slug) => {
  try {
    return ledgerSaysMerged(readFileSync(join(repo, '.relay', 'runs', slug, 'ledger.md'), 'utf8'));
  } catch {
    return false;
  }
};

// Re-checks a (kind, repo) group of pr-hygiene keys against git now; returns what is still there.
function recheck(kind, repo, keys) {
  if (kind === 'relay-branches') {
    return keys.filter((slug) => SLUG_RE.test(slug) && (markedMerged(repo, slug) || isMerged(repo, `relay/${slug}/integration`)))
      .map((slug) => ({ slug, branches: branchList(repo, `refs/heads/relay/${slug}/`) }))
      .filter((e) => e.branches.length > 0);
  }
  if (kind === 'relay-worktrees') {
    const slugs = keys.filter((k) => SLUG_RE.test(k));
    const out = [];
    let cur = null;
    for (const line of git(['worktree', 'list', '--porcelain'], repo).split('\n')) {
      if (line.startsWith('worktree ')) cur = line.slice(9);
      else if (cur && slugs.some((slug) => line.startsWith(`branch refs/heads/relay/${slug}/lane-`))) out.push(cur);
    }
    return out;
  }
  // branch-merged-old
  return keys.filter((b) => !b.startsWith('-') && isMerged(repo, b));
}

function prHygieneItems(repos) {
  const byPath = new Map(repos.map((r) => [r.path, r]));
  const findings = new Map(); // finding id → { f, at }
  for (const inst of listInstances()) {
    if (inst.routine !== 'pr-hygiene') continue;
    const { state, reset } = readState(inst.id);
    if (reset) throw new Error(`${inst.id}: state.json was damaged`);
    for (const f of state.current ?? []) {
      if (typeof f?.id !== 'string' || Object.hasOwn(state.dismissed ?? {}, f.id)) continue;
      const at = state.seen?.[f.id] ?? null;
      const prev = findings.get(f.id);
      if (!prev || String(at ?? '') > String(prev.at ?? '')) findings.set(f.id, { f, at });
    }
  }
  const groups = new Map();
  for (const { f, at } of findings.values()) {
    if (!GIT_KINDS.includes(f.kind) && !LINK_KINDS[f.kind]) continue;
    const r = byPath.get(f.repo);
    if (!r) continue;
    const gk = `${f.kind}\n${r.path}`;
    if (!groups.has(gk)) groups.set(gk, { kind: f.kind, repo: r.path, rid: r.rid, repoName: r.name, at: null, found: [] });
    const g = groups.get(gk);
    g.found.push({ key: keyOf(f.id), href: f.href ?? null });
    if (at && String(at) > String(g.at ?? '')) g.at = at;
  }
  const items = [];
  for (const g of groups.values()) {
    g.found.sort((a, b) => a.key.localeCompare(b.key));
    const entries = GIT_KINDS.includes(g.kind) ? recheck(g.kind, g.repo, g.found.map((x) => x.key)) : g.found.filter((x) => x.href);
    if (entries.length) items.push({ kind: g.kind, repo: g.repo, rid: g.rid, repoName: g.repoName, at: g.at, entries });
  }
  return items;
}

const stamp = (m) => `${m[1]}T${m[2]}:00.000Z`;

function ledgerItems(repos) {
  const items = [];
  for (const r of repos) {
    const slugs = (readOrNull(() => readdirSync(join(r.path, '.relay', 'runs'))) ?? []).filter((d) => SLUG_RE.test(d)).sort();
    for (const slug of slugs) {
      const text = readOrNull(() => readFileSync(join(r.path, '.relay', 'runs', slug, 'ledger.md'), 'utf8'));
      if (text === null) continue;
      const lines = text.split('\n').map((l) => LEDGER_LINE.exec(l)).filter(Boolean).map((m) => ({ at: stamp(m), text: m[3].trim() }));
      const completeAt = lines.filter((l) => COMPLETE.test(l.text)).pop()?.at ?? null;
      const minors = completeAt ? lines.map((l) => DEFERRED.exec(l.text)?.[1]?.trim().slice(0, 200)).filter(Boolean) : [];
      // Skipped pieces come from every ledger, finished or not (spec 6.1 lists them apart from complete plans).
      let start = -1;
      lines.forEach((l, i) => { if (STARTED.test(l.text)) start = i; });
      const skipped = new Map();
      for (const l of lines.slice(start + 1)) {
        const m = SKIPPED_PIECE.exec(l.text);
        if (m) skipped.set(m[1], { piece: m[1], path: m[2], at: l.at });
      }
      if (minors.length || skipped.size) items.push({ rid: r.rid, repo: r.path, repoName: r.name, slug, completeAt, minors, skipped: [...skipped.values()] });
    }
  }
  return items;
}

function weeklyItems() {
  const have = new Set(loadTemplates().templates.map((t) => t.id));
  const out = new Map();
  for (const inst of listInstances()) {
    if (inst.routine !== 'weekly-report') continue;
    const report = listReports(inst.id, { limit: 1 })[0];
    if (!report) continue;
    for (const sug of suggestionsFrom(readFileSync(report.path, 'utf8'))) {
      if (!have.has(sug.id) && !out.has(sug.id)) out.set(sug.id, { ...sug, reportAt: `${report.date}T00:00:00.000Z` });
    }
  }
  return [...out.values()];
}

// [{ name, ok, error?, items }]: disk and git only, never gh or the network.
export function collectRecoSources({ home = homedir(), env = process.env, relayRoot = RELAY_ROOT, registry = readRegistry(), now = new Date() } = {}) {
  let repos;
  const reposNow = () => (repos ??= visibleRepos(registry));
  // held: id prefixes this read could not see (a visible repository missing on disk); reconcile leaves them alone.
  const read = (name, fn, held = () => []) => {
    try {
      return { name, ok: true, items: fn(), held: held() };
    } catch (err) {
      return { name, ok: false, error: err.message, items: [] };
    }
  };
  // A broken link counts only when its folder really sits inside the skills root, so rm never reaches outside it.
  const inside = (b) => {
    const root = realpathSync(b.root);
    const dir = realpathSync(dirname(b.path));
    return dir === root || dir.startsWith(root + sep);
  };
  return [
    { name: 'bins', ok: true, items: { git: onPath('git', env) ?? null, rm: onPath('rm', env) ?? null, node: process.execPath, relay: join(relayRoot, 'bin', 'relay') } },
    read('gh', () => ({ installed: Boolean(onPath('gh', env)), signedIn: ghSignedIn(home, env) })),
    read('keys', () => brainKeys({ home, env, relayRoot }).keys.filter((k) => k.status === 'missing' || k.status === 'in-file')),
    read('connectors', () => brainConnectors({ home, env, relayRoot }).connectors.filter((c) => c.status === 'needs-auth')),
    read('skill-links', () => scanSkills({ home, relayRoot }).broken.filter(inside)),
    read('routine-paths', () => listInstances()
      .filter((i) => i.registration?.state !== 'disabled' && !existsSync(i.relayCli))
      .map((i) => ({ id: i.id, harness: i.harness }))),
    read('pr-hygiene', () => prHygieneItems(reposNow().repos), () => reposNow().missing.map((rid) => `repos:${rid}:`)),
    read('ledgers', () => ledgerItems(reposNow().repos), () => reposNow().missing.map((rid) => `runs:${rid}:`)),
    read('weekly-report', () => weeklyItems()),
  ];
}

// ---------------------------------------------------------------- building

function fingerprint(apply, refs) {
  switch (apply.kind) {
    case 'command': return apply.run.map((r) => [r.bin, ...r.argv]);
    case 'plan': return apply.goal;
    case 'routine': return apply.create;
    default: return [apply.copy, ...refs];
  }
}

function reco(source, r) {
  const refs = [...new Set(r.refs ?? [])].sort();
  const hash = createHash('sha1').update(JSON.stringify(fingerprint(r.apply, refs))).digest('hex').slice(0, 8);
  return {
    id: `${r.base}#${hash}`,
    base: r.base,
    area: r.area,
    title: r.title,
    benefit: r.benefit,
    action: r.action,
    effort: r.effort ?? 'low',
    priority: r.priority,
    unblocks: r.unblocks ?? false,
    cost: r.cost ?? { tokens: 0 },
    refs,
    apply: r.apply,
    source,
    at: r.at ?? null,
  };
}

const manual = (copy) => ({ kind: 'manual', copy });

// Ordered Reco[] from collectRecoSources output. Pure.
export function buildRecos(sources, { routing = loadRouting(), home = homedir() } = {}) {
  const tilde = (p) => (p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);
  const items = (name) => sources.find((x) => x.name === name && x.ok)?.items;
  const bins = items('bins') ?? { git: null, rm: null, node: null, relay: null };
  const out = [];
  const add = (source, r) => out.push(reco(source, r));

  const gh = items('gh');
  if (gh && !(gh.installed && gh.signedIn)) {
    const install = !gh.installed;
    add('gh', {
      base: install ? 'brain:gh:install' : 'brain:gh:login', area: 'brain',
      title: install ? 'Install gh' : 'Sign in to gh',
      benefit: 'CI and review items reach Waiting on you, and pr-hygiene checks pull requests.',
      action: install ? 'Copy the install link.' : 'Copy gh auth login.',
      apply: manual(install ? 'https://cli.github.com' : 'gh auth login'),
      priority: 'high', unblocks: true,
    });
  }

  for (const k of items('keys') ?? []) {
    const needers = [...new Set((k.neededBy ?? []).map((n) => n.name))];
    if (k.status === 'in-file') {
      add('keys', {
        base: `brain:key:${k.name}`, area: 'brain',
        title: `Move ${k.name} out of ${basename(k.literalIn)}`,
        benefit: 'The key stops living in a config file.',
        action: 'Copy the file path.',
        apply: manual(tilde(k.literalIn)), refs: [tilde(k.literalIn)],
        priority: 'mid', unblocks: false,
      });
    } else {
      add('keys', {
        base: `brain:key:${k.name}`, area: 'brain',
        title: `Set ${k.name}`,
        benefit: needers.length ? `${needers.join(', ')} can run.` : 'Nothing breaks when it is unset.',
        action: `Copy export ${k.name}=.`,
        apply: manual(`export ${k.name}=`), refs: needers,
        priority: needers.length ? 'high' : 'low', unblocks: needers.length > 0,
      });
    }
  }

  for (const c of items('connectors') ?? []) {
    add('connectors', {
      base: `brain:connector:${c.harness}:${c.name}`, area: 'brain',
      title: `Authenticate ${c.name}`, benefit: `${c.name} tools become available.`, action: 'Run /mcp in Claude Code.',
      apply: manual('/mcp'), refs: [c.name], priority: 'low',
    });
  }

  const byRoot = new Map();
  for (const b of items('skill-links') ?? []) {
    if (!byRoot.has(b.root)) byRoot.set(b.root, []);
    byRoot.get(b.root).push(b);
  }
  for (const [root, links] of byRoot) {
    add('skill-links', {
      base: `brain:skill-links:${tilde(root)}`, area: 'brain',
      title: `Remove ${links.length} broken skill link${s(links.length)} in ${tilde(root)}`,
      benefit: 'Brain → Skills lists only skills that load.', action: 'Delete the dangling symlinks.',
      apply: { kind: 'command', run: links.map((l) => ({ bin: bins.rm, argv: ['--', l.path], cwd: root, deletes: true })) },
      refs: links.map((l) => basename(l.path)), priority: 'low',
    });
  }

  for (const r of items('routine-paths') ?? []) {
    const codex = r.harness === 'codex';
    add('routine-paths', {
      base: `brain:routine-path:${r.id}`, area: 'brain',
      title: `Repoint routine ${r.id}`, benefit: 'The routine runs on schedule again.',
      action: codex ? 'Rewrite its Codex automation.' : 'Copy relay routine refresh.',
      apply: codex
        ? { kind: 'command', run: [{ bin: bins.node, argv: [bins.relay, 'routine', 'refresh'], cwd: home, deletes: false }] }
        : manual('relay routine refresh'),
      refs: [r.id], priority: 'high', unblocks: true,
    });
  }

  for (const g of items('pr-hygiene') ?? []) {
    const base = `repos:${g.rid}:${g.kind}`;
    const common = { base, area: 'repos', at: g.at };
    if (g.kind === 'relay-branches') {
      const n = g.entries.reduce((sum, e) => sum + e.branches.length, 0);
      const k = g.entries.length;
      add('pr-hygiene', {
        ...common, title: `Delete ${n} leftover relay branches`,
        benefit: `${k} finished plan${s(k)} stop showing as ready to merge, and pr-hygiene stops reporting them.`,
        action: "Run git branch -D for the merged plans' branches.",
        apply: { kind: 'command', run: g.entries.map((e) => ({ bin: bins.git, argv: ['-C', g.repo, 'branch', '-D', ...e.branches], cwd: g.repo, deletes: true })) },
        refs: g.entries.map((e) => `relay/${e.slug}/*`), priority: 'mid',
      });
    } else if (g.kind === 'relay-worktrees') {
      add('pr-hygiene', {
        ...common, title: `Remove ${g.entries.length} lane worktrees of finished plans`,
        benefit: 'Disk space comes back, and pr-hygiene stops reporting them.', action: 'Run git worktree remove for each.',
        apply: { kind: 'command', run: g.entries.map((wt) => ({ bin: bins.git, argv: ['-C', g.repo, 'worktree', 'remove', wt], cwd: g.repo, deletes: true })) },
        refs: g.entries.map(tilde), priority: 'mid',
      });
    } else if (g.kind === 'branch-merged-old') {
      add('pr-hygiene', {
        ...common, title: `Delete ${g.entries.length} old merged branches`,
        benefit: 'git branch lists only live work.', action: 'Run git branch -d for each.',
        apply: { kind: 'command', run: g.entries.map((b) => ({ bin: bins.git, argv: ['-C', g.repo, 'branch', '-d', b], cwd: g.repo, deletes: true })) },
        refs: [...g.entries], priority: 'low',
      });
    } else if (LINK_KINDS[g.kind]) {
      add('pr-hygiene', {
        ...common, title: LINK_KINDS[g.kind].title(g.entries.length), benefit: LINK_KINDS[g.kind].benefit, action: 'Open them on GitHub.',
        apply: manual(g.entries.map((e) => e.href).join('\n')), refs: g.entries.map((e) => `#${e.key}`), priority: 'low',
      });
    }
  }

  const f = routing.forecast;
  for (const l of items('ledgers') ?? []) {
    const n = l.minors.length;
    if (n > 0) {
      add('ledgers', {
        base: `runs:${l.rid}:${l.slug}:deferred`, area: 'runs', at: l.completeAt,
        title: `Fix ${n} deferred minor${s(n)} of ${l.slug}`,
        benefit: `The minors the reviewers deferred in ${l.slug} get fixed.`, action: 'Plan a bugfix run for them.',
        apply: { kind: 'plan', rid: l.rid, repo: l.repo, repoName: l.repoName, goal: `Fix the deferred minors of plan ${l.slug}: ${l.minors.join('; ')}`.slice(0, 1000) },
        cost: { tokens: null, windowPct: Math.max(1, Math.round(n * f.tierWeight.mid * f.riskFactor.low * f.defaults.pctPerUnit)) },
        effort: n <= 3 ? 'low' : n <= 8 ? 'mid' : 'high',
        refs: [`${l.repoName}/${l.slug}`], priority: 'low',
      });
    }
    for (const p of l.skipped) {
      add('ledgers', {
        base: `runs:${l.rid}:${l.slug}:skipped:${p.piece}`, area: 'runs', at: p.at,
        title: `${p.piece} was skipped in ${l.slug}`, benefit: `${p.piece} runs at final.`, action: 'Copy the missing path.',
        apply: manual(p.path), refs: [p.path], priority: 'high', unblocks: true,
      });
    }
  }

  for (const w of items('weekly-report') ?? []) {
    add('weekly-report', {
      base: `routines:suggest:${w.id}`, area: 'routines', at: w.reportAt,
      title: `Add routine ${w.id}`, benefit: w.what, action: 'Create it, then enable it in the routine dialog.',
      apply: { kind: 'routine', routine: w.id, create: { id: w.id, kind: w.kind, days: w.days, at: w.at, prompt: w.what } },
      refs: [`${w.days} ${w.at}`], priority: 'low',
    });
  }

  return orderRecos(out);
}

// ---------------------------------------------------------------- state and order

// New state: recos that vanished from a source read successfully are done (marked auto in known);
// an auto-done reco that is built again is open again. Every built reco is known.
export function reconcile(state, recos, sources, now = new Date()) {
  const built = new Set(recos.map((r) => r.id));
  const read = new Map(sources.filter((x) => x.ok).map((x) => [x.name, x.held ?? []]));
  const done = { ...(state.done ?? {}) };
  const skipped = { ...(state.skipped ?? {}) };
  const known = { ...(state.known ?? {}) };
  const applied = { ...(state.applied ?? {}) };
  for (const [id, k] of Object.entries(known)) {
    const held = read.get(k?.source);
    if (built.has(id) || !held || held.some((p) => id.startsWith(p)) || Object.hasOwn(done, id) || Object.hasOwn(skipped, id)) continue;
    done[id] = now.toISOString();
    delete applied[id];
    known[id] = { ...k, auto: true };
  }
  for (const r of recos) {
    if (known[r.id]?.auto) delete done[r.id];
    delete known[r.id];
    known[r.id] = { title: r.title, area: r.area, source: r.source };
  }
  const keys = Object.keys(known);
  for (const id of keys.slice(0, Math.max(0, keys.length - KNOWN_MAX))) delete known[id];
  return { ...state, version: 1, done, skipped, applied, cart: [...(state.cart ?? [])], known };
}

export function orderRecos(recos) {
  return [...recos].sort((a, b) =>
    PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)
    || AREAS.indexOf(a.area) - AREAS.indexOf(b.area)
    || (a.at === null) - (b.at === null)
    || String(b.at ?? '').localeCompare(String(a.at ?? ''))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
