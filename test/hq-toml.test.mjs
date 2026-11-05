import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseToml } from '../lib/hq/toml.mjs';

test('the TOML subset reads mcp_servers shapes and reports a broken file instead of throwing', () => {
  const r = parseToml([
    '# codex config',
    'model = "gpt-6.1-sol"',
    '',
    '[mcp_servers.node_repl]',
    'command = "node"',
    'args = [',
    '  "repl.js", # entry',
    "  '--quiet',",
    ']',
    'startup_timeout_sec = 20',
    '',
    '[mcp_servers.node_repl.env]',
    'NODE_ENV = "production"',
    'REPL_TOKEN = "${REPL_TOKEN}"',
    '',
    '[mcp_servers."billing api"]',
    'url = "https://billing.example/mcp"',
    'http_headers = { Authorization = "Bearer x\\"y", "X-Team" = \'core\' }',
    'env_vars = ["A_TOKEN", "B_API_KEY"]',
    'enabled = true',
  ].join('\n'));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value, {
    model: 'gpt-6.1-sol',
    mcp_servers: {
      node_repl: { command: 'node', args: ['repl.js', '--quiet'], startup_timeout_sec: 20, env: { NODE_ENV: 'production', REPL_TOKEN: '${REPL_TOKEN}' } },
      'billing api': { url: 'https://billing.example/mcp', http_headers: { Authorization: 'Bearer x"y', 'X-Team': 'core' }, env_vars: ['A_TOKEN', 'B_API_KEY'], enabled: true },
    },
  });
  const broken = parseToml('[mcp_servers.x]\ncommand = "node\nargs = [');
  assert.equal(broken.ok, false);
  assert.match(broken.error, /^line 2:/);
});
