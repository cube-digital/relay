// relay role new <name> --kind <kind> --tier <tier> --title "<title>"
// Scaffolds roles/<name>.md under RELAY_SOURCE_ROOT (default: relay's own root).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { RELAY_ROOT, TIERS } from '../lib/routing.mjs';
import { avatarFor, freeColor, KINDS, loadTeam, PROFILE_SECTIONS } from '../lib/team.mjs';

const USAGE = 'usage: relay role new <name> --kind <kind> --tier <tier> --title "<title>"';

export function main(argv) {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  const name = args._[0];
  if (cmd !== 'new' || !name || typeof args.kind !== 'string' || typeof args.tier !== 'string' || typeof args.title !== 'string') {
    console.error(USAGE);
    return 64;
  }
  const src = process.env.RELAY_SOURCE_ROOT || RELAY_ROOT;
  const fail = (m) => (console.error(`✗ ${m}`), 1);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return fail(`role name "${name}" must be kebab-case`);
  const file = join(src, 'roles', `${name}.md`);
  if (existsSync(file)) return fail(`roles/${name}.md already exists`);
  if (!KINDS.includes(args.kind)) return fail(`kind must be one of ${KINDS.join(', ')}`);
  if (!TIERS.includes(args.tier)) return fail(`tier must be one of ${TIERS.join(', ')}`);
  const title = args.title.trim();
  if (!title) return fail('title must not be empty');
  const builder = args.kind === 'builder';
  const lines = [
    '---',
    `name: ${name}`,
    `tier: ${args.tier}`,
    `title: ${title}`,
    `avatar: ${avatarFor(title)}`,
    `kind: ${args.kind}`,
    'description: TODO: when to use this role.',
    `tools: ${builder ? 'Read, Edit, Write, Bash, Grep, Glob' : 'Read, Grep, Glob, Bash'}`,
    ...(args.kind === 'reviewer' || args.kind === 'finder' ? ['readonly: true'] : []),
    'maxTurns: 40',
    `color: ${freeColor(loadTeam(src))}`,
    '---',
    ...PROFILE_SECTIONS.flatMap((s) => [`## ${s}`, '- TODO', '']),
    '## Instructions',
    '',
    `You are relay's ${title.toLowerCase()}. TODO: how you work and what you return.`,
    '',
  ];
  mkdirSync(join(src, 'roles'), { recursive: true });
  writeFileSync(file, lines.join('\n'));
  console.log(file);
  console.log('next: fill in the profile and description, then relay build');
  console.log('run `relay build --check`');
  return 0;
}
