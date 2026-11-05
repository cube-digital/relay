// relay HQ Brain: MCP connectors and API keys, built from the user's harness
// config. Only key names, ${VAR} references and booleans are ever kept; no
// config value reaches a return value, a log line or a file.

import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { relayHome as defaultRelayHome } from '../budget.mjs';
import { RELAY_ROOT } from '../routing.mjs';
import { resolveClaudeBin } from '../../scripts/relay-marathon.mjs';
import { harnessPaths, installedPlugins, onPath, readJsonFile, readTomlFile, skillFiles } from './sources.mjs';

const run = promisify(execFile);

export const KEY_RE = /(_API_KEY|_TOKEN|_SECRET|_ACCESS_KEY|_ACCESS_KEY_ID)$/;
const KEY_IN_TEXT = /\b[A-Z][A-Z0-9_]*(?:_API_KEY|_TOKEN|_SECRET|_ACCESS_KEY|_ACCESS_KEY_ID)\b/g;
const AUTH_HEADER = /authorization|api[-_]?key|token|secret/i;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Variable names a config string references: ${VAR}, ${VAR:-default}, $VAR.
export function refsIn(value) {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] ?? m[2]);
}

const literal = (v) => typeof v === 'string' && v.trim() !== '' && refsIn(v).length === 0;

// Masks anything that looks like a credential in command output shown to the page.
export function redact(text) {
  return String(text ?? '')
    .replace(/((?:bearer|token|key|secret|password)\S*(?:\s*[:=]\s*|\s+))\S+/gi, '$1•••')
    .replace(/[A-Za-z0-9_\-]{24,}/g, '•••');
}

// What HQ keeps of one MCP server config: names and flags, never a value.
export function describeServer(name, cfg, { harness, source, file }) {
  const needs = new Set();
  const literals = [];
  for (const s of [cfg?.url, cfg?.command, ...(Array.isArray(cfg?.args) ? cfg.args : [])]) for (const r of refsIn(s)) needs.add(r);
  const headers = { ...(isObj(cfg?.headers) ? cfg.headers : {}), ...(isObj(cfg?.http_headers) ? cfg.http_headers : {}) };
  for (const [h, v] of Object.entries(headers)) {
    for (const r of refsIn(v)) needs.add(r);
    if (AUTH_HEADER.test(h) && literal(v)) literals.push({ where: `header ${h}` });
  }
  for (const [k, v] of Object.entries(isObj(cfg?.env) ? cfg.env : {})) {
    for (const r of refsIn(v)) needs.add(r);
    if (KEY_RE.test(k) && literal(v)) literals.push({ where: `env ${k}`, key: k });
  }
  const bearer = typeof cfg?.bearer_token_env_var === 'string' ? cfg.bearer_token_env_var : undefined;
  if (bearer) needs.add(bearer);
  for (const v of Array.isArray(cfg?.env_vars) ? cfg.env_vars : []) if (typeof v === 'string') needs.add(v);
  for (const v of Object.values(isObj(cfg?.env_http_headers) ? cfg.env_http_headers : {})) if (typeof v === 'string') needs.add(v);
  const http = typeof cfg?.url === 'string' || cfg?.type === 'http' || cfg?.type === 'sse';
  return {
    name,
    harness,
    source,
    file,
    kind: http ? 'mcp-http' : 'mcp-stdio',
    needs: [...needs].filter((n) => KEY_RE.test(n) || n === bearer).sort(),
    literals,
    hasAuth: needs.size > 0 || Object.keys(headers).some((h) => AUTH_HEADER.test(h)),
  };
}

const SERVICES = [
  ['EXA', 'Exa'], ['PARALLEL', 'Parallel'], ['OPENAI', 'OpenAI'], ['ANTHROPIC', 'Anthropic'], ['GITHUB', 'GitHub'], ['GH', 'GitHub'],
  ['LINEAR', 'Linear'], ['SENTRY', 'Sentry'], ['STRIPE', 'Stripe'], ['SUPABASE', 'Supabase'], ['VERCEL', 'Vercel'], ['GEMINI', 'Google'],
  ['GOOGLE', 'Google'], ['PERPLEXITY', 'Perplexity'], ['FIRECRAWL', 'Firecrawl'], ['TAVILY', 'Tavily'], ['BRAVE', 'Brave'],
  ['SERPER', 'Serper'], ['ELEVENLABS', 'ElevenLabs'], ['REPLICATE', 'Replicate'], ['HF', 'Hugging Face'], ['HUGGINGFACE', 'Hugging Face'], ['AWS', 'AWS'],
];

