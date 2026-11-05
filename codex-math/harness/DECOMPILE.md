# Recovering the two numbers the strings do not hold

> **Done on 2026-10-22** without a decompiler engine (REA's Ghidra provider ran out of memory on the 297 MB binary): both numbers were read at the instruction level and cross-checked against the open-source tag `rust-v0.163.0`. Results: `../evidence/decompile/README.md` (compaction = context window × 9/10 = 244,800 tokens; concurrency default 4 threads including the root = 3 children), scripts in `../scripts/decompile/`, folded into `../config/codex-harness.json` and `FINDINGS.md` §3, §4, §8. The runbook below still applies to a future binary.

Two harness defaults are computed in code and were not recovered from the string table: the default auto-compaction threshold (`model_auto_compact_token_limit` when unset; the catalog has `auto_compact_token_limit: null` for every model) and the default subagent concurrency (`agents.max_concurrent_threads_per_session` when unset). Both need a decompiler. This is the runbook for doing it with REA and IDA on a machine that has them; the outputs go into `codex-math/evidence/decompile/` so the findings can be updated from them.

The binary is `node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex` (0.163.0, SHA-256 `399ff69c…c4215`; `npm pack @openai/codex@0.163.0-linux-x64` gets the same file). It is a static-pie ELF whose virtual addresses equal file offsets, so every offset cited in `FINDINGS.md` is also an IDA address with image base 0.

## 1. Register IDA with REA

Install [mrexodia/ida-pro-mcp](https://github.com/mrexodia/ida-pro-mcp) (IDA Pro, headless `idalib` supervisor) or [0xshlomil/ida-free-mcp](https://github.com/0xshlomil/ida-free-mcp) (IDA Free, attached GUI) per their instructions, write the registration JSON REA expects (`docs/ida-provider.md` in the REA repo, "Give REA a target"), then:

```bash
export REA_IDA_MCP_CONFIG=/absolute/path/to/ida-mcp.json
rea doctor --provider ida --json
```

Auto-analysis of the 297 MB binary takes a while; raise `timeoutMs` in the registration (the default is 300000 ms) before the first open. In the attached (GUI) profile, open the original binary in IDA, let analysis finish, then run the commands below.

## 2. Auto-compaction default

The compaction code is `core/src/session/context_window.rs` and `core/src/compact.rs`; the strings nearby are "Context window exceeded while compacting; removing oldest history item" (0x0e5388ff) and the file-name prefix "auto-compact-" (0x0e538cf9). The threshold is derived from the model's `context_window` (272000) and `effective_context_window_percent` (95), so look for a function that reads the catalog's `auto_compact_token_limit` option, finds it absent, and multiplies the context window by a constant or subtracts a reserve.

```bash
BIN=/absolute/path/to/codex
rea search "$BIN" "context_window.rs" --provider ida --json > evidence/decompile/search-context_window.json
rea xrefs "$BIN" 0x0e538cf9 --provider ida --json > evidence/decompile/xrefs-auto-compact-prefix.json
rea xrefs "$BIN" 0x0e5388ff --provider ida --json > evidence/decompile/xrefs-compact-exceeded.json
# for every referencing function reported above:
rea decompile "$BIN" 0x<function address> --provider ida --json > evidence/decompile/decompile-<address>.json
rea function  "$BIN" 0x<function address> --provider ida --json > evidence/decompile/function-<address>.json
```

What to look for in the pseudocode: a comparison of the running token total against a value built from `272000` (0x42680), `258400` (0x3F160) or a percentage; integer constants such as `0.9` as a float, `90`, or a fixed reserve (powers of two near 16384 = 0x4000 are the token-budget fallback buffer, a different mechanism). Record the constant and the expression.

## 3. Subagent concurrency default

The config key strings are at 0x0e6c33bf (`max_concurrent_threads_per_session`) and the `/debug-config` printer at 0x0e5677ba. The limit is enforced where `AgentLimitReached` (0x0eaf830a) is produced, in the multi-agent v2 spawn handler (`core/src/tools/handlers/multi_agents_v2/spawn.rs`, string at 0x0e538908 region).

```bash
rea search "$BIN" "multi_agents_v2/spawn.rs" --provider ida --json > evidence/decompile/search-spawn.json
rea xrefs "$BIN" 0x0e5677ba --provider ida --json > evidence/decompile/xrefs-debug-config-agents.json
rea trace "$BIN" "AgentLimitReached" --provider ida --json > evidence/decompile/trace-agent-limit.json
# decompile the function that compares the live agent count against a limit:
rea decompile "$BIN" 0x<function address> --provider ida --json > evidence/decompile/decompile-spawn-limit.json
```

What to look for: `unwrap_or(N)` on the option — in the pseudocode an `if (opt_is_none) limit = N;` next to the comparison with the number of open child threads. Record N.

## 4. Hand the results back

Drop the JSON files in `codex-math/evidence/decompile/`, add one line per number to `codex-math/config/codex-harness.json` (`context.autoCompactDefault`, `multiAgent.config.agents.max_concurrent_threads_per_session`) with `evidence: "decompiled: <file>, function 0x…"`, and change the two "not recovered" sentences in `FINDINGS.md` §3, §4 and §8.

## Cheaper than decompiling

Both numbers can also be read from a logged-in run: start `codex app-server --listen stdio://`, send `initialize` and `thread/start`, then spawn agents in a turn until `AgentLimitReached` is returned (the count is the default); and watch `thread/compacted` or the TUI's "context remaining" against `thread/tokenUsage/updated` to see the token total at which compaction fired. A real session also supplies what matters more for the forecast than either default: live `used_percent` readings and thread credit estimates, which calibrate `Q_j` and the credits per unit.
