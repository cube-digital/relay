# Environment (phase A)

Collected 2026-10-22 on Marius's Linux machine (Ubuntu 24.04, kernel 6.8.0-147, x86_64, 20 CPUs, 13 GB RAM).

| Item | Value |
|---|---|
| `codex --version` at start | codex-cli 0.146.0 (standalone install, `~/.local/bin/codex` → `~/.codex/packages/standalone/releases/0.146.0-x86_64-unknown-linux-musl/bin/codex`) |
| `codex --version` for phases C–E | codex-cli 0.163.0, after `codex update` (standalone release `0.163.0-x86_64-unknown-linux-musl`). Reason: on 0.146.0 `account/usage/read { threadId }` fails with `Invalid request: invalid type: map, expected unit` (no per-thread credit estimate), `model/list` shows only gpt-5.6-sol/terra/luna and `account/read` reports `planType: "unknown"`. Marius allowed installing tools. 0.146.0 is still on disk under `packages/standalone/releases/`. |
| 0.163.0 binary | `~/.codex/packages/standalone/releases/0.163.0-x86_64-unknown-linux-musl/bin/codex`, 296 865 480 bytes, static-pie ELF, SHA-256 `399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215` — matches the hash in AGENT-PLAN.md. The same file was also obtained with `npm pack @openai/codex@0.163.0-linux-x64` (phase G). |
| `codex doctor` auth | auth storage mode File, `~/.codex/auth.json`, stored auth mode chatgpt, auth mode chatgpt, reachability mode ChatGPT auth → phases C–F possible |
| `codex doctor` notes | mcp: optional issues (missing MCP env vars); threads: rollout files missing from the state DB, duplicate thread inventory entries |
| `node --version` | v22.23.4 (`node:sqlite` available, prints an ExperimentalWarning) |
| `rea --version` | not installed at start; installed `rea-agents` 6.7.0 with `npm install -g --prefix ~/.local rea-agents` (`~/.local/bin/rea`). A source checkout of REA also sits in `~/Installs/rea` (unbuilt). |
| IDA | not installed: no `ida`, `ida64`, `idat`, `idat64` on PATH, no `~/idapro*` or `/opt/ida*`; `~/.idapro/` holds only `ida.reg` and `proccache.lst` (remnants, no binary or licence). Phase G therefore uses REA's Ghidra provider instead (Ghidra 12.1.4 extracted to `~/Installs/ghidra/ghidra_12.1.4_PUBLIC`, OpenJDK 21.0.12.1 with javac at `/usr/bin`). |
| `codex features list` | `features.txt` (0.163.0) and `features-0.146.0.txt` |
| `~/.codex/config.toml` | `config.toml.redacted` (one `api_key` line redacted). `model = "gpt-6.1-sol"`, `model_reasoning_effort = "high"`, `service_tier = "default"`; no `[agents]` section, no `max_concurrent_threads_per_session`, no `model_auto_compact_token_limit` → phase E runs with the default. |
| `~/.codex/hooks.json` | present (not read: the agent's permission classifier blocked reading it; nothing from it is in the evidence). If relay's Codex hooks are installed there, a `PreToolUse` hook could in principle rewrite spawns in phase E. |
| Account | ChatGPT, `c***@narrio.app`, `planType: self_serve_business_prolite` (0.163.0); single window `windowDurationMins: 10080` (weekly), `secondary: null`, `usedPercent: 24` at start, one unused "Full reset" credit (never used). |
