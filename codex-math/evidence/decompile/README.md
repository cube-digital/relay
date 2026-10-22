# Phase G: the two compiled defaults (Codex 0.163.0, SHA-256 399ff69c…c4215)

Binary: `~/.codex/packages/standalone/releases/0.163.0-x86_64-unknown-linux-musl/bin/codex` (identical to the `npm pack @openai/codex@0.163.0-linux-x64` file). Static-pie ELF, image base 0, so file offsets are addresses.

## How the numbers were recovered

IDA is not installed on this machine, and REA's Ghidra provider (REA 6.7.0 + Ghidra 12.1.4, both installed for this) had to be aborted: the Ghidra JVM grew past 5.3 GB RSS during auto-analysis of the 297 MB binary on a 13 GB machine with 7.5 GB already used by desktop apps and the swap exhausted (`rea-attempt-aborted-oom/`). The driver that runs the runbook in one REA session is `codex-math/scripts/decompile/run-rea.sh` (+ `rea-driver.mjs`); run it on a machine with ≥ 16 GB free to get the pseudocode files the runbook asks for.

Instead, the same lookups were done without a decompiler, at the instruction level:

1. `lea-scan.py` finds every RIP-relative `lea`/`mov` whose target is one of the runbook's string addresses → `lea-hits.json` (the referencing instruction addresses). The strings at those offsets were checked with `dd` first.
2. `mul9div10-scan.py` finds every site of the i64 expression `(x * 9) / 10` (`lea r,[r+r*8]` followed by `movabs r,0x6666666666666667` + `imul`) → `mul9div10-hits.json`: only 5 sites in the whole binary.
3. `const-cluster-scan.py` finds code that holds the three multi-agent-v2 wait-timeout defaults (10 000, 3 600 000, 30 000 ms) together → `const-cluster-hits.json`.
4. `objdump -d -M intel` windows around each site → `objdump-windows*.txt`.
5. The Apache-2.0 source at tag `rust-v0.163.0` (commit 83086188ae0614bd882818ff1aa23f3194962012) was cloned and the matching functions read → `source-rust-v0.163.0-excerpts.md`. The binary and the source agree instruction for instruction.

## 1. Auto-compaction default: 90 % of the context window → 244 800 tokens for the gpt-6 models

Function: `ModelInfo::auto_compact_token_limit` (`codex-rs/protocol/src/openai_models.rs:529`), inlined at least five times; the cleanest copy is at **0x68aa194–0x68aa1ed** (`objdump-windows.txt`, "mul9div10 site 0x68aa1bb"), the others at 0x68aa1fe, 0x75e395c, 0x75e3b4f, 0x762316d.

```
68aa19c  mov rdi,[rsi]        ; context_window: Option<i64> (tag)
68aa19f  mov rax,[rsi+0x10]   ; max_context_window: Option<i64> (tag)
68aa1a3  or  rax,rdi ; je …   ; both None → no limit
68aa1b6  mov rax,[rsi+rax*1+0x8]  ; resolved_context_window() = context_window.or(max_context_window)
68aa1bb  lea rax,[rax+rax*8]      ; × 9
68aa1bf  movabs rcx,0x6666666666666667 ; imul rcx ; shr/sar/add  ; signed ÷ 10
68aa1da  mov r11,[rsi+0x28]   ; auto_compact_token_limit from the model catalog (Option<i64> payload)
68aa1de  cmp rdx,r11 ; cmovl r11,rdx   ; min(limit, context_limit)
68aa1e5  cmp byte [rsi+0x20],0 ; cmove r11,rdx  ; option None → context_limit
```

Expression: `limit = min(catalog.auto_compact_token_limit, resolved_context_window * 9 / 10)`, and with the catalog's `auto_compact_token_limit: null` (every model) it is **`context_window * 9 / 10`**. For `context_window` 272 000 that is **244 800** tokens. The user's `model_auto_compact_token_limit` overrides it only in the `BodyAfterPrefix` scope (`context_window.rs:70-75`); the separate hard cap `context_window * effective_context_window_percent / 100` (95 % → 258 400) is computed at `context_window.rs:84-86` and is not the compaction trigger. Confidence: high (source and binary agree; the constant 9/10 is a literal in both).

## 2. Subagent concurrency default: 4

Function: `resolve_multi_agent_v2_config` (`codex-rs/core/src/config/mod.rs:2813`), compiled as its own function at **0x75950f0** (`objdump-windows-resolve-v2.txt`, "cluster site 0x759527f").

```
7595111  cmp dword [rsi+0x1a68],4 ; je 759520b   ; config_toml.features.multi_agent_v2 is None →
759511e  mov rax,[rsi+0x1bc8] ; cmp rax,1 ; ja … ; cmp eax,1 ; jne …   ; its max_concurrent_threads_per_session: Some?
759513f  mov r15,[rsi+0x1bd0]                      ; → use it
…
759520b  xor ebx,ebx
759520d  mov r13,[rsi+0x1638] ; mov r15,[rsi+0x1640] ; agents.max_concurrent_threads_per_session (tag, value)
759522f  mov esi,0x4                               ; DEFAULT = 4
7595234  cmp r13,1 ; jne 7595248                   ; agents value absent → keep 4
759523a  inc r15 ; mov rsi,-1 ; cmovne rsi,r15     ; present → value.saturating_add(1)
7595263  mov [rsp+0x1c0],rsi                       ; MultiAgentV2Config.max_concurrent_threads_per_session
759526b  mov [rsp+0x1c8],0x2710 ; [rsp+0x1d0],0x36ee80 ; [rsp+0x1d8],0x7530   ; min/max/default wait ms = 10000/3600000/30000
7595248  movabs "collaboration" (0x6e6f697461726f62 / 0x726f62616c6c6f63), len 0xd   ; tool_namespace
```

Expression: `max_concurrent_threads_per_session = features.multi_agent_v2.max_concurrent_threads_per_session ?? (agents.max_concurrent_threads_per_session + 1, saturating) ?? 4`. The limit is enforced in `AgentRegistry::reserve_spawn_slot` → `try_increment_spawned(max_threads)` on the registry's **total** thread count (`registry.rs:90,333`), which is why a user-set `[agents] max_concurrent_threads_per_session = N` becomes N + 1 internally: the stored number counts the root thread too, so **N children** are allowed. With nothing set the internal value is 4, i.e. **3 live child threads** by this reading; phase E (`evidence/live/runs/09-spawn-limit`) is the empirical check. The validation `… must be at least 1` sites (`objdump-windows-validation.txt`) only test the resolved value against 0. Confidence: high for the constant 4 and the `+1` mapping (source and binary agree); medium for the "3 children" interpretation until phase E confirms it.
