import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute } from '../lib/hq/ui/routes.js';

const ALL = { name: 'all', redirect: '#/' };

test('old routes land on All, brain tabs land on Setup, live routes stay', () => {
  const hashes = [
    '#/plans', '#/projects', '#/recos', '#/launches', '#/activity', '#/nonsense',
    '#/brain/keys', '#/brain', '#/brain/agents', '#/brain/wiring', '#/routines',
    '', '#/',
    '#/repos/abc1234567/plans/x/tasks/T1',
    '#/launches/20260101-000000-abcd',
    '#/projects/billing/repos',
  ];
  const got = Object.fromEntries(hashes.map((h) => [h, parseRoute(h)]));
  assert.deepEqual(got, {
    '#/plans': ALL,
    '#/projects': ALL,
    '#/recos': ALL,
    '#/launches': ALL,
    '#/activity': ALL,
    '#/nonsense': ALL,
    '#/brain/keys': { name: 'setup', tab: 'keys', redirect: '#/setup/keys' },
    '#/brain': { name: 'setup', tab: 'team', redirect: '#/setup/team' },
    '#/brain/agents': { name: 'setup', tab: 'team', redirect: '#/setup/team' },
    '#/brain/wiring': { name: 'setup', tab: 'flows', redirect: '#/setup/flows' },
    '#/routines': { name: 'setup', tab: 'routines', redirect: '#/setup/routines' },
    '': { name: 'all' },
    '#/': { name: 'all' },
    '#/repos/abc1234567/plans/x/tasks/T1': { name: 'run', rid: 'abc1234567', slug: 'x', task: 'T1' },
    '#/launches/20260101-000000-abcd': { name: 'launch', id: '20260101-000000-abcd' },
    '#/projects/billing/repos': { name: 'project', id: 'billing', redirect: '#/projects/billing' },
  });
});
