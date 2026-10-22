import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { brainConnectors, brainKeys } from '../lib/hq/brain.mjs';
import { listSkills, listTeam, wiring } from '../lib/hq/catalog.mjs';
import { ROOT } from './helpers.mjs';

const pick = ({ harness, source, kind, status }) => ({ harness, source, kind, status });

test('connectors and keys: source, harness and status from every file, and no secret value in the output', () => {
  const home = mkdtempSync(join(tmpdir(), 'relay-hq-brain-'));
  const put = (rel, text) => {
    mkdirSync(dirname(join(home, rel)), { recursive: true });
    writeFileSync(join(home, rel), text);
  };
  const SECRETS = ['exa-settings-secret-111', 'sk-codex-literal-222', 'gh-env-secret-333', 'harness-internal-444'];
  put('.claude.json', JSON.stringify({ mcpServers: { sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: { Authorization: 'Bearer ${SENTRY_TOKEN}' } } } }));
  const pluginRel = join('.claude', 'plugins', 'cache', 'mk', 'docs-tool', '1.0.0');
  put(join('.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'docs-tool@mk': [{ scope: 'user', installPath: join(home, pluginRel), version: '1.0.0' }] } }));
  put(join(pluginRel, '.mcp.json'), JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['-y', 'docs-mcp'] } } }));
  put(join('.codex', 'config.toml'), [
    '[mcp_servers.node_repl]',
    'command = "node"',
    'args = ["repl.js"]',
    '',
    '[mcp_servers.billing]',
    'url = "https://billing.example/mcp"',
    'http_headers = { Authorization = "Bearer sk-codex-literal-222" }',
    '',
  ].join('\n'));
  put(join('.claude', 'settings.json'), JSON.stringify({ env: { EXA_API_KEY: 'exa-settings-secret-111' } }));
  put(join('.claude', 'skills', 'synced', 'abc123', 'deep-skill', 'SKILL.md'), '---\nname: deep-synced\ndescription: nested\n---\nbody\n');
  put(join('elsewhere', 'linked-skill', 'SKILL.md'), '---\nname: linked-codex\ndescription: linked\n---\nbody\n');
  mkdirSync(join(home, '.codex', 'skills'), { recursive: true });
  symlinkSync(join(home, 'elsewhere', 'linked-skill'), join(home, '.codex', 'skills', 'linked-skill'), 'dir');
  const opts = { home, relayHome: join(home, '.relay'), env: { GITHUB_TOKEN: 'gh-env-secret-333', CLAUDE_CODE_MESSAGING_TOKEN: 'harness-internal-444', PATH: '' }, relayRoot: ROOT };

  const connectors = brainConnectors(opts);
  const keys = brainKeys(opts);
  const widget = (name) => connectors.connectors.find((c) => c.name === name);
  assert.deepEqual(pick(widget('sentry')), { harness: 'claude', source: 'user', kind: 'mcp-http', status: 'key-missing' });
  assert.deepEqual(pick(widget('docs')), { harness: 'claude', source: 'docs-tool', kind: 'mcp-stdio', status: 'configured' });
  assert.deepEqual(pick(widget('node_repl')), { harness: 'codex', source: 'codex', kind: 'mcp-stdio', status: 'configured' });
  assert.deepEqual(pick(widget('billing')), { harness: 'codex', source: 'codex', kind: 'mcp-http', status: 'in-file' });
  const key = (name) => keys.keys.find((k) => k.name === name);
  assert.equal(key('SENTRY_TOKEN').status, 'missing');
  assert.equal(key('EXA_API_KEY').status, 'set');
  assert.equal(key('GITHUB_TOKEN').status, 'set');

  assert.ok(!key('CLAUDE_CODE_MESSAGING_TOKEN'));
  const skills = listSkills({ home, relayRoot: ROOT }).skills;
  assert.ok(skills.some((k) => k.name === 'deep-synced' && k.harness.includes('claude')));
  assert.ok(skills.some((k) => k.name === 'linked-codex' && k.harness.includes('codex')));

  const out = JSON.stringify({ connectors, keys });
  for (const secret of SECRETS) assert.ok(!out.includes(secret), `secret ${secret} leaked`);

  const ba = listTeam({ home, relayRoot: ROOT }).team.find((m) => m.name === 'business-analyst');
  assert.equal(ba.title, 'Business Analyst');
  assert.equal(ba.avatar, 'BA');
  assert.equal(ba.kind, 'planner');
  assert.equal(ba.tier, 'strong');
  assert.ok(ba.profile.Never);
  const wired = wiring({ relayRoot: ROOT });
  const feature = wired.flows.find((f) => f.id === 'feature');
  assert.deepEqual(
    (({ piece, role, avatar, gate }) => ({ piece, role, avatar, gate }))(feature.slots['lane.after'][0]),
    { piece: 'platform-review', role: 'platform-engineer', avatar: 'PE', gate: 'blocking' },
  );
  assert.deepEqual(wired.problems, []);
});
