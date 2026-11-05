// Explicit selection wins. CODEX_HOME alone is configuration, not a running session.
export function resolveHarness({ harness, codex, env = process.env } = {}) {
  const selected = harness ?? (codex ? 'codex' : undefined) ?? env.RELAY_HARNESS ?? (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID ? 'codex' : 'claude');
  if (!['claude', 'codex'].includes(selected)) throw new Error(`unknown harness "${selected}" (expected claude or codex)`);
  return selected;
}
