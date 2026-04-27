#!/usr/bin/env bash
#
# run-with-progress.sh — Run a long command, stream live progress events.
#
# Purpose
#   The build UI shows a per-stage timeline. For stages that take minutes
#   (install / bundle / gradle), users need to see the build is alive and
#   what step inside the stage is running right now. This wrapper runs the
#   inner command, tees its output to the GitHub Actions log AND a tail
#   file, and periodically emits "progress" rows to public.build_events
#   with the latest line of output.
#
# Usage
#   run-with-progress.sh <stage-name> <interval-seconds> -- <command...>
#
# Requires
#   /tmp/log_event.sh   present (staged earlier in the workflow)
#
# Exit codes
#   The exit code of <command> is propagated.
#
set -uo pipefail

STAGE="${1:-}"; INTERVAL="${2:-20}"; shift 2 || true
if [ "${1:-}" = "--" ]; then shift; fi
if [ -z "$STAGE" ] || [ "$#" -eq 0 ]; then
  echo "[progress] usage: run-with-progress.sh <stage> <interval> -- <command...>" >&2
  exit 64
fi

LOG="/tmp/${STAGE}-stream.log"; ALIVE="/tmp/${STAGE}.alive"
: > "$LOG"; touch "$ALIVE"

emit_loop() {
  local count=0
  while [ -f "$ALIVE" ]; do
    sleep "$INTERVAL"
    [ -f "$ALIVE" ] || break
    count=$((count + 1))
    local line
    line=$(tail -1 "$LOG" 2>/dev/null | tr -d '\r' | head -c 220)
    [ -n "$line" ] || line="(working… ${count} × ${INTERVAL}s)"
    if command -v /tmp/log_event.sh >/dev/null 2>&1 && [ -x /tmp/log_event.sh ]; then
      /tmp/log_event.sh "$STAGE" "progress" "$line" >/dev/null 2>&1 || true
    fi
  done
}

emit_loop &
EMIT_PID=$!

set +e
"$@" 2>&1 | tee -a "$LOG"
RC=${PIPESTATUS[0]}
set -e

rm -f "$ALIVE"
wait "$EMIT_PID" 2>/dev/null || true

exit "$RC"
