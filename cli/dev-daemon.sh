#!/bin/bash
# Dev daemon watchdog — keeps port 3457 daemon alive with latest code
# Usage: bash cli/dev-daemon.sh
PORT=3457
DIR="$(cd "$(dirname "$0")" && pwd)"

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

  echo "[watchdog] Daemon exited, restarting in 3s..."
  sleep 3
done
