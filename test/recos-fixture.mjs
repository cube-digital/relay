// Shared fixture for the HQ recos tests: temp HOME and RELAY_HOME, a registered repo with a finished plan,
// two pr-hygiene instances and a skills folder with a needy skill and a dangling symlink.

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addRepo } from '../lib/hq/registry.mjs';
import { ridOf } from '../lib/hq/repo.mjs';
import { ROOT, tempRepo } from './helpers.mjs';

export function recosFixture() {
  const saved = { RELAY_HOME: process.env.RELAY_HOME, HOME: process.env.HOME };
  const home = mkdtempSync(join(tmpdir(), 'relay-recos-home-'));
  const relayHome = mkdtempSync(join(tmpdir(), 'relay-recos-rh-'));
  process.env.HOME = home;
  process.env.RELAY_HOME = relayHome;
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  try {
    const { dir, git } = tempRepo();
    git('branch', 'relay/demo/integration');
    git('branch', 'relay/demo/lane-a');
    const repo = addRepo(dir);
    const rid = ridOf(repo);

    const runDir = join(dir, '.relay', 'runs', 'demo');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'ledger.md'), [
      '# relay ledger — plan: docs/relay/plans/demo.md',
      '- 2026-10-20 09:00 start: 2 tasks, 1 lanes, 1 waves',
      '- 2026-10-20 09:30 deferred minor: lane a: one',
      '- 2026-10-20 09:31 lane a: clean; deferred minor: two',
      '- 2026-10-20 09:40 piece requirements-check: skipped (requires docs/relay/requirements/demo.md missing)',
      '- 2026-10-20 09:45 plan: complete (relay/demo/integration @ abc1234)',
      '',
    ].join('\n'));

    const instance = (id, relayCli) => ({
      id, routine: 'pr-hygiene', harness: 'codex', scope: { all: true }, schedule: { days: ['mon'], at: '09:00' }, options: {},
      relayCli, registration: { state: 'active', codexPath: `~/.codex/automations/${id.replace('@', '-')}` }, enabledAt: '2026-10-20T08:00:00.000Z',
    });
    mkdirSync(join(relayHome, 'routines', 'pr-hygiene@all'), { recursive: true });
    writeFileSync(join(relayHome, 'routines', 'enabled.json'), JSON.stringify({
      version: 1,
      instances: [instance('pr-hygiene@all', join(ROOT, 'bin', 'relay')), instance('pr-hygiene@x', join(relayHome, 'no-such-relay'))],
    }, null, 2));
    const finding = { id: `${rid}:relay-branches:demo`, kind: 'relay-branches', repo, repoName: 'demo', text: '2 branches of finished plan demo', href: null, command: null };
    writeFileSync(join(relayHome, 'routines', 'pr-hygiene@all', 'state.json'), JSON.stringify({
      version: 1, seen: { [finding.id]: '2026-10-20T10:00:00.000Z' }, dismissed: {}, current: [finding], lastRunAt: '2026-10-20T10:00:00.000Z', weekRuns: { week: null, count: 0 },
    }, null, 2));

    const skills = join(home, '.claude', 'skills');
    mkdirSync(join(skills, 'needs-key'), { recursive: true });
    writeFileSync(join(skills, 'needs-key', 'SKILL.md'), '---\nname: needs-key\ndescription: demo\n---\nCalls an API with DEMO_API_KEY.\n');
    symlinkSync(join(home, 'nowhere'), join(skills, 'gone'));
    return { home, relayHome, repo, rid, git, restore };
  } catch (err) {
    restore();
    throw err;
  }
}
