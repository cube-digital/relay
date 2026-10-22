// Acceptance test for the recos builder: ids, priorities, stability and reconcile.

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildRecos, collectRecoSources, reconcile } from '../lib/hq/recos.mjs';
import { recosFixture } from './recos-fixture.mjs';

test('recos come from relay files with stable ids and priorities, and a vanished source reco is marked done', () => {
  const fx = recosFixture();
  try {
    const env = { PATH: process.env.PATH };
    const s1 = collectRecoSources({ home: fx.home, env });
    const first = buildRecos(s1);
    const base = (id) => id.split('#')[0];
    const byBase = Object.fromEntries(first.map((r) => [base(r.id), r]));
    const pick = (b) => byBase[b] && { priority: byBase[b].priority };

    assert.deepEqual(pick(`repos:${fx.rid}:relay-branches`), { priority: 'mid' });
    assert.deepEqual(byBase[`repos:${fx.rid}:relay-branches`].apply.run.map((r) => r.argv),
      [['-C', fx.repo, 'branch', '-D', 'relay/demo/integration', 'relay/demo/lane-a']]);
    assert.deepEqual(pick(`runs:${fx.rid}:demo:deferred`), { priority: 'low' });
    assert.ok(byBase[`runs:${fx.rid}:demo:deferred`].cost.windowPct >= 1);
    assert.deepEqual(pick(`runs:${fx.rid}:demo:skipped:requirements-check`), { priority: 'high' });
    assert.deepEqual(pick('brain:key:DEMO_API_KEY'), { priority: 'high' });
    assert.deepEqual(pick('brain:skill-links:~/.claude/skills'), { priority: 'low' });
    assert.deepEqual(pick('brain:routine-path:pr-hygiene@x'), { priority: 'high' });

    const again = buildRecos(collectRecoSources({ home: fx.home, env }));
    assert.deepEqual(again.map((r) => r.id), first.map((r) => r.id));

    rmSync(join(fx.home, '.claude', 'skills', 'gone'));
    const s2 = collectRecoSources({ home: fx.home, env });
    const second = buildRecos(s2);
    const empty = { version: 1, done: {}, skipped: {}, cart: [], known: {} };
    const state = reconcile(reconcile(empty, first, s1), second, s2);
    assert.deepEqual(Object.keys(state.done), [byBase['brain:skill-links:~/.claude/skills'].id]);
    assert.deepEqual(state.skipped, {});
  } finally {
    fx.restore();
  }
});
