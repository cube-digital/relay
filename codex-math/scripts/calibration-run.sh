#!/usr/bin/env bash
# One calibration run: read the account's limits, run a fixed task with codex exec on one model, read the limits again.
#
#   codex-math/scripts/calibration-run.sh <label> <model> <effort> <units> <workdir> <prompt-file> [speed]
#
# Writes codex-math/evidence/live/runs/<label>/{before.json,events.jsonl,after.json,meta.json,last-message.md}.
# <units> is the task's declared relay weight (3 for the standard mid task, 1 for the small cheap task).
# [speed] standard|fast sets service_tier for the run (default standard). CODEX_EXEC_TIMEOUT (seconds, default 1800) bounds the run.
set -euo pipefail
label=$1; model=$2; effort=$3; units=$4; workdir=$5; prompt_file=$6; speed=${7:-standard}
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/evidence/live/runs/$label"
mkdir -p "$out"
probe="$root/scripts/app-server-probe.mjs"

node "$probe" --out "$out" --label before >/dev/null
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
t0=$(date +%s)
tier_args=(-c "model_reasoning_effort=\"$effort\"")
if [ "$speed" = "fast" ]; then tier_args+=(-c 'service_tier="priority"'); fi
set +e
timeout "${CODEX_EXEC_TIMEOUT:-1800}" codex exec --json -m "$model" "${tier_args[@]}" -s workspace-write -C "$workdir" --skip-git-repo-check \
  -o "$out/last-message.md" "$(cat "$prompt_file")" < /dev/null > "$out/events.jsonl" 2> "$out/stderr.log"   # stdin closed: exec appends piped stdin to the prompt and would wait for it
status=$?
set -e
t1=$(date +%s)
finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)
thread=$(grep -m1 '"thread.started"' "$out/events.jsonl" | sed -E 's/.*"thread_id":"([^"]+)".*/\1/' || true)
sleep 20   # let the backend's thread estimate settle before reading it
node "$probe" --out "$out" --label after ${thread:+--threads "$thread"} >/dev/null
usage=$(grep '"turn.completed"' "$out/events.jsonl" | tail -1 || true)
cat > "$out/meta.json" <<JSON
{"label":"$label","model":"$model","effort":"$effort","speed":"$speed","units":$units,"workdir":"$workdir","prompt":"$(basename "$prompt_file")","threadId":"$thread","startedAt":"$started","finishedAt":"$finished","wallSeconds":$((t1 - t0)),"exitStatus":$status,"turnCompleted":${usage:-null}}
JSON
# a small, reproducible change set per run: revert the scratch repo so the next model starts from the same state
git -C "$workdir" checkout -- . >/dev/null 2>&1 || true
git -C "$workdir" clean -fdq >/dev/null 2>&1 || true
echo "$label: exit $status, thread $thread, ${t1}-${t0}s → $out"
