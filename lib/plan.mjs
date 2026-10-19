// Relay plans are markdown for humans plus one ```relay-plan JSON block for tools.
// See skills/plan-with-tiers/SKILL.md for the format.

import { TIERS } from './routing.mjs';

export const RISKS = ['low', 'medium', 'high'];

export function parsePlan(text) {
  const block = /```relay-plan[^\n]*\n([\s\S]*?)\n```/.exec(text);
  if (!block) throw new Error('plan has no ```relay-plan block (see skills/plan-with-tiers)');
  let data;
  try {
    data = JSON.parse(block[1]);
  } catch (err) {
    throw new Error(`relay-plan block is not valid JSON: ${err.message}`);
  }
  const tasks = (data.tasks ?? []).map((t) => ({
    deps: [],
    behaviors: [],
    code: 'prose',
    tests: 0,
    ...t,
    id: String(t.id),
  }));
  return {
    slug: data.slug,
    suite: data.suite,
    setup: data.setup,
    tasks,
    sections: taskSections(text),
    globalConstraints: section(text, 'Global Constraints'),
  };
}

// `### T3: title` … until the next ### or ## heading (the relay-plan block excluded).
export function taskSections(text) {
  const body = text.replace(/```relay-plan[\s\S]*?\n```/, '');
  const sections = {};
  const re = /^### +([A-Za-z]+[\w.-]*)\s*[:\-—]/gm;
  const heads = [...body.matchAll(re)];
  heads.forEach((m, i) => {
    const start = m.index;
    const nextHead = heads[i + 1]?.index ?? body.length;
    const from = start + m[0].length;
    const nextH2 = body.slice(from).search(/^## /m);
    const end = nextH2 === -1 ? nextHead : Math.min(nextHead, from + nextH2);
    sections[m[1]] = body.slice(start, end).trim();
  });
  return sections;
}

export function section(text, title) {
  const re = new RegExp(`^## +${title}\\s*$`, 'm');
  const m = re.exec(text);
  if (!m) return undefined;
  const rest = text.slice(m.index + m[0].length);
  const end = rest.search(/^## /m);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

export function validatePlan(plan) {
  const errors = [];
  const warnings = [];
  if (!plan.slug || !/^[a-z0-9][a-z0-9-]*$/.test(plan.slug)) errors.push('slug must be kebab-case (a-z, 0-9, -)');
  if (!plan.tasks.length) errors.push('plan has no tasks');
  const ids = new Set();
  for (const t of plan.tasks) {
    const at = `task ${t.id}`;
    if (ids.has(t.id)) errors.push(`${at}: duplicate id`);
    ids.add(t.id);
    if (!t.title) errors.push(`${at}: missing title`);
    if (!TIERS.includes(t.tier)) errors.push(`${at}: tier must be one of ${TIERS.join(', ')}`);
    if (!RISKS.includes(t.risk)) errors.push(`${at}: risk must be one of ${RISKS.join(', ')}`);
    if (!Array.isArray(t.files) || !t.files.length) errors.push(`${at}: files must list every path it creates or changes`);
    if (!Number.isInteger(t.tests) || t.tests < 0) errors.push(`${at}: tests must be a whole number >= 0 (the budget of NEW tests)`);
    if (!t.done) errors.push(`${at}: done must be the narrow check that proves it (a command)`);
    if (!['complete', 'prose'].includes(t.code)) errors.push(`${at}: code must be "complete" or "prose"`);
    if (plan.sections && !plan.sections[t.id]) warnings.push(`${at}: no "### ${t.id}: ..." section with the task's text`);
    if (t.tier === 'cheap' && t.code !== 'complete' && (t.files?.length ?? 0) > 2) {
      warnings.push(`${at}: cheap tier on prose spanning ${t.files.length} files usually costs more turns than it saves; use mid or put the code in the plan`);
    }
    if (t.tests > Math.max(t.behaviors.length, 1)) warnings.push(`${at}: ${t.tests} tests for ${t.behaviors.length} listed behaviors; one test per behavior`);
    if (t.risk === 'low' && t.tests > 1) warnings.push(`${at}: low risk with ${t.tests} new tests; typecheck + existing tests usually cover it`);
    if (t.risk === 'high' && t.tests === 0) warnings.push(`${at}: high risk with no new test`);
  }
  for (const t of plan.tasks) {
    for (const d of t.deps) if (!ids.has(String(d))) errors.push(`task ${t.id}: depends on unknown task ${d}`);
  }
  const cycle = findCycle(plan.tasks);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' -> ')}`);
  return { errors, warnings };
}

function findCycle(tasks) {
  const deps = new Map(tasks.map((t) => [t.id, t.deps.map(String)]));
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 'done') return undefined;
    if (state.get(id) === 'open') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'open');
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 'done');
    return undefined;
  };
  for (const t of tasks) {
    const c = visit(t.id);
    if (c) return c;
  }
  return undefined;
}
