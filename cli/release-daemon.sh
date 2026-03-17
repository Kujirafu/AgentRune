#!/bin/bash
# Release daemon watchdog -- stable fallback daemon on port 3456
# Runs alongside dev-daemon.sh so app can fail over when dev goes down
# Uses exponential backoff: 3s -> 6s -> 12s -> 24s -> 60s (max)
# Resets backoff after daemon runs successfully for 2+ minutes
# Usage: bash cli/release-daemon.sh

PORT=3456
DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$DIR/watchdog-common.sh"
WATCHDOG_LABEL="release-watchdog"
WATCHDOG_PATTERN='release-daemon\.sh'
BACKOFF=3
MAX_BACKOFF=60
MIN_HEALTHY_SECS=120

if [ ! -f "$HELPER" ]; then
  echo "[release-watchdog] ERROR: Missing helper script: $HELPER"
  exit 1
fi

# shellcheck source=/dev/null
. "$HELPER"

WATCHDOG_PID_FILE="$(watchdog_pid_file_for_port "$PORT")"
DAEMON_PID_FILE="$(daemon_pid_file_for_port "$PORT")"

cleanup_watchdog() {
  local exit_code=$?
  kill_tracked_daemon_tree "$DAEMON_PID_FILE"
  release_watchdog_pid_lock "$WATCHDOG_PID_FILE"
  exit "$exit_code"
}

trap 'cleanup_watchdog' EXIT
trap 'exit 0' INT TERM

if ! claim_watchdog_pid_lock "$WATCHDOG_PID_FILE" "$WATCHDOG_LABEL" "$WATCHDOG_PATTERN"; then
  exit 1
fi

echo "[release-watchdog] Watchdog active (PID $$) -- guarding port $PORT"

while true; do
  assert_watchdog_lock_owner "$WATCHDOG_PID_FILE" "$WATCHDOG_LABEL" || exit 0
  kill_port_listener_tree "$PORT" "$WATCHDOG_LABEL"
  assert_watchdog_lock_owner "$WATCHDOG_PID_FILE" "$WATCHDOG_LABEL" || exit 0

  echo "[release-watchdog] Starting release daemon on port $PORT..."
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

  echo "[release-watchdog] Cleaning up daemon tree (PID $DAEMON_PID)..."
  tree_kill_pid "$DAEMON_PID"
  clear_pid_file_if_owned_by "$DAEMON_PID_FILE" "$DAEMON_PID"
  DAEMON_PID=""
  assert_watchdog_lock_owner "$WATCHDOG_PID_FILE" "$WATCHDOG_LABEL" || exit 0

  if [ "$RUN_DURATION" -ge "$MIN_HEALTHY_SECS" ]; then
    BACKOFF=3
  fi

  echo "[release-watchdog] Daemon exited (code $EXIT_CODE, ran ${RUN_DURATION}s), restarting in ${BACKOFF}s..."
  sleep "$BACKOFF"

  BACKOFF=$((BACKOFF * 2))
  if [ "$BACKOFF" -gt "$MAX_BACKOFF" ]; then
    BACKOFF=$MAX_BACKOFF
  fi
done
