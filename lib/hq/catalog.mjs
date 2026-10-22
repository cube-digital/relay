// Brain catalog: skills, agents, CLIs and relay's own wiring (flows, generated
// files, who-uses-whom). Read-only; a bad user file is marked, never thrown.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { checkFlow, cliSubcommands, loadRoles, outputs } from '../../scripts/build.mjs';
import { parseFrontmatter } from '../frontmatter.mjs';
import { effectivePiece, loadFlowSet, POINTS, whenSummary } from '../flows.mjs';
import { RELAY_ROOT, loadRouting, modelFor } from '../routing.mjs';
import { loadTeam } from '../team.mjs';
import { filesIn, harnessPaths, installedPlugins, readJsonFile, readTomlFile, skillFiles, subdirs } from './sources.mjs';

const slash = (p) => p.split('\\').join('/');
const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const readText = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

function safeRoles(relayRoot) {
  try {
    return loadRoles(relayRoot);
  } catch {
    return [];
  }
}

function safeRouting(relayRoot) {
  try {
    return loadRouting(relayRoot);
  } catch {
    return null;
  }
}

function roleInfo(role, routing) {
  const model = (h) => {
    try {
      return routing ? modelFor(routing, role.tier, h) : null;
    } catch {
      return null;
    }
  };
  return { name: role.name, tier: role.tier, claude: model('claude'), codex: model('codex') };
}

