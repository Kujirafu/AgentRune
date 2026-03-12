#!/bin/bash
# safe-restart.sh — 安全重啟 dev daemon
# 1. 先 build CLI，確認編譯通過才重啟
# 2. 失敗就中止，不會殺掉正在跑的 daemon
# 3. 成功才 kill 所有舊 process（含 watchdog）、啟動新的
#
# Usage: bash cli/safe-restart.sh
# 從專案根目錄執行，或任何目錄（腳本會自動定位）

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$SCRIPT_DIR"
PORT=3457
LOG_FILE="$HOME/.agentrune/daemon.log"

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

# ── Step 2: Kill everything ──
echo "[safe-restart] Step 2/3: Stopping old daemon..."

# Kill cloudflared (child process won't die with parent on Windows)
taskkill //IM cloudflared.exe //F 2>/dev/null || true

# Kill any dev-daemon.sh watchdog loops (bash processes running dev-daemon.sh)
# This prevents the watchdog from auto-restarting the daemon we just killed
for WPID in $(wmic process where "CommandLine like '%dev-daemon%' and Name='bash.exe'" get ProcessId 2>/dev/null | grep -o '[0-9]\+'); do
  echo "[safe-restart] Killing watchdog PID $WPID"
  taskkill //PID "$WPID" //F 2>/dev/null || true
done

# Kill daemon on port
PID=$(netstat -ano 2>/dev/null | grep ":${PORT}.*LISTEN" | awk '{print $5}' | head -1)
if [ -n "$PID" ]; then
  echo "[safe-restart] Killing daemon PID $PID on port $PORT"
  taskkill //PID "$PID" //F 2>/dev/null || true
fi

# Wait for port to be released
sleep 3
# Double-check port is free
PID2=$(netstat -ano 2>/dev/null | grep ":${PORT}.*LISTEN" | awk '{print $5}' | head -1)
if [ -n "$PID2" ]; then
  echo "[safe-restart] Port still occupied by PID $PID2, force killing..."
  taskkill //PID "$PID2" //F 2>/dev/null || true
  sleep 2
fi

# ── Step 3: Start ──
echo "[safe-restart] Step 3/3: Starting daemon..."

# Clear log for clean output (old file descriptor issues)
> "$LOG_FILE"

cd "$CLI_DIR"
npx tsx src/bin.ts start --foreground --port "$PORT" >> "$LOG_FILE" 2>&1 &
DAEMON_PID=$!
echo "[safe-restart] Daemon started (PID $DAEMON_PID), waiting for health check..."

# Wait up to 20s for daemon to respond
for i in $(seq 1 20); do
  sleep 1
  HEALTH=$(curl -s --max-time 2 http://localhost:$PORT/api/auth/check 2>/dev/null || true)
  if echo "$HEALTH" | grep -q "mode"; then
    echo "[safe-restart] Daemon healthy on port $PORT"
    # Wait for tunnel
    sleep 10
    TUNNEL=$(grep "Tunnel ready" "$LOG_FILE" 2>/dev/null | tail -1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' || true)
    if [ -n "$TUNNEL" ]; then
      echo "[safe-restart] Tunnel: $TUNNEL"
    else
      echo "[safe-restart] Warning: no tunnel URL detected (may still be starting)"
    fi
    echo "[safe-restart] Done"
    exit 0
  fi
done

echo "[safe-restart] ERROR: daemon did not start within 20s"
echo "[safe-restart] Last 10 lines of log:"
tail -10 "$LOG_FILE" 2>/dev/null | tr -cd '[:print:]\n'
exit 1