export function serviceFor(key) {
  for (const [p, label] of SERVICES) if (key === p || key.startsWith(`${p}_`)) return label;
  return key;
}

const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '_');

function resolveOpts(o = {}) {
  return { home: o.home ?? homedir(), relayHome: o.relayHome ?? defaultRelayHome(), env: o.env ?? process.env, relayRoot: o.relayRoot ?? RELAY_ROOT };
}

const hqFile = (relayHome, name) => join(relayHome, 'hq', name);

function readHq(relayHome, name) {
  const r = readJsonFile(hqFile(relayHome, name));
  return r.ok && isObj(r.value) ? r.value : {};
}

function writeHq(relayHome, name, data) {
  const path = hqFile(relayHome, name);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

// Servers and unreadable-file widgets found on disk: { servers: [describeServer], files: [widget] }.
function diskServers({ home }) {
  const paths = harnessPaths(home);
  const servers = [];
  const files = [];
  const bad = (harness, source, file, error) =>
    files.push({ id: `${harness}:unreadable:${file}`, name: basename(file), kind: 'file', harness, source, file, status: 'unreadable', error });
  const take = (map, ctx) => {
    for (const [name, cfg] of Object.entries(map)) if (isObj(cfg)) servers.push(describeServer(name, cfg, ctx));
  };
  const readJsonServers = (file, ctx, pick) => {
    const r = readJsonFile(file);
    if (r.missing) return undefined;
    if (!r.ok) return bad(ctx.harness, ctx.source, file, r.error);
    const map = pick(r.value);
    if (isObj(map)) take(map, ctx);
    return map;
  };

  readJsonServers(paths.claudeJson, { harness: 'claude', source: 'user', file: paths.claudeJson }, (v) => v?.mcpServers);
  for (const p of installedPlugins(paths)) {
    const mcp = join(p.installPath, '.mcp.json');
    readJsonServers(mcp, { harness: 'claude', source: p.name, file: mcp }, (v) => (isObj(v?.mcpServers) ? v.mcpServers : v));
    const manifest = join(p.installPath, '.claude-plugin', 'plugin.json');
    const r = readJsonFile(manifest);
    if (r.missing) continue;
    if (!r.ok) {
      bad('claude', p.name, manifest, r.error);
      continue;
    }
    const m = r.value?.mcpServers;
    if (isObj(m)) take(m, { harness: 'claude', source: p.name, file: manifest });
    else if (typeof m === 'string') {
      const target = resolve(p.installPath, m);
      if (target === p.installPath || target.startsWith(p.installPath + '/') || target.startsWith(p.installPath + '\\')) {
        readJsonServers(target, { harness: 'claude', source: p.name, file: target }, (v) => (isObj(v?.mcpServers) ? v.mcpServers : v));
      }
    }
  }
  const t = readTomlFile(paths.codexConfig);
  if (!t.missing) {
    if (!t.ok) bad('codex', 'codex', paths.codexConfig, t.error);
    else if (isObj(t.value?.mcp_servers)) take(t.value.mcp_servers, { harness: 'codex', source: 'codex', file: paths.codexConfig });
  }
  return { servers, files };
}

function keyLookup({ home, env }) {
  const s = readJsonFile(harnessPaths(home).claudeSettings);
  const settingsEnv = s.ok && isObj(s.value?.env) ? s.value.env : {};
  const filled = (v) => typeof v === 'string' && v !== '';
  return {
    settingsNames: Object.keys(settingsEnv).filter((k) => filled(settingsEnv[k])),
    setIn: (name) => (filled(env[name]) ? 'environment' : filled(settingsEnv[name]) ? '~/.claude/settings.json' : ''),
  };
}

function initialsOf(label) {
  const words = String(label)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const s = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return s.toUpperCase();
}

const matchesId = (id, name, source) => norm(id) === norm(name) || norm(id) === norm(`plugin_${source}_${name}`);

export function brainConnectors(o) {
  const opts = resolveOpts(o);
  const { servers, files } = diskServers(opts);
  const lookup = keyLookup(opts);
  const snaps = readHq(opts.relayHome, 'connectors.json');
  const verifyFile = readHq(opts.relayHome, 'verify.json');
  const verifyFor = (harness, name, source) => {
    const map = isObj(verifyFile[harness]?.servers) ? verifyFile[harness].servers : {};
    for (const [k, v] of Object.entries(map)) if (matchesId(k, name, source)) return v;
    return undefined;
  };

  const connectors = [];
  const used = new Set();
  for (const s of servers) {
    const snapServers = Array.isArray(snaps[s.harness]?.servers) ? snaps[s.harness].servers : [];
    const snap = snapServers.find((x) => typeof x?.id === 'string' && matchesId(x.id, s.name, s.source));
    if (snap) used.add(snap);
    const verify = verifyFor(s.harness, s.name, s.source);
    let status = 'configured';
    let hint;
    if (s.needs.some((n) => !lookup.setIn(n))) status = 'key-missing';
    else if (s.literals.length > 0) status = 'in-file';
    else if (verify === 'needs-auth' && s.kind === 'mcp-http' && !s.hasAuth) {
      status = 'needs-auth';
      hint = '/mcp';
    } else if (snap || verify === 'connected') status = 'connected';
    connectors.push({
      id: `${s.harness}:${s.source}:${s.name}`,
      name: s.name,
      label: s.name,
      initials: initialsOf(s.name),
      harness: s.harness,
      kind: s.kind,
      source: s.source,
      file: s.file,
      status,
      tools: snap?.tools ?? null,
      keys: s.needs,
      recordedAt: snap ? snaps[s.harness].recordedAt ?? null : null,
      labelInferred: false,
      verify: verify ?? null,
      hint: hint ?? null,
    });
  }
  for (const harness of ['claude', 'codex']) {
    const list = Array.isArray(snaps[harness]?.servers) ? snaps[harness].servers : [];
    for (const x of list) {
      if (typeof x?.id !== 'string' || used.has(x)) continue;
      const label = typeof x.label === 'string' && x.label ? x.label : x.id;
      connectors.push({
        id: `${harness}:session:${x.id}`,
        name: label,
        label,
        initials: initialsOf(label),
        harness,
        kind: 'account',
        source: x.id.startsWith('claude_ai_') ? 'claude.ai' : 'session',
        file: null,
        status: 'connected',
        tools: x.tools ?? null,
        keys: [],
        recordedAt: snaps[harness].recordedAt ?? null,
        labelInferred: x.labelInferred === true,
        verify: verifyFor(harness, x.id, 'session') ?? null,
        hint: null,
      });
    }
  }
  connectors.push(...files);

  const cards = keyCards(opts, servers, lookup);
  const times = (m) => (typeof m?.verifiedAt === 'string' ? m.verifiedAt : null);
  const verifiedAt = [times(verifyFile.claude), times(verifyFile.codex)].filter(Boolean).sort().pop() ?? null;
  return {
    connectors,
    connections: cards.filter((c) => !c.header).map((c) => ({ service: c.service, key: c.name, status: c.status, usedBy: c.neededBy.map((n) => n.name) })),
    snapshots: { claude: snaps.claude?.recordedAt ?? null, codex: snaps.codex?.recordedAt ?? null },
    verifiedAt,
  };
}

const HARNESS_ENV = /^(CLAUDE_CODE_|CLAUDECODE|CODEX_)/;

function keyCards(opts, servers, lookup) {
  const cards = new Map();
  const card = (name, header = false) => {
    if (!cards.has(name)) cards.set(name, { name, service: serviceFor(name), setIn: '', neededBy: [], literalIn: '', header });
    return cards.get(name);
  };
  for (const [k, v] of Object.entries(opts.env)) if (KEY_RE.test(k) && typeof v === 'string' && v !== '') card(k);
  for (const k of lookup.settingsNames) if (KEY_RE.test(k)) card(k);
  const fromEnvOnly = new Set([...cards.keys()].filter((k) => !lookup.settingsNames.includes(k)));
  for (const s of servers) {
    for (const n of s.needs) card(n).neededBy.push({ kind: 'mcp', name: s.name, harness: s.harness, file: s.file });
    for (const l of s.literals) {
      const c = l.key ? card(l.key) : card(`${l.where.replace(/^header /, '')} header (${s.name})`, true);
      c.literalIn = s.file;
    }
  }
  for (const f of skillFiles(opts)) {
    let text;
    try {
      text = readFileSync(f.file, 'utf8');
    } catch {
      continue;
    }
    for (const n of new Set(text.match(KEY_IN_TEXT) ?? [])) card(n).neededBy.push({ kind: 'skill', name: f.name, harness: f.harness.join(','), file: f.file });
  }
  // Names the harness sets for itself are not API keys unless something needs them.
  for (const [name, c] of cards) if (fromEnvOnly.has(name) && HARNESS_ENV.test(name) && !c.neededBy.length && !c.literalIn) cards.delete(name);
  const order = { 'in-file': 0, missing: 1, set: 2 };
  const out = [...cards.values()].map((c) => {
    c.setIn = lookup.setIn(c.name);
    c.status = c.literalIn ? 'in-file' : c.setIn ? 'set' : 'missing';
    if (c.name === 'ANTHROPIC_API_KEY' && c.setIn) c.warning = 'Claude Code bills this key instead of your subscription while it is set.';
    return c;
  });
  return out.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

export function brainKeys(o) {
  const opts = resolveOpts(o);
  const { servers } = diskServers(opts);
  const cards = keyCards(opts, servers, keyLookup(opts));
  return {
    keys: cards.map((c) => ({
      name: c.name,
      service: c.service,
      status: c.status,
      setIn: c.setIn,
      neededBy: c.neededBy,
      literalIn: c.literalIn,
      warning: c.warning ?? null,
    })),
  };
}

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

export function recordSnapshot(harness, data, { relayHome = defaultRelayHome() } = {}) {
  if (harness !== 'claude' && harness !== 'codex') throw fail('harness must be claude or codex', 400);
  const list = Array.isArray(data) ? data : data?.servers;
  if (!Array.isArray(list)) throw fail('servers must be an array', 400);
  const servers = [];
  for (const x of list) {
    if (!isObj(x) || typeof x.id !== 'string' || x.id === '' || x.id.length > 200) continue;
    const s = { id: x.id };
    if (typeof x.label === 'string' && x.label.length <= 200) s.label = x.label;
    if (typeof x.labelInferred === 'boolean') s.labelInferred = x.labelInferred;
    if (Number.isInteger(x.tools) && x.tools >= 0) s.tools = x.tools;
    servers.push(s);
  }
  const all = readHq(relayHome, 'connectors.json');
  all[harness] = { recordedAt: new Date().toISOString(), servers };
  writeHq(relayHome, 'connectors.json', all);
  return servers.length;
}

function parseList(output) {
  const servers = {};
  for (const line of output.split(/\r?\n/)) {
    const m = /^(.+?): .* - (.+)$/.exec(line.trim());
    if (!m) continue;
    const text = m[2];
    servers[m[1].trim()] = /needs auth|authenticat/i.test(text) ? 'needs-auth' : /connected/i.test(text) && !/fail|not connected/i.test(text) ? 'connected' : 'failed';
  }
  return servers;
}

async function listOutput(bin) {
  try {
    const { stdout, stderr } = await run(bin, ['mcp', 'list'], { timeout: 60000, maxBuffer: 4_000_000 });
    return `${stdout}\n${stderr}`;
  } catch (e) {
    return `${e?.stdout ?? ''}\n${e?.stderr ?? ''}`;
  }
}

export async function verifyConnectors({ env = process.env, relayHome = defaultRelayHome() } = {}) {
  const previous = readHq(relayHome, 'verify.json');
  const result = { ...previous };
  const bins = { claude: resolveClaudeBin(env), codex: onPath('codex', env) };
  for (const [harness, bin] of Object.entries(bins)) {
    if (!bin) continue;
    const output = await listOutput(bin);
    const servers = parseList(output);
    const parsed = Object.keys(servers).length > 0;
    result[harness] = {
      verifiedAt: new Date().toISOString(),
      servers: parsed ? servers : isObj(previous[harness]?.servers) ? previous[harness].servers : {},
      raw: parsed ? '' : redact(output).slice(0, 4000),
    };
  }
  writeHq(relayHome, 'verify.json', result);
  return result;
}
