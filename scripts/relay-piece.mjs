// relay piece new <id> --role <role> --slot <point>
// Scaffolds pieces/<id>.json under RELAY_SOURCE_ROOT (default: relay's own root).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { LANE_POINTS, POINTS } from '../lib/flows.mjs';
import { RELAY_ROOT } from '../lib/routing.mjs';
import { loadTeam } from '../lib/team.mjs';

const USAGE = 'usage: relay piece new <id> --role <role> --slot <point>';

export function main(argv) {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  const id = args._[0];
  if (cmd !== 'new' || !id || typeof args.role !== 'string' || typeof args.slot !== 'string') {
    console.error(USAGE);
    return 64;
  }
  const src = process.env.RELAY_SOURCE_ROOT || RELAY_ROOT;
  const fail = (m) => (console.error(`✗ ${m}`), 1);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return fail(`piece id "${id}" must be kebab-case`);
  const team = loadTeam(src);
  if (!team.some((r) => r.name === args.role)) return fail(`unknown role "${args.role}" (roles: ${team.map((r) => r.name).join(', ')})`);
  if (!POINTS.includes(args.slot)) return fail(`unknown point "${args.slot}" (points: ${POINTS.join(', ')})`);
  const file = join(src, 'pieces', `${id}.json`);
  if (existsSync(file)) return fail(`pieces/${id}.json already exists`);
  const title = id.split('-').map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
  const piece = {
    id,
    title,
    role: args.role,
    slots: [args.slot],
    skills: [],
    requires: [],
    brief: 'TODO: what this piece checks or produces.',
    output: LANE_POINTS.includes(args.slot) ? `{run}/lane-{lane}.${id}.md` : `{run}/${id}.md`,
    gate: 'advisory',
    readonly: true,
  };
  mkdirSync(join(src, 'pieces'), { recursive: true });
  writeFileSync(file, JSON.stringify(piece, null, 2) + '\n');
  console.log(file);
  console.log(`next: relay flow add <flow> ${id} --at ${args.slot}`);
  console.log('run `relay build --check`');
  return 0;
}
