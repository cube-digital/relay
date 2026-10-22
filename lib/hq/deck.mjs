// The Skills Deck store: a small list of command and skill cards kept in <relayHome>/hq/deck.json.
// Missing file means the defaults; an invalid file is kept as deck.json.bad.

import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { relayHome } from '../budget.mjs';
import { loadRouting, modelFor } from '../routing.mjs';
import { writeJsonAtomic } from '../routines/store.mjs';
import { listSkills } from './catalog.mjs';
import { launchOptions } from './launch.mjs';

export const DECK_COMMANDS = { plan: 'strong', run: 'mid', marathon: 'mid', connectors: 'cheap', 'setup-codex': 'cheap' };
export const DECK_MAX = 24;
const ID_RE = /^[a-z0-9][a-z0-9:_-]*$/i;
const HARNESSES = ['claude', 'codex'];
const fail = (status, message) => Object.assign(new Error(message), { status });

export const deckPath = () => join(relayHome(), 'hq', 'deck.json');

const defaults = () => ({
  version: 1,
  items: [
    { kind: 'command', id: 'plan' },
    { kind: 'command', id: 'run' },
    { kind: 'command', id: 'marathon' },
    { kind: 'command', id: 'connectors' },
    { kind: 'skill', id: 'qa-mindset' },
    { kind: 'skill', id: 'handoff' },
  ],
});

function validItem(i) {
  if (!i || typeof i !== 'object') return false;
  if (i.kind !== 'command' && i.kind !== 'skill') return false;
  if (typeof i.id !== 'string' || !ID_RE.test(i.id)) return false;
  if (i.kind === 'command' && !Object.hasOwn(DECK_COMMANDS, i.id)) return false;
  if (i.harness !== undefined && !HARNESSES.includes(i.harness)) return false;
  if (i.model !== undefined && typeof i.model !== 'string') return false;
  if (i.effort !== undefined && typeof i.effort !== 'string') return false;
  return true;
}

export function readDeck() {
  const path = deckPath();
  if (!existsSync(path)) return defaults();
  try {
    const d = JSON.parse(readFileSync(path, 'utf8'));
    const keys = new Set();
    const ok = d?.version === 1 && Array.isArray(d.items) && d.items.length <= DECK_MAX && d.items.every((i) => validItem(i) && !keys.has(`${i.kind}:${i.id}`) && keys.add(`${i.kind}:${i.id}`));
    if (ok) return { version: 1, items: d.items };
  } catch {
    // fall through to the bad-file path
  }
  try {
    renameSync(path, `${path}.bad`);
  } catch {
    // keep going with the defaults
  }
  return defaults();
}

export function deckView({ skills = listSkills().skills, routing = loadRouting() } = {}) {
  const names = new Set(skills.map((s) => s.name));
  const items = readDeck().items.map((it) => {
    const harness = it.harness ?? 'claude';
    const tier = it.kind === 'command' ? DECK_COMMANDS[it.id] : 'mid';
    const base = modelFor(routing, tier, harness);
    const model = it.model ?? base.model;
    const effort = it.effort ?? base.effort;
    const intent = it.kind === 'command' ? { action: it.id, harness, model, effort } : { action: 'skill', skill: it.id, harness, model, effort };
    return {
      key: `${it.kind}:${it.id}`,
      kind: it.kind,
      id: it.id,
      label: it.kind === 'command' ? `/relay:${it.id}` : `/${it.id}`,
      harness,
      model,
      effort,
      missing: it.kind === 'skill' && !names.has(it.id),
      intent,
    };
  });
  const options = {};
  for (const h of HARNESSES) {
    const o = launchOptions(h, routing);
    options[h] = { models: o.models, efforts: o.efforts };
  }
  return { items, commands: Object.keys(DECK_COMMANDS), options };
}

function save(items) {
  mkdirSync(join(relayHome(), 'hq'), { recursive: true, mode: 0o700 });
  writeJsonAtomic(deckPath(), { version: 1, items });
}

export function deckOp(body, { skills = listSkills().skills, routing = loadRouting() } = {}) {
  const { op, kind, id } = body ?? {};
  if (!['add', 'remove', 'set'].includes(op)) throw fail(400, 'op must be add, remove or set');
  if (kind !== 'command' && kind !== 'skill') throw fail(400, 'kind must be command or skill');
  if (typeof id !== 'string' || !ID_RE.test(id)) throw fail(400, 'id is not valid');
  if (kind === 'command' && !Object.hasOwn(DECK_COMMANDS, id)) throw fail(400, `command must be one of ${Object.keys(DECK_COMMANDS).join(', ')}`);
  const items = readDeck().items.map((i) => ({ ...i }));
  const at = items.findIndex((i) => i.kind === kind && i.id === id);

  if (op === 'add') {
    if (kind === 'skill' && !skills.some((s) => s.name === id)) throw fail(400, `skill ${id} is not installed`);
    if (at >= 0) throw fail(409, 'already in the deck');
    if (items.length >= DECK_MAX) throw fail(400, `the deck holds ${DECK_MAX} items`);
    items.push({ kind, id });
  } else if (at < 0) {
    throw fail(404, 'not in the deck');
  } else if (op === 'remove') {
    items.splice(at, 1);
  } else {
    const item = items[at];
    const harness = body.harness;
    if (!HARNESSES.includes(harness)) throw fail(400, 'harness must be claude or codex');
    const action = kind === 'command' ? id : 'skill';
    const opts = launchOptions(harness, routing, action);
    if (body.model !== undefined && !opts.models.includes(body.model)) throw fail(400, `model must be one of ${opts.models.join(', ')}`);
    if (body.effort !== undefined && !opts.efforts.includes(body.effort)) throw fail(400, `effort must be one of ${opts.efforts.join(', ')}`);
    const changed = (item.harness ?? 'claude') !== harness;
    item.harness = harness;
    if (changed) {
      delete item.model;
      delete item.effort;
    }
    if (body.model !== undefined) item.model = body.model;
    if (body.effort !== undefined) item.effort = body.effort;
  }
  save(items);
  return { ok: true, deck: deckView({ skills, routing }) };
}
