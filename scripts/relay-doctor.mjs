// Read-only local diagnostics. Hook installation is observable; user trust is not.
import { accessSync, constants, existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { RELAY_ROOT } from '../lib/routing.mjs';
import { resolveCodexBin } from '../lib/codex-rpc.mjs';

function projectTrust(project) {
  const userConfig = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
  try {
    const text = readFileSync(userConfig, 'utf8');
    const paths = new Set([project]);
    try { paths.add(realpathSync(project)); } catch { /* keep the given path */ }
    const trusted = [...text.matchAll(/^\s*\[\s*projects\s*\.\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*\]\s*(?:#.*)?\n((?:(?!\s*\[).*\n?)*)/gm)]
      .filter((m) => /^\s*trust_level\s*=\s*["']trusted["']/m.test(m[3]))
      .map((m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]));
    if ([...paths].some((p) => trusted.includes(p))) return 'project trust: trusted';
    return `project trust: not trusted in ${userConfig}; Codex ignores ${project}/.codex/config.toml (role registrations and [agents] defaults) until you trust the project`;
  } catch { return 'project trust: unknown'; }
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.harness !== 'codex') {
    console.error('usage: relay doctor --harness codex [--project <dir>] [--codex-bin <path>]');
    return 64;
  }
  const project = resolve(args.project ?? process.cwd());
  let available;
  try {
    const executable = resolveCodexBin({ codexBin: args['codex-bin'] });
    accessSync(executable, constants.X_OK);
    available = executable;
  } catch { /* Report missing executables without launching a process. */ }
  console.log(`Codex executable: ${available ?? 'not found (set RELAY_CODEX_BIN or --codex-bin)'}`);
  const resources = ['bin/relay', 'roles/reviewer.md', 'codex/hooks.plugin.json', 'hooks/codex-spawn.mjs', 'skills/relay-plan/SKILL.md'];
  const missing = resources.filter((p) => !existsSync(join(RELAY_ROOT, p)));
  console.log(`resources: ${missing.length ? `missing ${missing.join(', ')}` : 'complete'}`);
  const agents = join(project, '.codex', 'agents');
  const count = existsSync(agents) ? readdirSync(agents).filter((f) => /^relay-.*\.toml$/.test(f)).length : 0;
  const projectConfig = join(project, '.codex', 'config.toml');
  let registered = 0;
  try { registered = (readFileSync(projectConfig, 'utf8').match(/^\s*\[\s*agents\s*\.\s*"?relay-[\w-]+"?\s*\]/gm) ?? []).length; } catch { /* missing config: none registered */ }
  console.log(`project agents: ${count}; registered in .codex/config.toml: ${registered}`);
  console.log(projectTrust(project));
  const hookFile = join(project, '.codex', 'hooks.json');
  let malformed = false;
  if (existsSync(hookFile)) {
    try { JSON.parse(readFileSync(hookFile, 'utf8')); console.log(`project hook config: ${hookFile}`); }
    catch { malformed = true; console.log(`project hook config: malformed JSON at ${hookFile}`); }
  } else console.log('project hook config: absent; native plugin hooks require the plugin to be enabled');
  console.log(`plugin hook config: ${join(RELAY_ROOT, 'codex', 'hooks.plugin.json')}`);
  console.log('hook trust: unknown — verify enabled hooks and approve in Codex /hooks; files alone do not prove trust');
  return !available || missing.length || malformed ? 1 : 0;
}
