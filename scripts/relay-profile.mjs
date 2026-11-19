// relay profile [--model <id>] [--json]
// The model profile and route for the main Claude Code session: which model and effort
// each role gets, the extra fix round, and the text that Relay adds for this model.
// The model comes from --model, else from ~/.relay/claude-session.json (the mod writes it).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { relayHome } from '../lib/budget.mjs';
import { effortBelow, loadProfiles, routeFor } from '../lib/profiles.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { loadTeam } from '../lib/team.mjs';
import { readBudget } from './relay-budget.mjs';

export function sessionPath() {
  return join(relayHome(), 'claude-session.json');
}

function readSession() {
  const path = sessionPath();
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function ago(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(min)) return 'at an unknown time';
  return min < 1 ? 'just now' : min < 120 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

export function profileReport({ model, source, effort, budget }) {
  const cfg = loadProfiles();
  const routing = loadRouting();
  const team = loadTeam();
  const r = routeFor({ cfg, routing, team, model, level: budget.level, windows: budget.snapshot });
  const advice = [];
  if (!model) advice.push('No session model yet: open a Claude Code session with Relay installed, or pass --model <id>.');
  if (r.profile) {
    const unattended = r.profile.lead?.unattendedEffort;
    if (unattended && effort && effortBelow(effort, unattended)) {
      advice.push(`The session runs at ${effort} effort: set /effort ${unattended} before an unattended run. relay marathon gives its legs --effort ${unattended}.`);
    }
    if (r.capped) advice.push('Frontier work runs on the strong tier now: the budget is above the profile cap.');
  }
  return { model: model ?? null, source, effort: effort ?? null, budget: budget.level, ...r, profile: r.profile?.id ?? 'default', lead: r.profile?.lead ?? null, advice };
}

export function main(argv) {
  const args = parseArgs(argv, { booleans: ['json'] });
  const session = readSession();
  const model = typeof args.model === 'string' ? args.model : session?.model;
  const source = typeof args.model === 'string' ? '--model' : session ? `the session, ${ago(session.updatedAt)}` : 'none';
  const effort = typeof args.effort === 'string' ? args.effort : args.model ? undefined : session?.effort;
  const report = profileReport({ model, source, effort, budget: readBudget({ harness: 'claude' }) });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(`model: ${report.model ?? 'unknown'} (from ${report.source})${report.effort ? ` · effort ${report.effort}` : ''}`);
  console.log(`profile: ${report.profile} · route ${report.route} · budget ${report.budget}`);
  console.log('');
  const w = Math.max(...report.rows.map((x) => x.role.length));
  for (const x of report.rows) console.log(`  ${x.role.padEnd(w)}  ${x.tier.padEnd(6)}  ${x.model.padEnd(7)}  ${x.effort.padEnd(6)}  ${x.note ?? ''}`.trimEnd());
  if (report.escalation) {
    const e = report.escalation;
    console.log(
      e.capped
        ? `\nfix round 6: off while the budget is above the profile cap; adjudicate after round 5`
        : `\nfix round 6: ${e.agent} → ${e.role} on ${e.model}, effort ${e.effort}, after implementer-deep's rounds 4–5`,
    );
  }
  if (report.lead) {
    const ids = report.lead.overlays.map((o) => (o.belowEffort ? `${o.id} (below ${o.belowEffort} effort)` : o.id));
    console.log(`lead text: ${ids.join(', ')} → skills ${report.lead.skills.join(', ')}`);
  }
  if (report.route === 'default') console.log('\nroute default: Relay routes by plan tier and adds no model-specific text.');
  for (const a of report.advice) console.log(`! ${a}`);
  return 0;
}
