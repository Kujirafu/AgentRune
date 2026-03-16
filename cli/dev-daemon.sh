#!/bin/bash
# Dev daemon watchdog — keeps port 3457 daemon alive with latest code
# Uses exponential backoff: 5s → 10s → 20s → 40s → 60s (max)
# Resets backoff after daemon runs successfully for 2+ minutes
# Stops after 5 consecutive fast crashes (< 30s each) to prevent zombie storms
# Usage: bash cli/dev-daemon.sh
PORT=3457
DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$HOME/.agentrune"
WATCHDOG_PID_FILE="$STATE_DIR/watchdog.pid"
DAEMON_PID_FILE="$STATE_DIR/daemon.pid"
BACKOFF=5
MAX_BACKOFF=60
MIN_HEALTHY_SECS=120   # Reset backoff if daemon ran for at least this long
FAST_CRASH_SECS=30     # Crash within this many seconds = "fast crash"
MAX_FAST_CRASHES=5     # Stop watchdog after this many consecutive fast crashes
FAST_CRASH_COUNT=0

# ── Single-instance guard ──
# Prevent multiple watchdogs from fighting over the same port
if [ -f "$WATCHDOG_PID_FILE" ]; then
  OLD_WD_PID=$(cat "$WATCHDOG_PID_FILE" 2>/dev/null)
  if [ -n "$OLD_WD_PID" ]; then
    # Check if old watchdog is still alive (Windows: tasklist)
    if tasklist //FI "PID eq $OLD_WD_PID" //NH 2>/dev/null | grep -q "$OLD_WD_PID"; then
      echo "[watchdog] ERROR: Another watchdog is already running (PID $OLD_WD_PID)"
      echo "[watchdog] Kill it first: taskkill /PID $OLD_WD_PID /T /F"
      exit 1
    fi
    echo "[watchdog] Stale watchdog PID file found (PID $OLD_WD_PID is dead), cleaning up"
  fi
fi

# Write our PID so safe-restart.sh can kill us
echo $$ > "$WATCHDOG_PID_FILE"

echo "[watchdog] Watchdog active (PID $$) — will auto-restart daemon on port $PORT if it crashes"

while true; do
  # Check if something is already listening on the port — tree-kill it
  PID=$(netstat -ano 2>/dev/null | grep ":${PORT}.*LISTEN" | awk '{print $5}' | head -1)
  if [ -n "$PID" ]; then
    echo "[watchdog] Port $PORT already in use by PID $PID, tree-killing..."
    taskkill //PID "$PID" //T //F 2>/dev/null
    sleep 2
  fi

  echo "[watchdog] Starting dev daemon on port $PORT..."
  START_TIME=$(date +%s)

  # Run daemon in background so we can capture its PID for cleanup
  cd "$DIR" && npx tsx src/bin.ts start --foreground --port "$PORT" 2>&1 &
  DAEMON_PID=$!
  echo "$DAEMON_PID" > "$DAEMON_PID_FILE"

  # Wait for daemon to exit
  wait $DAEMON_PID
  EXIT_CODE=$?
  END_TIME=$(date +%s)
  RUN_DURATION=$((END_TIME - START_TIME))

  # ── Post-exit cleanup: tree-kill daemon PID to catch orphaned children ──
  # This is the KEY fix: even if daemon exited and port is free,
  # its child processes (claude automation runners) may still be alive.
  # taskkill /T kills the entire process tree starting from DAEMON_PID.
  echo "[watchdog] Cleaning up daemon tree (PID $DAEMON_PID)..."
  taskkill //PID "$DAEMON_PID" //T //F 2>/dev/null
  rm -f "$DAEMON_PID_FILE"

  # Track consecutive fast crashes
  if [ "$RUN_DURATION" -ge "$MIN_HEALTHY_SECS" ]; then
    BACKOFF=5
    FAST_CRASH_COUNT=0  # Healthy run — reset everything
  elif [ "$RUN_DURATION" -lt "$FAST_CRASH_SECS" ]; then
    FAST_CRASH_COUNT=$((FAST_CRASH_COUNT + 1))
    echo "[watchdog] Fast crash #${FAST_CRASH_COUNT}/${MAX_FAST_CRASHES} (ran only ${RUN_DURATION}s)"
    if [ "$FAST_CRASH_COUNT" -ge "$MAX_FAST_CRASHES" ]; then
      echo "[watchdog] FATAL: ${MAX_FAST_CRASHES} consecutive fast crashes — stopping watchdog to prevent zombie storm"
      echo "[watchdog] Fix the underlying issue, then restart: bash cli/dev-daemon.sh"
      rm -f "$WATCHDOG_PID_FILE"
      exit 1
    fi
  fi

  echo "[watchdog] Daemon exited (code $EXIT_CODE, ran ${RUN_DURATION}s), auto-restarting in ${BACKOFF}s..."
  sleep "$BACKOFF"

  # Exponential backoff: double the wait time, cap at MAX_BACKOFF
  BACKOFF=$((BACKOFF * 2))
  if [ "$BACKOFF" -gt "$MAX_BACKOFF" ]; then
    BACKOFF=$MAX_BACKOFF
  fi
done
