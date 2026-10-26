import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fromAppServer } from '../codex-math/lib/windows.mjs';

export function resolveCodexBin({ codexBin, env = process.env } = {}) {
  const explicit = codexBin ?? env.RELAY_CODEX_BIN;
  if (explicit) return explicit;
  const candidates = [...(env.PATH ?? '').split(delimiter).filter(Boolean).map(p => join(p, 'codex')), '/Applications/Codex.app/Contents/Resources/codex', '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', join(homedir(), 'Applications/Codex.app/Contents/Resources/codex'), join(homedir(), 'Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'), join(env.CODEX_HOME || join(homedir(), '.codex'), 'plugins/.plugin-appserver/codex-cli/bin/codex')];
  for (const path of candidates) { try { accessSync(path, constants.X_OK); return path; } catch {} }
  throw new Error('Codex executable unavailable (set RELAY_CODEX_BIN)');
}

// Documented stdio JSON-RPC handshake; no turns, authentication changes, or credit calls.
export function readCodexLimits({ timeoutMs = 2500, codexBin, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(resolveCodexBin({ codexBin, env }), ['app-server'], { env, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (err) { reject(err); return; }
    let done = false; let pending = ''; let bytes = 0;
    const finish = (err, value) => {
      if (done) return; done = true; clearTimeout(timer); child.stdin.destroy(); child.kill();
      const force = setTimeout(() => child.kill('SIGKILL'), 100);
      child.once('exit', () => clearTimeout(force));
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Codex rate-limit read timed out')), Math.min(Math.max(Number(timeoutMs) || 2500, 50), 10000));
    const send = msg => child.stdin.write(JSON.stringify(msg) + '\n');
    child.on('error', err => finish(err));
    child.stdin.on('error', err => finish(err));
    child.on('exit', () => finish(new Error('Codex app-server exited before its reading')));
    child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => {
      bytes += chunk.length; if (bytes > 2_000_000) { finish(new Error('Codex response too large')); return; }
      pending += chunk;
      let i;
      while (!done && (i = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, i); pending = pending.slice(i + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          if (msg.error) { finish(new Error('Codex initialization failed')); return; }
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'account/rateLimits/read', params: {} });
        } else if (msg.id === 2) {
          if (msg.error) { finish(new Error('Codex limits unavailable')); return; }
          const result = msg.result;
          const preferred = result?.rateLimitsByLimitId?.codex;
          let snapshot;
          try { snapshot = fromAppServer(preferred ? {...result, rateLimits:preferred} : result); }
          catch { finish(new Error('Codex returned invalid rate limits')); return; }
          if (snapshot?.windows?.some(w => !Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100 || w.windowMinutes !== undefined && !(Number.isFinite(w.windowMinutes) && w.windowMinutes > 0) || w.resetsAt !== undefined && !Number.isFinite(Date.parse(w.resetsAt))) || !snapshot?.windows?.length && !snapshot?.reached) finish(new Error('Codex returned no usage windows'));
          else finish(undefined, snapshot);
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'relay', version: '0.3.0' }, capabilities: { experimentalApi: false } } });
  });
}
