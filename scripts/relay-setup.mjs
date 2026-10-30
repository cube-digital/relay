// relay setup claude [--write-project]
//   Prints (or merges into <repo>/.claude/settings.json) the settings relay relies on.
//   A plugin cannot set these itself: plugin settings only accept `agent` and `subagentStatusLine`.
// relay setup codex <project-dir>
//   Installs relay's Codex agents and hooks into <project>/.codex/, registers each role as
//   [agents.relay-<role>] in <project>/.codex/config.toml (missing tables are appended, existing
//   bytes are kept as a prefix) and sets the [agents] backstop for a new config.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, symlinkSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { mainRoot } from '../lib/git.mjs';
import { RELAY_ROOT } from '../lib/routing.mjs';
import { configProblem } from '../lib/setup-config.mjs';

export const CLAUDE_SETTINGS = {
  // Lane and subagent worktrees branch from your current HEAD, not from origin's default branch.
  worktree: { baseRef: 'head' },
  // Subagents get a 5-minute cache by default even on a subscription; lanes idle longer while reviews run.
  subagentPromptCacheTtl: '1h',
};

function mergeDeep(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = mergeDeep(target[k] ?? {}, v);
    else target[k] = v;
  }
  return target;
}

function setupClaude(args) {
  const snippet = JSON.stringify(CLAUDE_SETTINGS, null, 2);
  if (!args['write-project']) {
    console.log('Recommended Claude Code settings (merge into ~/.claude/settings.json or <repo>/.claude/settings.json):');
    console.log(snippet);
    console.log('\nOr run: relay setup claude --write-project   (inside the repository)');
    return 0;
  }
  const root = mainRoot(process.cwd());
  if (!root) {
    console.error('✗ run inside a git repository');
    return 1;
  }
  const file = join(root, '.claude', 'settings.json');
  const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(file, JSON.stringify(mergeDeep(current, CLAUDE_SETTINGS), null, 2) + '\n');
  console.log(`✓ merged relay settings into ${file}`);
  return 0;
}

function setupCodex(args) {
  const project = args._[1] ? resolve(args._[1]) : undefined;
  if (!project || !existsSync(project)) {
    console.error('usage: relay setup codex <project-dir> [--plugin]');
    return 64;
  }
  const codexDir = join(project, '.codex');
  const configFile = join(codexDir, 'config.toml');
  const config = existsSync(configFile) ? readFileSync(configFile, 'utf8') : '';
  const problem = configProblem(config);
  if (problem) {
    console.error(`✗ malformed config: ${configFile}: ${problem}`);
    return 1;
  }
  const hooksFile = join(codexDir, 'hooks.json');
  if (existsSync(hooksFile)) {
    try { JSON.parse(readFileSync(hooksFile, 'utf8')); }
    catch { console.error(`✗ malformed hook config: ${hooksFile}`); return 1; }
    if (args.plugin && readFileSync(hooksFile, 'utf8').includes('/hooks/retest-guard.mjs')) {
      console.error(`✗ existing Relay project hooks in ${hooksFile}; remove only Relay entries before enabling native plugin hooks to avoid running them twice`);
      return 1;
    }
  }
  const agentsDir = join(codexDir, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  const src = join(RELAY_ROOT, 'codex', 'agents');
  const agents = readdirSync(src).filter((f) => f.endsWith('.toml'));
  for (const f of agents) {
    const target = join(agentsDir, f);
    if (existsSync(target) && readFileSync(target, 'utf8') !== readFileSync(join(src, f), 'utf8')) {
      copyFileSync(join(src, f), `${target}.relay-pending`);
      console.log(`! preserved ${target}; review ${target}.relay-pending`);
    } else copyFileSync(join(src, f), target);
  }
  console.log(`✓ ${agents.length} agents → ${agentsDir}`);

  const hooks = readFileSync(join(RELAY_ROOT, 'codex', 'hooks.json'), 'utf8').replaceAll('__RELAY_ROOT__', RELAY_ROOT);
  if (args.plugin) {
    console.log('✓ native plugin hooks selected; project hooks were not installed');
  } else if (existsSync(hooksFile) && readFileSync(hooksFile, 'utf8') !== hooks) {
    writeFileSync(join(codexDir, 'hooks.relay.json'), hooks);
    console.log(`! ${hooksFile} exists; wrote relay's hooks to hooks.relay.json for you to merge`);
  } else {
    writeFileSync(hooksFile, hooks);
    console.log(`✓ hooks → ${hooksFile} (Codex asks you to trust them via /hooks)`);
  }

  const snippet = readFileSync(join(RELAY_ROOT, 'codex', 'config.snippet.toml'), 'utf8');
  const dirLiteral = JSON.stringify(agentsDir).slice(1, -1);
  const registrations = readFileSync(join(RELAY_ROOT, 'codex', 'agents.snippet.toml'), 'utf8').replaceAll('__RELAY_AGENTS_DIR__', dirLiteral);
  const blocks = registrations.split(/^(?=\[agents\.relay-)/m).slice(1).map((b) => b.trimEnd() + '\n');
  const missing = [];
  for (const block of blocks) {
    const role = block.match(/^\[agents\.relay-([^\]]+)\]/)[1];
    if (new RegExp(`^\\s*\\[\\s*agents\\s*\\.\\s*"?relay-${role}"?\\s*\\]`, 'm').test(config)) console.log(`! preserved [agents.relay-${role}] in ${configFile}`);
    else missing.push(block);
  }
  const exists = existsSync(configFile);
  if (exists) console.log(`! ${configFile} exists and was preserved; merge missing defaults yourself:\n${snippet}`);
  let written = false;
  if (!exists || missing.length) {
    const text = exists ? config + (config && !config.endsWith('\n') ? '\n' : '') + '\n' + missing.join('\n') : snippet + '\n' + missing.join('\n');
    const bad = configProblem(text);
    if (bad) console.log(`! not writing ${configFile} (${bad}); merge these role registrations yourself:\n${missing.join('\n')}`);
    else {
      writeFileSync(configFile, text);
      written = true;
      if (!exists) console.log(`✓ [agents] defaults → ${configFile}`);
    }
  }
  console.log(`✓ ${blocks.length - missing.length + (written ? missing.length : 0)} roles registered in ${configFile}`);
  if (!args.plugin) {
    const skillsDir = join(project, '.agents', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    for (const name of readdirSync(join(RELAY_ROOT, 'skills'))) {
      const target = join(skillsDir, name);
      try { lstatSync(target); console.log(`! preserved existing skill: ${target}`); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        symlinkSync(join(RELAY_ROOT, 'skills', name), target, 'dir');
      }
    }
    console.log(`✓ project skills → ${skillsDir}`);
  }
  console.log('\nStart a new Codex session. Trust native/project hooks through /hooks; setup cannot grant trust.');
  console.log(`CLI: node "${join(RELAY_ROOT, 'bin', 'relay')}" (no PATH installation required)`);
  return 0;
}

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['write-project', 'plugin'] });
  if (args._[0] === 'claude') return setupClaude(args);
  if (args._[0] === 'codex') return setupCodex(args);
  console.error('usage: relay setup claude [--write-project] | relay setup codex <project-dir> [--plugin]');
  return 64;
}
