// Model profiles (config/model-profiles.json): what Relay changes when the main
// Claude Code session runs on a given model. The mod applies them at spawn time and
// when a Relay skill expands; this module validates them for `relay build`, shapes
// the copy the mod embeds, and computes the same route for `relay profile`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { modelFor, RELAY_ROOT, tierOfClaudeModel } from './routing.mjs';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const ROUTES = ['fable-lead'];

const strip = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !k.startsWith('$')));

export function loadProfiles(root = RELAY_ROOT) {
  const file = join(root, 'config', 'model-profiles.json');
  const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { profiles: [] };
  const dir = join(root, 'profiles', 'overlays');
  const overlays = {};
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) if (f.endsWith('.md')) overlays[f.slice(0, -3)] = readFileSync(join(dir, f), 'utf8').trim();
  }
  return { ...config, overlays };
}

export function effortBelow(effort, limit) {
  const a = EFFORTS.indexOf(effort);
  const b = EFFORTS.indexOf(limit);
  return a !== -1 && b !== -1 && a < b;
}

// Every name a profile uses must exist: roles, skills, overlays, routes, effort levels.
export function profileProblems(cfg, { roles = new Set(), skills = new Set() } = {}) {
  const file = 'config/model-profiles.json';
  const out = [];
  const overlay = (id, at) => {
    if (!cfg.overlays?.[id]) out.push(`${file}: ${at}: overlay "${id}" has no profiles/overlays/${id}.md`);
  };
  const effort = (v, at) => {
    if (v !== undefined && !EFFORTS.includes(v)) out.push(`${file}: ${at}: effort "${v}" is not one of ${EFFORTS.join(', ')}`);
  };
  if (!cfg.frontier?.claude?.model) out.push(`${file}: frontier.claude.model is required`);
  effort(cfg.frontier?.claude?.effort, 'frontier.claude.effort');
  const ids = new Set();
  (cfg.profiles ?? []).forEach((p, i) => {
    const at = `profiles[${i}]`;
    if (!p.id) out.push(`${file}: ${at}: id is required`);
    else if (ids.has(p.id)) out.push(`${file}: ${at}: id "${p.id}" is used twice`);
    ids.add(p.id);
    if (!Array.isArray(p.match) || !p.match.length || p.match.some((m) => typeof m !== 'string' || !m)) out.push(`${file}: ${at}: match must list model id fragments`);
    if (!ROUTES.includes(p.route)) out.push(`${file}: ${at}: route must be one of ${ROUTES.join(', ')}`);
    for (const r of p.frontierRoles ?? []) if (!roles.has(r)) out.push(`${file}: ${at}: frontierRoles: no roles/${r}.md`);
    if (p.escalation && !/^[a-z0-9]+$/.test(p.escalation.agentSuffix ?? '')) out.push(`${file}: ${at}: escalation.agentSuffix must be letters and digits`);
    effort(p.escalation?.effort, `${at}.escalation.effort`);
    for (const k of ['fiveHour', 'sevenDay']) {
      const v = p.frontierCap?.[k];
      if (v !== undefined && !(typeof v === 'number' && v > 0 && v <= 100)) out.push(`${file}: ${at}: frontierCap.${k} must be a percent`);
    }
    for (const s of p.lead?.skills ?? []) if (!skills.has(s)) out.push(`${file}: ${at}: lead.skills: no skills/${s}/SKILL.md`);
    (p.lead?.overlays ?? []).forEach((o, j) => {
      overlay(o.id, `${at}.lead.overlays[${j}]`);
      effort(o.belowEffort, `${at}.lead.overlays[${j}].belowEffort`);
    });
    effort(p.lead?.unattendedEffort, `${at}.lead.unattendedEffort`);
    for (const [k, list] of Object.entries(strip(p.spawnOverlays))) for (const id of list) overlay(id, `${at}.spawnOverlays.${k}`);
  });
  return out;
}

