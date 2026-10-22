// Drive REA's MCP stdio server with one Ghidra session: open the binary, run the runbook's lookups, save every result.
//   node rea-driver.mjs <binary> <outdir> <lea-hits.json> <mul9div10-hits.json>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const [bin, out, leaFile, mulFile] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const logf = join(out, 'driver.log');
const log = (s) => { const line = `[${new Date().toISOString()}] ${s}\n`; appendFileSync(logf, line); process.stdout.write(line); };
const child = spawn('rea', ['--mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; const pending = new Map(); let id = 1;
child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; try { const m = JSON.parse(line); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} } });
child.stderr.on('data', (d) => appendFileSync(join(out, 'rea-stderr.log'), d));
child.on('exit', (c) => log(`rea exited ${c}`));
const req = (method, params = {}) => new Promise((res) => { const i = id++; pending.set(i, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
const parseContent = (r) => { const c = r.result?.content?.[0]?.text; if (!c) return r; try { return { ...r, parsed: JSON.parse(c) }; } catch { return r; } };
const call = async (name, args, file) => {
  const t0 = Date.now();
  const r = parseContent(await req('tools/call', { name, arguments: args }));
  writeFileSync(join(out, file), JSON.stringify({ tool: name, arguments: args, seconds: (Date.now() - t0) / 1000, response: r.parsed ?? r.result ?? r.error }, null, 1));
  log(`${name} ${JSON.stringify(args).slice(0, 120)} → ${file} (${((Date.now() - t0) / 1000).toFixed(0)} s, ${r.error ? 'error ' + JSON.stringify(r.error).slice(0, 200) : r.result?.isError ? 'isError' : 'ok'})`);
  return r.parsed ?? r.result;
};
await req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'relay-codex-math', version: '0.1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
log('opening binary with ghidra provider');
const open = await call('open_binary', { path: bin, provider_id: 'ghidra' }, 'open_binary.json');
if (!open || open.error || open.isError) { log('open failed; stopping'); child.kill(); process.exit(1); }
await call('binary_overview', {}, 'binary_overview.json');
await call('search_strings', { pattern: 'context_window.rs', mode: 'literal' }, 'search-context_window.json');
await call('search_strings', { pattern: 'multi_agents_v2/spawn.rs', mode: 'literal' }, 'search-spawn.json');
await call('search_strings', { pattern: 'max_concurrent_threads_per_session', mode: 'literal' }, 'search-max_concurrent.json');
const anchors = { '0x0e538cf9': 'auto-compact-prefix', '0x0e5388ff': 'compact-exceeded', '0x0e5677ba': 'debug-config-agents', '0x0e6c33bf': 'max-concurrent-key', '0x0eaf830a': 'agent-limit-reached', '0x0e538908': 'spawn-region', '0x0e6bd584': 'v2-must-be-at-least-1-a', '0x0e6bd699': 'agents-must-be-at-least-1-a', '0x0e78811b': 'v2-must-be-at-least-1-b', '0x0e788230': 'agents-must-be-at-least-1-b', '0x0e88788b': 'v2-must-be-at-least-1-c', '0x0e8879a0': 'agents-must-be-at-least-1-c' };
for (const [addr, name] of Object.entries(anchors)) await call('xrefs', { address: addr }, `xrefs-${name}.json`);
const lea = JSON.parse(readFileSync(leaFile, 'utf8'));
const mul = JSON.parse(readFileSync(mulFile, 'utf8'));
const sites = new Map();
for (const [addr, xs] of Object.entries(lea)) for (const x of xs) sites.set(x.insn, `ref-to-${anchors[addr] ?? addr}`);
for (const s of mul.sites) sites.set(s.movabs, 'mul9div10');
const procs = new Map();
for (const [insn, why] of sites) {
  const r = await call('resolve_containing_procedure', { address: insn }, `resolve-${insn}.json`);
  const p = r?.procedure ?? r?.result?.procedure ?? r?.normalized_result?.procedure ?? r?.address ?? null;
  const key = JSON.stringify(p ?? r).slice(0, 200);
  if (!procs.has(key)) procs.set(key, { procedure: p, raw: r, why: new Set() });
  procs.get(key).why.add(`${why}@${insn}`);
}
writeFileSync(join(out, 'procedures.json'), JSON.stringify([...procs.values()].map((v) => ({ procedure: v.procedure, why: [...v.why] })), null, 1));
let n = 0;
for (const v of procs.values()) {
  const p = v.procedure?.address ?? v.procedure?.entry ?? v.procedure?.name ?? v.procedure;
  if (!p) continue;
  const tag = String(p).replace(/[^0-9a-zA-Z_]/g, '_');
  await call('procedure_pseudo_code', { procedure: String(p) }, `decompile-${tag}.json`);
  await call('procedure_info', { procedure: String(p) }, `function-${tag}.json`);
  if (++n > 40) break;
}
await call('close_binary', { snapshot_path: join(out, 'snapshot.json'), overwrite: true }, 'close_binary.json');
log('done');
child.kill();
