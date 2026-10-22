// relay routine list | show | history | new | enable | confirm | disable | refresh | run | note
// Scheduled engineering checks. Each subcommand lives in lib/routines/ and is loaded on
// use; an error's `code` is the exit code (64 for usage).

import { parseArgs } from '../lib/args.mjs';

const SUBCOMMANDS = {
  list: ['../lib/routines/info.mjs', 'list'],
  show: ['../lib/routines/info.mjs', 'show'],
  history: ['../lib/routines/info.mjs', 'history'],
  new: ['../lib/routines/templates.mjs', 'newRoutine'],
  enable: ['../lib/routines/enable.mjs', 'enable'],
  confirm: ['../lib/routines/enable.mjs', 'confirm'],
  disable: ['../lib/routines/enable.mjs', 'disable'],
  refresh: ['../lib/routines/enable.mjs', 'refresh'],
  run: ['../lib/routines/run.mjs', 'run'],
  note: ['../lib/routines/run.mjs', 'note'],
};

export const USAGE = `usage: relay routine list | show <routine|instance> | history <instance>
  | enable <routine> --harness claude|codex (--project <id> | --repo <path> | --all) [--days mon,…] [--at HH:MM]
  | confirm <instance> --task-id <id> | disable <instance> | refresh
  | run <instance> [--dry-run] | note <instance> (the answer on stdin)
  | new <id> --prompt "<text>" --kind passive|active [--days mon,…] [--at HH:MM]`;

export async function main(argv) {
  const [sub, ...rest] = argv;
  if (!Object.hasOwn(SUBCOMMANDS, sub ?? '')) {
    console.error(USAGE);
    return sub === undefined || sub === '-h' || sub === '--help' ? 0 : 64;
  }
  const args = parseArgs(rest, { booleans: ['all', 'dry-run', 'json'] });
  const [file, name] = SUBCOMMANDS[sub];
  try {
    const mod = await import(new URL(file, import.meta.url));
    return await mod[name](args);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    return Number.isInteger(err.code) ? err.code : 1;
  }
}
