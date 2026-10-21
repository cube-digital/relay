// Where Claude Code and Codex keep their user-level configuration, read
// defensively: every reader returns data or a short reason, none throws, and
// no reason quotes the file (parser messages can contain secrets).

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { RELAY_ROOT } from '../routing.mjs';
import { parseToml } from './toml.mjs';

export function harnessPaths(home = homedir()) {
  return {
    home,
    claudeJson: join(home, '.claude.json'),
    claudeSettings: join(home, '.claude', 'settings.json'),
    claudeSkills: join(home, '.claude', 'skills'),
    claudeAgents: join(home, '.claude', 'agents'),
    installedPlugins: join(home, '.claude', 'plugins', 'installed_plugins.json'),
    codexConfig: join(home, '.codex', 'config.toml'),
    codexSkills: join(home, '.codex', 'skills'),
    codexAgents: join(home, '.codex', 'agents'),
  };
}

// { ok: true, value } | { ok: false, missing: true } | { ok: false, error: 'invalid JSON' }
export function readJsonFile(path) {
  if (!existsSync(path)) return { ok: false, missing: true };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
}

export function readTomlFile(path) {
  if (!existsSync(path)) return { ok: false, missing: true };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { ok: false, error: 'cannot read' };
  }
  const r = parseToml(text);
  return r.ok ? r : { ok: false, error: `invalid TOML (${/^line \d+/.exec(r.error)?.[0] ?? 'parse error'})` };
}

// Installed Claude Code plugins whose folder exists: [{ name, marketplace, installPath, version }].
export function installedPlugins(paths) {
  const r = readJsonFile(paths.installedPlugins);
  const plugins = r.ok ? r.value?.plugins : undefined;
  if (!plugins || typeof plugins !== 'object') return [];
  const out = [];
  for (const [id, entry] of Object.entries(plugins)) {
    const [name, marketplace] = id.split('@');
    for (const e of Array.isArray(entry) ? entry : [entry]) {
      if (typeof e?.installPath !== 'string' || !existsSync(e.installPath)) continue;
      if (out.some((p) => p.name === name)) continue;
      out.push({ name, marketplace, installPath: e.installPath, version: e.version });
    }
  }
  return out;
}

export function subdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function filesIn(dir, ext) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(ext))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

const SKILL_DEPTH = 3;

function skillName(file) {
  try {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'));
    const v = /^name:\s*(.+?)\s*$/m.exec(fm?.[1] ?? '')?.[1]?.replace(/^(["'])(.*)\1$/, '$2');
    return v || undefined;
  } catch {
    return undefined;
  }
}

// Every SKILL.md HQ knows: relay's, the user's, each plugin's (relay's own plugin copy skipped), Codex's.
// Up to 3 levels below each root, following directory symlinks, once per real directory.
export function skillFiles({ home = homedir(), relayRoot = RELAY_ROOT } = {}) {
  const paths = harnessPaths(home);
  const out = [];
  const seen = new Set();
  const add = (root, source, harness) => {
    const walk = (dir, depth) => {
      let names;
      try {
        names = readdirSync(dir).sort();
      } catch {
        return;
      }
      for (const entry of names) {
        const path = join(dir, entry);
        try {
          if (!statSync(path).isDirectory()) continue; // stat follows symlinks
          const real = realpathSync(path);
          if (seen.has(real)) continue; // also stops symlink cycles
          seen.add(real);
          const file = join(path, 'SKILL.md');
          if (existsSync(file)) out.push({ name: skillName(file) ?? entry, source, harness, file });
          else if (depth < SKILL_DEPTH) walk(path, depth + 1);
        } catch {
          // unreadable or dangling: skip silently
        }
      }
    };
    walk(root, 1);
  };
  add(join(relayRoot, 'skills'), 'relay', ['claude', 'codex']);
  add(paths.claudeSkills, 'user', ['claude']);
  for (const p of installedPlugins(paths)) if (p.name !== 'relay') add(join(p.installPath, 'skills'), p.name, ['claude']);
  add(paths.codexSkills, 'codex', ['codex']);
  return out;
}

export function onPath(name, env = process.env) {
  const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const n of names) {
      const p = join(dir, n);
      try {
        if (statSync(p).isFile()) return p;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}
