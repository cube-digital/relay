// A reco whose launch has ended while the rebuild still produces it stays applied, with its outcome, and can be applied again.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getLaunch, listLaunches } from '../lib/hq/launches.mjs';
import { applyRecos, readRecoState, recoOp, recosView } from '../lib/hq/recos-state.mjs';
import { recosFixture } from './recos-fixture.mjs';

test('an applied reco still produced after its launch ended keeps its outcome, can be added to the cart and applied again', async () => {
  const fx = recosFixture();
  const savedPath = process.env.PATH;
  try {
    // branch deletion fails, so the launch ends and the branches are still there for the rebuild
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const shim = mkdtempSync(join(tmpdir(), 'relay-git-shim-'));
    writeFileSync(join(shim, 'git'), `#!/bin/sh\ncase "$*" in *'branch -D'*) exit 1;; esac\nexec '${realGit}' "$@"\n`);
    chmodSync(join(shim, 'git'), 0o755);
    process.env.PATH = `${shim}:${savedPath}`;
    const id = recosView({ maxAgeMs: 0 }).recos.find((r) => r.id.startsWith(`repos:${fx.rid}:relay-branches#`)).id;
    const first = (await applyRecos({ ids: [id], confirm: true })).launches[0].id;
    const deadline = Date.now() + 15000;
    while (getLaunch(first).status === 'running' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.notEqual(getLaunch(first).status, 'running');

    const reco = recosView({ maxAgeMs: 0 }).recos.find((r) => r.id === id);
    assert.equal(reco.state, 'applied');
    assert.equal(reco.applied.launch, first);
    assert.equal(reco.applied.status, 'failed');

    recoOp({ op: 'cart-add', ids: [id] });
    assert.deepEqual(readRecoState().cart, [id]);
    const res = await applyRecos({ ids: [id], confirm: true });
    assert.deepEqual(res.refused, []);
    assert.equal(res.launches.length, 1);
    assert.notEqual(res.launches[0].id, first);
    assert.equal(listLaunches().length, 2);
  } finally {
    process.env.PATH = savedPath;
    fx.restore();
  }
});