export function wiring({ relayRoot = RELAY_ROOT } = {}) {
  const roles = safeRoles(relayRoot);
  const team = loadTeam(relayRoot);
  const set = loadFlowSet(relayRoot);
  const members = new Map(team.map((m) => [m.name, m]));
  const view = (piece, flow) => {
    const e = flow ? effectivePiece(flow, piece) : piece;
    const m = members.get(piece.role);
    return {
      piece: piece.id,
      title: piece.title ?? piece.id,
      role: piece.role,
      roleTitle: m?.title ?? '',
      roleKind: m?.kind ?? '',
      avatar: m?.avatar ?? '',
      hex: m?.hex ?? '#888888',
      gate: e.gate ?? 'blocking',
      readonly: Boolean(e.readonly),
      protect: piece.protect ?? [],
      when: whenSummary(e.when),
      brief: piece.brief ?? '',
      output: piece.output ?? '',
      slots: piece.slots ?? [],
      skills: piece.skills ?? [],
    };
  };
  const flows = [...set.flows].map(([id, f]) => {
    const slots = {};
    for (const point of POINTS) {
      const ids = Array.isArray(f.slots?.[point]) ? f.slots[point] : [];
      slots[point] = ids.filter((pid) => set.pieces.has(pid)).map((pid) => view({ ...set.pieces.get(pid), id: pid }, f));
    }
    return { id, title: f.title ?? id, slots };
  });
  const pieces = [...set.pieces].map(([id, piece]) => view({ ...piece, id }, null));
  let problems = [];
  try {
    problems = checkFlow(relayRoot);
  } catch {
    problems = ['flows/: cannot be checked'];
  }

  const generated = [];
  try {
    for (const [rel, content] of outputs(relayRoot)) {
      const path = slash(rel);
      let from;
      let m;
      if ((m = /^agents\/(.+)\.md$/.exec(path))) from = [`roles/${m[1]}.md`, 'config/routing.json'];
      else if ((m = /^codex\/agents\/relay-(.+)\.toml$/.exec(path))) from = [`roles/${m[1]}.md`, 'config/routing.json'];
      else if (path === 'codex/config.snippet.toml') from = ['config/routing.json'];
      else if (path === 'codex/hooks.json') from = ['scripts/build.mjs'];
      else if (path === 'hooks/register.ts') from = ['config/routing.json', 'roles/'];
      else from = [];
      const file = join(relayRoot, rel);
      generated.push({ path, from, inSync: existsSync(file) && readText(file) === content });
    }
  } catch {
    // outputs() failed (bad role or routing file): no generated list
  }

  const skillNames = subdirs(join(relayRoot, 'skills')).filter((d) => existsSync(join(relayRoot, 'skills', d, 'SKILL.md')));
  const targets = [...roles.map((r) => ({ name: r.name, kind: 'role' })), ...skillNames.map((n) => ({ name: n, kind: 'skill' }))]
    .map((t) => ({ ...t, re: new RegExp('(?<![\\w-])' + escaped(t.name) + '(?![\\w-])') }));
  let clis = [];
  try {
    clis = cliSubcommands(relayRoot);
  } catch {
    // no bin/relay
  }
  const sources = [
    ...filesIn(join(relayRoot, 'commands'), '.md').map((f) => ({ file: f, own: basename(f, '.md') })),
    ...skillNames.map((n) => ({ file: join(relayRoot, 'skills', n, 'SKILL.md'), own: n })),
    ...roles.map((r) => ({ file: join(relayRoot, 'roles', `${r.name}.md`), own: r.name })),
  ];
  const edges = [];
  const seen = new Set();
  const add = (from, to, kind) => {
    const k = `${from}\0${to}\0${kind}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ from, to, kind });
  };
  for (const s of sources) {
    const text = readText(s.file);
    const from = slash(relative(relayRoot, s.file));
    for (const t of targets) if (t.name !== s.own && t.re.test(text)) add(from, t.name, t.kind);
    for (const m of text.matchAll(/\brelay ([a-z][a-z-]*)/g)) if (clis.includes(m[1])) add(from, m[1], 'cli');
  }
  return { points: POINTS, flows, pieces, problems, generated, edges };
}

function skillUsage(home) {
  const r = readJsonFile(harnessPaths(home).claudeJson);
  const su = r.ok ? r.value?.skillUsage : undefined;
  if (!su || typeof su !== 'object' || Array.isArray(su)) return null;
  const values = Object.values(su);
  return values.every((v) => v && typeof v === 'object' && typeof v.usageCount === 'number') ? su : null;
}

export function listSkills({ home = homedir(), relayRoot = RELAY_ROOT } = {}) {
  const usage = skillUsage(home);
  const edges = wiring({ relayRoot }).edges;
  const skills = skillFiles({ home, relayRoot }).map((s) => {
    const text = readText(s.file);
    let description;
    try {
      description = parseFrontmatter(text).data.description;
    } catch {
      description = /^description:\s*(.+)$/m.exec(text)?.[1];
    }
    const u = usage && (usage[s.name] ?? usage[`${s.source}:${s.name}`]);
    return {
      name: s.name,
      source: s.source,
      harness: s.harness,
      description: typeof description === 'string' ? description : '',
      file: s.file,
      referencedBy: s.source === 'relay' ? edges.filter((e) => e.kind === 'skill' && e.to === s.name).map((e) => e.from) : [],
      usage: u
        ? {
            count: u.usageCount,
            lastUsedAt: typeof u.lastUsedAt === 'number' && Number.isFinite(u.lastUsedAt) ? new Date(u.lastUsedAt).toISOString() : null,
          }
        : null,
    };
  });
  return { usageAvailable: Boolean(usage), skills };
}

export function listTeam({ home = homedir(), relayRoot = RELAY_ROOT } = {}) {
  const routing = safeRouting(relayRoot);
  const set = loadFlowSet(relayRoot);
  const appearsIn = (role) => {
    const out = [];
    for (const [flow, f] of set.flows) {
      for (const point of POINTS) {
        for (const pid of Array.isArray(f.slots?.[point]) ? f.slots[point] : []) if (set.pieces.get(pid)?.role === role) out.push({ flow, point, piece: pid });
      }
    }
    return out;
  };
  const team = loadTeam(relayRoot).map((m) => {
    const info = roleInfo(m, routing);
    return {
      name: m.name,
      title: m.title,
      avatar: m.avatar,
      color: m.color,
      hex: m.hex,
      kind: m.kind,
      tier: m.tier,
      description: m.description,
      claude: info.claude,
      codex: info.codex,
      tools: m.tools,
      readonly: m.readonly,
      maxTurns: m.maxTurns,
      profile: m.profile,
      appearsIn: appearsIn(m.name),
      source: `roles/${m.name}.md`,
      generated: [`agents/${m.name}.md`, `codex/agents/relay-${m.name}.toml`],
      problems: m.problems,
    };
  });

  const paths = harnessPaths(home);
  const other = [];
  const addMd = (dir, source) => {
    for (const file of filesIn(dir, '.md')) {
      const base = basename(file, '.md');
      try {
        const { data } = parseFrontmatter(readFileSync(file, 'utf8'));
        other.push({ name: data.name ?? base, source, harness: 'claude', description: data.description ?? '', model: data.model ?? null, file });
      } catch {
        other.push({ name: base, source, harness: 'claude', file, unreadable: true });
      }
    }
  };
  addMd(paths.claudeAgents, 'user');
  for (const p of installedPlugins(paths)) if (p.name !== 'relay') addMd(join(p.installPath, 'agents'), p.name);
  for (const file of filesIn(paths.codexAgents, '.toml')) {
    const base = basename(file, '.toml');
    const r = readTomlFile(file);
    if (r.ok && r.value && typeof r.value === 'object') {
      const d = r.value;
      other.push({ name: d.name ?? base, source: 'codex', harness: 'codex', description: d.description ?? '', model: d.model ?? null, file });
    } else {
      other.push({ name: base, source: 'codex', harness: 'codex', file, unreadable: true });
    }
  }
  return { team, other, roleNew: 'relay role new <name> --kind <kind> --tier <tier> --title "<title>"' };
}
