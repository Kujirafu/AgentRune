#!/bin/bash
# Dev daemon watchdog — keeps port 3457 daemon alive with latest code
# If daemon crashes, watchdog auto-restarts it within 5 seconds.
# Usage: bash cli/dev-daemon.sh
PORT=3457
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[watchdog] Watchdog active — will auto-restart daemon on port $PORT if it crashes"

while true; do
  # Check if something is already listening on the port
  PID=$(netstat -ano 2>/dev/null | grep ":${PORT}.*LISTEN" | awk '{print $5}' | head -1)
  if [ -n "$PID" ]; then
    echo "[watchdog] Port $PORT already in use by PID $PID, killing..."
    taskkill //PID "$PID" //F 2>/dev/null
    sleep 2
  fi

  echo "[watchdog] Starting dev daemon on port $PORT..."
  cd "$DIR" && npx tsx src/bin.ts start --foreground --port "$PORT" 2>&1
  EXIT_CODE=$?

  echo "[watchdog] Daemon exited (code $EXIT_CODE), auto-restarting in 5s..."
  sleep 5
done
