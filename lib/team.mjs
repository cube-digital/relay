// relay's team: each role's identity (title, avatar, colour, kind) and its
// four-part profile, read from roles/*.md. loadTeam never throws; roleProblems
// says what is wrong, naming the file and the field.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { RELAY_ROOT } from './routing.mjs';

export const KINDS = ['planner', 'coordinator', 'builder', 'reviewer', 'finder'];
export const PROFILE_SECTIONS = ['Understands', 'Receives', 'Delivers', 'Never'];
// The colour names Claude Code accepts for agents, and the hex HQ and the mod draw each with.
export const AGENT_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];
export const COLOR_HEX = { red: '#f43f5e', blue: '#60a5fa', green: '#34d399', yellow: '#f59e0b', purple: '#8b5cf6', orange: '#fb923c', pink: '#f472b6', cyan: '#5ee7ff' };
const NO_HEX = '#888888';

// "## Understands" … up to the next "## " heading, for the four profile sections.
export function profileOf(body) {
  const out = {};
  let current = null;
  for (const line of String(body ?? '').split('\n')) {
    const m = /^## +(.+?)\s*$/.exec(line);
    if (m) {
      current = PROFILE_SECTIONS.includes(m[1]) ? m[1] : null;
      if (current) out[current] = [];
    } else if (current) {
      out[current].push(line);
    }
  }
  return Object.fromEntries(
    Object.entries(out)
      .map(([k, lines]) => [k, lines.join('\n').trim()])
      .filter(([, v]) => v),
  );
}

export function roleProblems(data, body, file) {
  const out = [];
  if (typeof data.title !== 'string' || !data.title.trim()) out.push(`${file}: title is required (a job title, such as "Business Analyst")`);
  if (typeof data.avatar !== 'string' || !/^[A-Z]{2}$/.test(data.avatar)) out.push(`${file}: avatar must be two capital letters`);
  if (!KINDS.includes(data.kind)) out.push(`${file}: kind must be one of ${KINDS.join(', ')}`);
  if (!AGENT_COLORS.includes(data.color)) out.push(`${file}: color must be one of ${AGENT_COLORS.join(', ')}`);
  const profile = profileOf(body);
  for (const s of PROFILE_SECTIONS) if (!profile[s]) out.push(`${file}: profile section "## ${s}" is missing or empty`);
  return out;
}

// Initials of the title's first two words ("Quality Engineer" → QE), or its first two letters.
export function avatarFor(title) {
  const words = String(title ?? '').match(/[A-Za-z0-9]+/g) ?? [];
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase().padEnd(2, 'X');
}

// The least used agent colour, earliest in AGENT_COLORS on a tie.
export function freeColor(team) {
  const count = (c) => team.filter((r) => r.color === c).length;
  return [...AGENT_COLORS].sort((a, b) => count(a) - count(b) || AGENT_COLORS.indexOf(a) - AGENT_COLORS.indexOf(b))[0];
}

export function loadTeam(root = RELAY_ROOT) {
  const dir = join(root, 'roles');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const name = f.replace(/\.md$/, '');
      const file = `roles/${f}`;
      try {
        const { data, body } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
        return {
          name,
          file,
          title: data.title ?? '',
          avatar: data.avatar ?? '',
          color: data.color ?? '',
          hex: COLOR_HEX[data.color] ?? NO_HEX,
          kind: data.kind ?? '',
          tier: data.tier,
          description: data.description ?? '',
          tools: data.tools ?? [],
          readonly: Boolean(data.readonly),
          maxTurns: data.maxTurns ?? null,
          profile: profileOf(body),
          problems: roleProblems(data, body, file),
        };
      } catch (err) {
        return { name, file, title: '', avatar: '', color: '', hex: NO_HEX, kind: '', tier: undefined, description: '', tools: [], readonly: false, maxTurns: null, profile: {}, problems: [`${file}: ${err.message}`] };
      }
    });
}
