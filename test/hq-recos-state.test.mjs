// Acceptance tests for recos state and apply: persistence across reads, and apply refusing everything it did not build itself.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getLaunch, listLaunches } from '../lib/hq/launches.mjs';
import { applyPreview, applyRecos, readRecoState, recoOp, recosView } from '../lib/hq/recos-state.mjs';
import { recosFixture } from './recos-fixture.mjs';

const idOf = (view, base) => view.recos.find((r) => r.id.startsWith(`${base}#`)).id;

test('skipped and cart persist in recos.json, and a changed source makes the old id done', () => {
  const fx = recosFixture();
  try {
    const view = recosView({ maxAgeMs: 0 });
    const deferred = idOf(view, `runs:${fx.rid}:demo:deferred`);
    const branches = idOf(view, `repos:${fx.rid}:relay-branches`);
    recoOp({ op: 'skip', ids: [deferred] });
    recoOp({ op: 'cart-add', ids: [branches] });

    const state = readRecoState();
    assert.deepEqual(Object.keys(state.skipped), [deferred]);
    assert.deepEqual(state.cart, [branches]);
    const reread = recosView({ maxAgeMs: 0 });
    assert.equal(reread.recos.find((r) => r.id === deferred).state, 'skipped');
    assert.equal(reread.recos.find((r) => r.id === branches).inCart, true);
    assert.deepEqual(reread.cart, [branches]);

    fx.git('branch', 'relay/demo/lane-b');
    const after = recosView({ maxAgeMs: 0 });
    const renewed = idOf(after, `repos:${fx.rid}:relay-branches`);
    assert.notEqual(renewed, branches);
    assert.deepEqual(after.gone.filter((g) => g.id === branches).map((g) => g.state), ['done']);
    assert.ok(Object.hasOwn(readRecoState().done, branches));
  } finally {
    fx.restore();
  }
});

test('apply takes ids only, rebuilds commands itself and refuses gone or changed recos without starting anything', async () => {
  const fx = recosFixture();
  try {
    const view = recosView({ maxAgeMs: 0 });
    const deferred = idOf(view, `runs:${fx.rid}:demo:deferred`);
    const branches = idOf(view, `repos:${fx.rid}:relay-branches`);

    const preview = applyPreview({ ids: [branches, deferred] });
    assert.equal(preview.commands.length, 1);
    assert.equal(preview.commands[0].reco, branches);
    assert.equal(preview.commands[0].deletes, true);
    assert.match(preview.commands[0].display, /git -C \S+ branch -D .*relay\/demo\/integration.*relay\/demo\/lane-a/);
    assert.equal(preview.plans.length, 1);
    assert.equal(preview.plans[0].flow, 'bugfix');
    assert.ok(preview.plans[0].preview.intent.goal.startsWith('Fix the deferred minors of plan demo'));

    const refuses = (body, status, refused) => assert.rejects(async () => applyRecos(body), (e) => {
      assert.equal(e.status, status);
      if (refused) assert.deepEqual(e.refused, refused);
      return true;
    });
    await refuses({ ids: [branches], confirm: true, command: 'rm -rf /' }, 400);
    await refuses({ ids: ['repos:nope#00000000'], confirm: true }, 409, [{ id: 'repos:nope#00000000', reason: 'gone' }]);
    await refuses({ ids: [branches] }, 400);
    fx.git('branch', 'relay/demo/lane-b');
    await refuses({ ids: [branches], confirm: true }, 409, [{ id: branches, reason: 'changed, refresh' }]);
    assert.deepEqual(listLaunches(), []);
  } finally {
    fx.restore();
  }
});

test('apply of a cart command reco starts one launch with the server-built git command, is applied then done, and is refused while running', async () => {
  const fx = recosFixture();
  const savedPath = process.env.PATH;
  try {
    // a git shim on PATH holds branch deletion for a moment so the launch is observably running
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const shim = mkdtempSync(join(tmpdir(), 'relay-git-shim-'));
    writeFileSync(join(shim, 'git'), `#!/bin/sh\ncase "$*" in *'branch -D'*) sleep 2;; esac\nexec '${realGit}' "$@"\n`);
    chmodSync(join(shim, 'git'), 0o755);
    process.env.PATH = `${shim}:${savedPath}`;
    const branches = idOf(recosView({ maxAgeMs: 0 }), `repos:${fx.rid}:relay-branches`);
    recoOp({ op: 'cart-add', ids: [branches] });
    assert.deepEqual(readRecoState().cart, [branches]);

    const res = await applyRecos({ ids: [branches], confirm: true });
    assert.equal(res.launches.length, 1);
    assert.deepEqual(res.refused, []);
    const launchId = res.launches[0].id;
    assert.match(res.launches[0].display, /git -C \S+ branch -D relay\/demo\/integration relay\/demo\/lane-a$/);
    assert.deepEqual(getLaunch(launchId).argv.slice(-4), ['branch', '-D', 'relay/demo/integration', 'relay/demo/lane-a']);
    assert.equal(getLaunch(launchId).status, 'running');
    await assert.rejects(async () => applyRecos({ ids: [branches], confirm: true }), (e) => {
      assert.equal(e.status, 409);
      assert.deepEqual(e.refused, [{ id: branches, reason: 'running' }]);
      return true;
    });
    assert.equal(listLaunches().length, 1);

    // the memoized pre-apply build still produces the reco, as a rebuild would before the branches vanish
    const mid = recosView().recos.find((r) => r.id === branches);
    assert.equal(mid.state, 'applied');
    assert.equal(mid.applied.launch, launchId);

    const deadline = Date.now() + 15000;
    while (getLaunch(launchId).status === 'running' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    process.env.PATH = savedPath;
    assert.equal(getLaunch(launchId).status, 'done');
    assert.equal(fx.git('branch', '--list', 'relay/*').trim(), '');

    const after = recosView({ maxAgeMs: 0 });
    assert.equal(after.recos.some((r) => r.id === branches && r.state !== 'done'), false);
    assert.deepEqual(after.gone.filter((g) => g.id === branches).map((g) => g.state), ['done']);
    assert.deepEqual(after.cart, []);
  } finally {
    process.env.PATH = savedPath;
    fx.restore();
  }
});
