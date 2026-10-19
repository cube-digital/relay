// relay setup claude [--write-project]
//   Prints (or merges into <repo>/.claude/settings.json) the settings relay relies on.
//   A plugin cannot set these itself: plugin settings only accept `agent` and `subagentStatusLine`.
// relay setup codex <project-dir>
//   Installs relay's Codex agents and hooks into <project>/.codex/ and the [agents] backstop.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { mainRoot } from '../lib/git.mjs';
import { RELAY_ROOT } from '../lib/routing.mjs';

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
    console.error('usage: relay setup codex <project-dir>');
    return 64;
  }
  const codexDir = join(project, '.codex');
  const agentsDir = join(codexDir, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  const src = join(RELAY_ROOT, 'codex', 'agents');
  const agents = readdirSync(src).filter((f) => f.endsWith('.toml'));
  for (const f of agents) copyFileSync(join(src, f), join(agentsDir, f));
  console.log(`✓ ${agents.length} agents → ${agentsDir}`);

  const hooksFile = join(codexDir, 'hooks.json');
  const hooks = readFileSync(join(RELAY_ROOT, 'codex', 'hooks.json'), 'utf8').replaceAll('__RELAY_ROOT__', RELAY_ROOT);
  if (existsSync(hooksFile) && readFileSync(hooksFile, 'utf8') !== hooks) {
    writeFileSync(join(codexDir, 'hooks.relay.json'), hooks);
    console.log(`! ${hooksFile} exists; wrote relay's hooks to hooks.relay.json for you to merge`);
  } else {
    writeFileSync(hooksFile, hooks);
    console.log(`✓ hooks → ${hooksFile} (Codex asks you to trust them via /hooks)`);
  }

  const configFile = join(codexDir, 'config.toml');
  const snippet = readFileSync(join(RELAY_ROOT, 'codex', 'config.snippet.toml'), 'utf8');
  const config = existsSync(configFile) ? readFileSync(configFile, 'utf8') : '';
  if (/^\[agents\]/m.test(config)) {
    console.log(`! ${configFile} already has an [agents] table; add these keys yourself:\n${snippet}`);
  } else {
    writeFileSync(configFile, (config ? config.trimEnd() + '\n\n' : '') + snippet);
    console.log(`✓ [agents] defaults → ${configFile}`);
  }
  console.log(
    '\nSkills: install the plugin (`codex plugin marketplace add cube-digital/relay`, then /plugins),\n' +
      `or link them for this project: ln -s "${join(RELAY_ROOT, 'skills')}"/* "${join(project, '.agents', 'skills')}/"\n` +
      'Put the `relay` CLI on PATH: (cd ' + RELAY_ROOT + ' && npm link)',
  );
  return 0;
}

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['write-project'] });
  if (args._[0] === 'claude') return setupClaude(args);
  if (args._[0] === 'codex') return setupCodex(args);
  console.error('usage: relay setup claude [--write-project] | relay setup codex <project-dir>');
  return 64;
}