// The copy the mod embeds: no comments, only the overlays a profile uses.
export function modProfiles(cfg) {
  const used = new Set();
  const profiles = (cfg.profiles ?? []).map((p) => {
    const lead = { skills: p.lead?.skills ?? [], overlays: (p.lead?.overlays ?? []).map((o) => strip(o)) };
    for (const o of lead.overlays) used.add(o.id);
    const spawnOverlays = strip(p.spawnOverlays);
    for (const list of Object.values(spawnOverlays)) for (const id of list) used.add(id);
    return {
      id: p.id,
      match: p.match.map((m) => m.toLowerCase()),
      route: p.route,
      frontierRoles: p.frontierRoles ?? [],
      escalation: p.escalation ? { agentSuffix: p.escalation.agentSuffix } : null,
      frontierCap: { fiveHour: p.frontierCap?.fiveHour ?? 100, sevenDay: p.frontierCap?.sevenDay ?? 100 },
      lead,
      spawnOverlays: { frontier: spawnOverlays.frontier ?? [], escalation: spawnOverlays.escalation ?? [] },
    };
  });
  const overlays = Object.fromEntries([...used].sort().map((id) => [id, cfg.overlays[id]]));
  return { frontier: cfg.frontier.claude.model, profiles, overlays };
}

export function profileForModel(cfg, model) {
  if (!model) return undefined;
  const m = String(model).toLowerCase();
  return (cfg.profiles ?? []).find((p) => p.match.some((x) => m.includes(String(x).toLowerCase())));
}

export function frontierCapped(profile, windows) {
  if (!profile) return false;
  const p5 = windows?.fiveHour?.percentUsed ?? 0;
  const p7 = windows?.sevenDay?.percentUsed ?? 0;
  return p5 >= (profile.frontierCap?.fiveHour ?? 100) || p7 >= (profile.frontierCap?.sevenDay ?? 100);
}

// Model and effort for each role under the session model's route, as the mod picks them.
// `level` is the budget level; `windows` the usage reading (for the frontier cap).
export function routeFor({ cfg, routing, team, model, level = 'normal', windows }) {
  const profile = profileForModel(cfg, model);
  const capped = level === 'critical' || level === 'tight' || frontierCapped(profile, windows);
  const tier = (t) => modelFor(routing, t, 'claude');
  // The budget caps of config/routing.json, as the mod applies them to every spawn.
  const budgetCap = (role, row) => {
    const cap = level === 'tight' || level === 'critical' ? routing.budget[level] : undefined;
    if (!cap || cap.exempt?.includes(role) || tierOfClaudeModel(row.model) !== 'strong') return row;
    return { ...row, model: tier(cap.capStrongTo).model, effort: tier(cap.capStrongTo).effort, note: `capped by the ${level} budget` };
  };
  const rows = team.map((r) => {
    const base = tier(r.tier);
    let row = { role: r.name, tier: r.tier, model: base.model, effort: r.effort ?? base.effort };
    if (profile?.frontierRoles?.includes(r.name)) {
      row = capped
        ? { ...row, model: tier('strong').model, effort: tier('strong').effort, note: 'frontier, capped by the budget' }
        : { ...row, model: cfg.frontier.claude.model, effort: cfg.frontier.claude.effort ?? base.effort, note: 'frontier' };
    }
    return budgetCap(r.name, row);
  });
  let escalation;
  if (profile?.escalation) {
    const row = capped ? { model: tier('strong').model, effort: profile.escalation.effort ?? 'medium' } : { model: cfg.frontier.claude.model, effort: profile.escalation.effort ?? 'medium' };
    escalation = { agent: `lane-<id>-${profile.escalation.agentSuffix}`, role: 'implementer-deep', ...budgetCap('implementer-deep', row), capped };
  }
  return { profile, route: profile?.route ?? 'default', rows, escalation, capped };
}
