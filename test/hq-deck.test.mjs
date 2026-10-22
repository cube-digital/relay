// Acceptance test for the Skills Deck store (lib/hq/deck.mjs): defaults, bad file, guarded set, card intent.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deckOp, deckPath, deckView } from '../lib/hq/deck.mjs';
import { previewLaunch } from '../lib/hq/launch.mjs';
import { addRepo } from '../lib/hq/registry.mjs';
import { loadRouting } from '../lib/routing.mjs';
import { tempRepo } from './helpers.mjs';

test('the deck starts from routing-tier defaults, refuses off-routing models, persists a set, previews the card intent and survives a bad file', async () => {
  const saved = { RELAY_HOME: process.env.RELAY_HOME, HOME: process.env.HOME };
  process.env.RELAY_HOME = mkdtempSync(join(tmpdir(), 'relay-deck-home-'));
  process.env.HOME = mkdtempSync(join(tmpdir(), 'relay-deck-fake-'));
  try {
    const routing = loadRouting();
    const repo = addRepo(tempRepo().dir);

    // Defaults when the file is missing: six cards, not written.
    const view = deckView();
    assert.deepEqual(view.items.map((i) => i.key), ['command:plan', 'command:run', 'command:marathon', 'command:connectors', 'skill:qa-mindset', 'skill:handoff']);
    const plan = view.items[0];
    assert.equal(plan.label, '/relay:plan');
    assert.equal(plan.harness, 'claude');
    assert.equal(plan.model, routing.tiers.strong.claude.model);
    assert.equal(plan.effort, routing.tiers.strong.claude.effort);
    assert.equal(view.items[3].model, routing.tiers.cheap.claude.model);
    assert.equal(existsSync(deckPath()), false);

    // A codex model is not a valid claude model: 400, nothing written.
    assert.throws(
      () => deckOp({ op: 'set', kind: 'command', id: 'plan', harness: 'claude', model: 'gpt-6-luna' }),
      (e) => e.status === 400 && /model must be one of/.test(e.message),
    );
    assert.equal(existsSync(deckPath()), false);

    // A valid set persists across a fresh view.
    const cheap = routing.tiers.cheap.codex;
    const res = deckOp({ op: 'set', kind: 'command', id: 'connectors', harness: 'codex', model: cheap.model, effort: 'low' });
    assert.equal(res.ok, true);
    const card = deckView().items.find((i) => i.key === 'command:connectors');
    assert.deepEqual([card.harness, card.model, card.effort], ['codex', cheap.model, 'low']);

    // The card's intent previews with its harness, model and effort.
    const pv = previewLaunch({ ...card.intent, repo });
    assert.deepEqual([pv.intent.harness, pv.intent.model, pv.intent.effort], ['codex', cheap.model, 'low']);

    // An invalid file is kept as deck.json.bad and the defaults return.
    writeFileSync(deckPath(), '{');
    assert.deepEqual(deckView().items.map((i) => i.key), view.items.map((i) => i.key));
    assert.equal(readFileSync(`${deckPath()}.bad`, 'utf8'), '{');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
