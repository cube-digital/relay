// Prompt-debt lint for Relay's own instruction files (roles, skills, commands).
// Current models think and check their work on their own: rituals written for
// older models add cost and can lower quality, and shouted rules get applied too
// widely. Errors fail `relay audit`; warnings are listed for a human to judge.
// Text inside backticks is ignored, so a rule can quote a phrase it forbids.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const DEFAULT_PATHS = ['roles', 'skills', 'commands'];
export const SKILL_MAX_LINES = 150;

const RULES = [
  { id: 'ritual-step-by-step', level: 'error', re: /\bthink (?:it through )?step[- ]by[- ]step\b/i, why: 'effort controls thinking; the phrase adds cost' },
  { id: 'ritual-thorough', level: 'error', re: /\bbe (?:maximally |very |extremely )?thorough\b/i, why: 'effort controls depth; the phrase adds cost' },
  { id: 'ritual-double-check', level: 'error', re: /\bdouble[- ]check (?:your|the) (?:work|answer)\b/i, why: 'give a check to run instead of a ritual' },
  { id: 'ritual-think-hard', level: 'error', re: /\bthink (?:hard|harder|deeply|carefully)\b/i, why: 'effort controls thinking; the phrase adds cost' },
  { id: 'ritual-keep-going', level: 'error', re: /\b(?:don't|do not) be lazy\b|\bloop until (?:it is |it's )?done\b/i, why: 'causes over-work on current models; the Fable profile adds its own finishing text' },
  { id: 'shouting', level: 'error', re: /\b(?:IMPORTANT|NEVER|ALWAYS|MUST|CRITICAL)\b(?![\w/-])/, why: 'emphasis makes the model over-apply a rule; a rule without exceptions belongs in a hook' },
  { id: 'bare-never', level: 'warn', re: /\bnever\b/i, why: 'an absolute without its reason; current models apply it literally' },
];

const REASON = /:|\bbecause\b|\bso (?:that )?\b|\bhook\b|\bguard\b|\bblocks?\b|—/i;

function stripCode(line) {
  return line.replace(/`[^`]*`/g, '``');
}

function walk(path, out) {
  if (!existsSync(path)) return out;
  const st = statSync(path);
  if (st.isFile()) {
    if (path.endsWith('.md')) out.push(path);
    return out;
  }
  for (const name of readdirSync(path).sort()) walk(join(path, name), out);
  return out;
}

// Findings for one file's text. `rel` is the path shown in each finding.
export function auditText(text, rel) {
  const findings = [];
  let fence = false;
  let heading = '';
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const h = /^#{1,6}\s+(.*)$/.exec(raw);
    if (h) heading = h[1].trim();
    const line = stripCode(raw);
    for (const rule of RULES) {
      if (!rule.re.test(line)) continue;
      // A role's "## Never" profile section is a list of boundaries, not an instruction.
      if (rule.id === 'bare-never' && (heading === 'Never' || REASON.test(line))) continue;
      findings.push({ file: rel, line: i + 1, rule: rule.id, level: rule.level, why: rule.why, text: raw.trim().slice(0, 160) });
    }
  });
  if (/(?:^|\/)SKILL\.md$/.test(rel) && lines.length > SKILL_MAX_LINES) {
    findings.push({ file: rel, line: lines.length, rule: 'long-skill', level: 'warn', why: `over ${SKILL_MAX_LINES} lines; every line is paid for on each invocation`, text: '' });
  }
  return findings;
}

export function auditPaths(paths, root) {
  const files = paths.flatMap((p) => walk(resolve(root, p), []));
  return files.flatMap((f) => auditText(readFileSync(f, 'utf8'), relative(root, f) || f));
}
