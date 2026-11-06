import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ringOf } from '../lib/hq/overview.mjs';
import { parseRoute, SETUP_TABS } from '../lib/hq/ui/routes.js';

test('the Overview ring reaches every Setup section, counts lanes and lights only what needs you', () => {
  const all = {
    needs: [{}, {}],
    running: [{ lanes: [{ title: 'Implementer' }, { title: 'Reviewer' }] }, { lanes: [{ title: 'Implementer' }] }, {}],
    ready: [{}],
  };
  const brain = { team: 12, flows: 2, pieces: 7, skills: 39, connectors: 5, connectorsNeedAuth: 0, keys: 4, keysMissing: 1 };
  const r = ringOf({ all, brain, routines: 2, repos: 3, projects: 1 });

  assert.equal(r.needs, 2);
  assert.equal(r.lanes, 3);
  const hrefs = r.nodes.map((n) => n.href);
  for (const [tab] of SETUP_TABS) assert.ok(hrefs.includes(`#/setup/${tab}`), tab);
  for (const href of hrefs) assert.equal(parseRoute(href).redirect, undefined, href);
  assert.deepEqual(r.nodes.filter((n) => n.hot).map((n) => n.id), ['keys']);
  assert.equal(r.nodes.find((n) => n.id === 'team').detail, '2 working');
  assert.equal(r.nodes.find((n) => n.id === 'running').detail, '3 runs · 3 lanes');
});
