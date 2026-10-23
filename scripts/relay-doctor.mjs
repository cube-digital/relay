// Read-only local diagnostics. Hook installation is observable; user trust is not.
import { accessSync, constants, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { RELAY_ROOT } from '../lib/routing.mjs';
import { resolveCodexBin } from '../lib/codex-rpc.mjs';

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
  console.log(`project agents: ${count} (discovered on next Codex session)`);
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
