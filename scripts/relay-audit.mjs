// relay audit [paths…] [--json]
// Lint Relay's instruction files for prompting habits written for older models.
// Defaults to roles/, skills/ and commands/ of the installed root. Exit 1 when an
// error-level finding exists; warnings are printed for a human to judge.
// For a model-aware review of a whole project, run `/doctor prompt-audit` in Claude Code.

import { parseArgs } from '../lib/args.mjs';
import { auditPaths, DEFAULT_PATHS } from '../lib/audit.mjs';
import { RELAY_ROOT } from '../lib/routing.mjs';

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['json'] });
  const paths = args._?.length ? args._ : DEFAULT_PATHS;
  const root = args._?.length ? process.cwd() : RELAY_ROOT;
  const findings = auditPaths(paths, root);
  const errors = findings.filter((f) => f.level === 'error');
  if (args.json) {
    console.log(JSON.stringify({ errors: errors.length, warnings: findings.length - errors.length, findings }, null, 2));
  } else {
    for (const f of findings) console.log(`${f.level === 'error' ? '✗' : '!'} ${f.file}:${f.line} ${f.rule} — ${f.why}${f.text ? `\n    ${f.text}` : ''}`);
    console.log(`${errors.length} error(s), ${findings.length - errors.length} warning(s)`);
  }
  return errors.length ? 1 : 0;
}
