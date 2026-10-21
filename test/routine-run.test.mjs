// Acceptance test for `relay routine run`: the weekly cap and the run lock.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT, runCli } from './helpers.mjs';

test('run stops at the weekly cap and while another run holds the lock', async () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-routine-run-'));
  process.env.RELAY_HOME = home;
  const env = { RELAY_HOME: home, HOME: home };
  const { updateEnabled, writeState, emptyState, readState } = await import('../lib/routines/store.mjs');
  const { DAYS, isoWeek } = await import('../lib/routines/schedule.mjs');

  assert.equal(runCli(['routine', 'new', 'nudge', '--prompt', 'Say hi', '--kind', 'passive'], { env }).code, 0);
  updateEnabled((doc) => {
    doc.instances.push({
      id: 'nudge@all', routine: 'nudge', harness: 'claude', scope: { all: true },
      schedule: { days: DAYS, at: '09:00' }, options: {}, relayCli: join(ROOT, 'bin', 'relay'),
      registration: { state: 'active', taskId: 'relay-nudge-all' }, enabledAt: new Date().toISOString(),
    });
  });
  const setCount = (count) => writeState('nudge@all', { ...emptyState(), weekRuns: { week: isoWeek(new Date()), count } });

  setCount(6);
  const last = runCli(['routine', 'run', 'nudge@all'], { env });
  assert.equal(last.code, 0);
  assert.match(last.stdout.split('\n')[0], /^RELAY_ROUTINE: nudge@all · 0 new · /);
  assert.match(last.stdout, /For you:/);
  assert.match(last.stdout, /routine note nudge@all/);

  const capped = runCli(['routine', 'run', 'nudge@all'], { env });
  assert.equal(capped.code, 0);
  assert.equal(capped.stdout.split('\n')[0], 'RELAY_ROUTINE: nudge@all · skipped · cap 7/week reached');

  // A data routine at the cap: an HQ "Run now" is not skipped and does not count; a scheduled run is skipped.
  updateEnabled((doc) => {
    doc.instances.push({
      id: 'pr-hygiene@all', routine: 'pr-hygiene', harness: 'claude', scope: { all: true },
      schedule: { days: DAYS, at: '09:00' }, options: {}, relayCli: join(ROOT, 'bin', 'relay'),
      registration: { state: 'active', taskId: 'relay-pr-hygiene-all' }, enabledAt: new Date().toISOString(),
    });
  });
  writeState('pr-hygiene@all', { ...emptyState(), weekRuns: { week: isoWeek(new Date()), count: 7 } });
  const viaHq = runCli(['routine', 'run', 'pr-hygiene@all', '--via', 'hq'], { env });
  assert.equal(viaHq.code, 0);
  assert.match(viaHq.stdout.split('\n')[0], /^RELAY_ROUTINE: pr-hygiene@all · (nothing new|\d+ new)/);
  assert.doesNotMatch(viaHq.stdout, /skipped/);
  assert.equal(readState('pr-hygiene@all').state.weekRuns.count, 7);
  assert.equal(runCli(['routine', 'run', 'pr-hygiene@all'], { env }).stdout.split('\n')[0], 'RELAY_ROUTINE: pr-hygiene@all · skipped · cap 7/week reached');

  setCount(0);
  const lock = join(home, 'routines', 'nudge@all', 'lock');
  mkdirSync(join(home, 'routines', 'nudge@all'), { recursive: true });
  writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  const locked = runCli(['routine', 'run', 'nudge@all'], { env });
  assert.equal(locked.code, 0);
  assert.equal(locked.stdout.split('\n')[0], 'RELAY_ROUTINE: nudge@all · skipped · already running');
  assert.equal(existsSync(lock), true);
});
