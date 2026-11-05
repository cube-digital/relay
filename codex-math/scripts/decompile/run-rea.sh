#!/usr/bin/env bash
# Phase G: one REA/Ghidra session over the Codex 0.163.0 binary, results under codex-math/evidence/decompile/rea
export PATH=$HOME/.local/bin:$PATH
export GHIDRA_INSTALL_DIR=$HOME/Installs/ghidra/ghidra_12.1.4_PUBLIC
export GHIDRA_HEADLESS_MAXMEM=5G
export REA_GHIDRA_STARTUP_TIMEOUT_MS=14400000
export REA_GHIDRA_DISABLED_ANALYZERS="Decompiler Parameter ID,Decompiler Switch Analysis,Embedded Media,Non-Returning Functions - Discovered,Shared Return Calls,Create Address Tables"
cd /home/aleliuhin/Work/relay
exec node codex-math/scripts/decompile/rea-driver.mjs \
  "$HOME/.codex/packages/standalone/releases/0.163.0-x86_64-unknown-linux-musl/bin/codex" \
  codex-math/evidence/decompile/rea codex-math/evidence/decompile/lea-hits.json codex-math/evidence/decompile/mul9div10-hits.json
