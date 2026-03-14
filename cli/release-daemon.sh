#!/bin/bash
# Release daemon watchdog — stable fallback daemon on port 3456
# Runs alongside dev-daemon.sh so app can failover when dev goes down
# Usage: bash cli/release-daemon.sh
PORT=3456
DIR="$(cd "$(dirname "$0")" && pwd)"

while true; do
  # Check if something is already listening on the port
  PID=$(netstat -ano 2>/dev/null | grep ":${PORT}.*LISTEN" | awk '{print $5}' | head -1)
  if [ -n "$PID" ]; then
    echo "[release-watchdog] Port $PORT already in use by PID $PID, killing..."
    taskkill //PID "$PID" //F 2>/dev/null
    sleep 2
  fi

  echo "[release-watchdog] Starting release daemon on port $PORT..."
  cd "$DIR" && npx tsx src/bin.ts start --foreground --port "$PORT" 2>&1

  echo "[release-watchdog] Daemon exited, restarting in 3s..."
  sleep 3
done
