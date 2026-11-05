#!/usr/bin/env bash
# Create the scratch repository the calibration runs work in (a tiny Node project with node:test).
#   codex-math/scripts/make-scratch-repo.sh <dir>
set -euo pipefail
dir=$1
mkdir -p "$dir/src" "$dir/test"
cd "$dir"
cat > package.json <<'JSON'
{ "name": "relay-calibration-scratch", "version": "0.0.1", "type": "module", "private": true, "scripts": { "test": "node --test test/*.test.mjs" } }
JSON
cat > src/money.mjs <<'JS'
// Money helpers used by the scratch project. Amounts are integers in minor units (cents).
export function add(a, b) {
  return a + b;
}
export function format(cents, currency = 'EUR') {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')} ${currency}`;
}
JS
cat > test/money.test.mjs <<'JS'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add, format } from '../src/money.mjs';
test('add', () => assert.equal(add(150, 250), 400));
test('format', () => assert.equal(format(-1205, 'USD'), '-12.05 USD'));
JS
cat > README.md <<'MD'
# scratch

A small project used to calibrate relay's Codex model. Nothing here matters.
MD
printf 'node_modules/\n' > .gitignore
git init -q . 2>/dev/null || true
git add -A
git -c user.email=relay@example.invalid -c user.name=relay commit -qm "scratch project" >/dev/null 2>&1 || true
echo "scratch repo at $dir"
