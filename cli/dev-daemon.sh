#!/bin/bash
# Dev daemon watchdog -- keeps port 3457 daemon alive with latest code
# Uses exponential backoff: 5s -> 10s -> 20s -> 40s -> 60s (max)
# Resets backoff after daemon runs successfully for 2+ minutes
# Stops after 5 consecutive fast crashes (< 30s each) to prevent zombie storms
# Usage: bash cli/dev-daemon.sh

PORT=3457
DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$DIR/watchdog-common.sh"
WATCHDOG_LABEL="watchdog"
WATCHDOG_PATTERN='dev-daemon\.sh'
BACKOFF=5
MAX_BACKOFF=60
MIN_HEALTHY_SECS=120
FAST_CRASH_SECS=30
MAX_FAST_CRASHES=5
FAST_CRASH_COUNT=0

if [ ! -f "$HELPER" ]; then
  echo "[watchdog] ERROR: Missing helper script: $HELPER"
  exit 1
fi

# shellcheck source=/dev/null
. "$HELPER"

WATCHDOG_PID_FILE="$(watchdog_pid_file_for_port "$PORT")"
LEGACY_WATCHDOG_PID_FILE="$(legacy_watchdog_pid_file_for_port "$PORT")"
DAEMON_PID_FILE="$(daemon_pid_file_for_port "$PORT")"

cleanup_watchdog() {
  local exit_code=$?
  kill_tracked_daemon_tree "$DAEMON_PID_FILE"
  release_watchdog_pid_lock "$WATCHDOG_PID_FILE" "$LEGACY_WATCHDOG_PID_FILE"
  exit "$exit_code"
}

trap 'cleanup_watchdog' EXIT
trap 'exit 0' INT TERM

if ! claim_watchdog_pid_lock "$WATCHDOG_PID_FILE" "$WATCHDOG_LABEL" "$WATCHDOG_PATTERN" "$LEGACY_WATCHDOG_PID_FILE"; then
  exit 1
fi

echo "[watchdog] Watchdog active (PID $$) -- will auto-restart daemon on port $PORT if it crashes"

while true; do
  assert_watchdog_lock_owner "$WATCHDOG_PID_FILE" "$WATCHDOG_LABEL" || exit 0
  kill_port_listener_tree "$PORT" "$WATCHDOG_LABEL"
  assert_watchdog_lock_owner "$WATCHDOG_PID_FILE" "$WATCHDOG_LABEL" || exit 0

  echo "[watchdog] Starting dev daemon on port $PORT..."
  START_TIME=$(date +%s)

  (
    cd "$DIR" || exit 1
    exec npx tsx src/bin.ts start --foreground --port "$PORT"
  ) 2>&1 &
  DAEMON_PID=$!
  write_pid_file_value "$DAEMON_PID_FILE" "$DAEMON_PID" "$WATCHDOG_LABEL"

  wait $DAEMON_PID
  EXIT_CODE=$?
  END_TIME=$(date +%s)
  RUN_DURATION=$((END_TIME - START_TIME))

  echo "[watchdog] Cleaning up daemon tree (PID $DAEMON_PID)..."
  tree_kill_pid "$DAEMON_PID"
  clear_pid_file_if_owned_by "$DAEMON_PID_FILE" "$DAEMON_PID"
  DAEMON_PID=""
  assert_watchdog_lock_owner "$WATCHDOG_PID_FILE" "$WATCHDOG_LABEL" || exit 0

  if [ "$RUN_DURATION" -ge "$MIN_HEALTHY_SECS" ]; then
    BACKOFF=5
    FAST_CRASH_COUNT=0
  elif [ "$RUN_DURATION" -lt "$FAST_CRASH_SECS" ]; then
    FAST_CRASH_COUNT=$((FAST_CRASH_COUNT + 1))
    echo "[watchdog] Fast crash #${FAST_CRASH_COUNT}/${MAX_FAST_CRASHES} (ran only ${RUN_DURATION}s)"
    if [ "$FAST_CRASH_COUNT" -ge "$MAX_FAST_CRASHES" ]; then
      echo "[watchdog] FATAL: ${MAX_FAST_CRASHES} consecutive fast crashes -- stopping watchdog to prevent zombie storm"
      echo "[watchdog] Fix the underlying issue, then restart: bash cli/dev-daemon.sh"
      exit 1
    fi
  fi

  echo "[watchdog] Daemon exited (code $EXIT_CODE, ran ${RUN_DURATION}s), auto-restarting in ${BACKOFF}s..."
  sleep "$BACKOFF"

  BACKOFF=$((BACKOFF * 2))
  if [ "$BACKOFF" -gt "$MAX_BACKOFF" ]; then
    BACKOFF=$MAX_BACKOFF
  fi
done
