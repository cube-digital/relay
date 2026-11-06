import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from './helpers.mjs';

test('codex hook files carry only the top-level fields Codex accepts', () => {
  // Codex 0.163 rejects the whole file on an unknown field: "unknown field `$comment`, expected `description` or `hooks`".
  for (const file of ['hooks.json', 'hooks.plugin.json']) {
    const hooks = JSON.parse(readFileSync(join(ROOT, 'codex', file), 'utf8'));
    assert.deepEqual(Object.keys(hooks).sort(), ['description', 'hooks'], file);
  }
});
