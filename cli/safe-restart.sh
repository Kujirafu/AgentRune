#!/bin/bash
# safe-restart.sh — 安全重啟 dev daemon
# 1. 先 build CLI，確認編譯通過才重啟
# 2. 失敗就中止，不會殺掉正在跑的 daemon
# 3. 成功才 kill 所有舊 process（含 watchdog）、透過 watchdog 啟動新的
# 4. Watchdog 會在 daemon 掛掉時自動重啟，不需要人工介入
#
# Usage: bash cli/safe-restart.sh
# 從專案根目錄執行，或任何目錄（腳本會自動定位）

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$SCRIPT_DIR"
PORT=3457
STATE_DIR="$HOME/.agentrune"
LOG_FILE="$STATE_DIR/daemon.log"
WATCHDOG_PID_FILE="$STATE_DIR/watchdog.pid"

# ── Step 1: Build ──
echo "[safe-restart] Step 1/3: Building CLI..."
cd "$CLI_DIR"
BUILD_OUTPUT=$(npm run build 2>&1)
BUILD_EXIT=$?

if [ $BUILD_EXIT -ne 0 ]; then
  echo "[safe-restart] BUILD FAILED — daemon NOT restarted"
  echo "$BUILD_OUTPUT"
  exit 1
fi
echo "[safe-restart] Build OK"

# ── Step 2: Kill daemon + watchdog (keep cloudflared alive!) ──
echo "[safe-restart] Step 2/3: Stopping old daemon (keeping tunnel alive)..."

# DO NOT kill cloudflared — reuse the existing tunnel to avoid Cloudflare rate limits.

# 2a. Kill old watchdog from PID file (prevents auto-restart of daemon we're about to kill)
if [ -f "$WATCHDOG_PID_FILE" ]; then
  OLD_WD_PID=$(cat "$WATCHDOG_PID_FILE" 2>/dev/null)
  if [ -n "$OLD_WD_PID" ]; then
    echo "[safe-restart] Killing old watchdog PID $OLD_WD_PID (tree kill)"
    taskkill //PID "$OLD_WD_PID" //T //F 2>/dev/null || true
  fi
  rm -f "$WATCHDOG_PID_FILE"
fi

# 2b. Kill daemon on port — /T = tree kill (kills tsx parent + all child node.exe)
# This is the KEY fix: without /T, child node processes survive and serve old code
PID=$(netstat -ano 2>/dev/null | grep ":${PORT}.*LISTEN" | awk '{print $5}' | head -1)
if [ -n "$PID" ]; then
  echo "[safe-restart] Tree-killing daemon PID $PID on port $PORT"
  taskkill //PID "$PID" //T //F 2>/dev/null || true
fi

# Wait for port to be released
sleep 3

# Double-check port is free
PID2=$(netstat -ano 2>/dev/null | grep ":${PORT}.*LISTEN" | awk '{print $5}' | head -1)
if [ -n "$PID2" ]; then
  echo "[safe-restart] Port still occupied by PID $PID2, tree-killing..."
  taskkill //PID "$PID2" //T //F 2>/dev/null || true
  sleep 2
fi

# Final check
PID3=$(netstat -ano 2>/dev/null | grep ":${PORT}.*LISTEN" | awk '{print $5}' | head -1)
if [ -n "$PID3" ]; then
  echo "[safe-restart] ERROR: Port $PORT still occupied by PID $PID3 after 2 kill attempts!"
  echo "[safe-restart] Aborting — please manually kill PID $PID3"
  exit 1
fi
echo "[safe-restart] Port $PORT is free"

# ── Step 3: Start via watchdog ──
echo "[safe-restart] Step 3/3: Starting daemon via watchdog..."

# Clear log for clean output
> "$LOG_FILE"

cd "$CLI_DIR"
bash "$CLI_DIR/dev-daemon.sh" >> "$LOG_FILE" 2>&1 &
WATCHDOG_PID=$!
echo "$WATCHDOG_PID" > "$WATCHDOG_PID_FILE"
echo "[safe-restart] Watchdog started (PID $WATCHDOG_PID), waiting for daemon health check..."

# Wait up to 20s for daemon to respond
for i in $(seq 1 20); do
  sleep 1
  HEALTH=$(curl -s --max-time 2 http://localhost:$PORT/api/auth/check 2>/dev/null || true)
  if echo "$HEALTH" | grep -q "mode"; then
    echo "[safe-restart] Daemon healthy on port $PORT"
    # Wait for tunnel + automations to load
    sleep 10
    TUNNEL=$(grep "Tunnel ready" "$LOG_FILE" 2>/dev/null | tail -1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' || true)
    if [ -n "$TUNNEL" ]; then
      echo "[safe-restart] Tunnel: $TUNNEL"
    else
      # Check if reusing existing tunnel
      REUSE=$(grep "Reusing existing" "$LOG_FILE" 2>/dev/null | tail -1 || true)
      if [ -n "$REUSE" ]; then
        echo "[safe-restart] $REUSE"
      else
        echo "[safe-restart] Warning: no tunnel URL detected (may still be starting)"
      fi
    fi
    # Check automations loaded
    AUTO_COUNT=$(grep -o 'Loaded [0-9]* automations' "$LOG_FILE" 2>/dev/null | tail -1 || true)
    if [ -n "$AUTO_COUNT" ]; then
      echo "[safe-restart] Automations: $AUTO_COUNT"
    fi
    # Check heartbeat
    HEARTBEAT=$(grep "heartbeat OK" "$LOG_FILE" 2>/dev/null | tail -1 || true)
    if [ -n "$HEARTBEAT" ]; then
      echo "[safe-restart] AgentLore heartbeat OK"
    fi
    echo "[safe-restart] Done"
    exit 0
  fi
done

echo "[safe-restart] ERROR: daemon did not start within 20s"
echo "[safe-restart] Last 10 lines of log:"
tail -10 "$LOG_FILE" 2>/dev/null | tr -cd '[:print:]\n'
exit 1
