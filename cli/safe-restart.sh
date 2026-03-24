#!/bin/bash
# safe-restart.sh -- safe dev daemon restart
# 1. Build CLI first. If build fails, abort and keep old daemon alive.
# 2. Stop old dev daemon + every leftover dev watchdog, but keep cloudflared alive.
# 3. Start one fresh watchdog and wait for daemon health.
#
# Usage: bash cli/safe-restart.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$SCRIPT_DIR"
HELPER="$CLI_DIR/watchdog-common.sh"
PORT=3457
WATCHDOG_PATTERN='dev-daemon\.sh'
WATCHDOG_LABEL="safe-restart"

if [ ! -f "$HELPER" ]; then
  echo "[safe-restart] ERROR: Missing helper script: $HELPER"
  exit 1
fi

# shellcheck source=/dev/null
. "$HELPER"

STATE_DIR="$(watchdog_state_dir)"
LOG_FILE="$STATE_DIR/daemon.log"
WATCHDOG_PID_FILE="$(watchdog_pid_file_for_port "$PORT")"
LEGACY_WATCHDOG_PID_FILE="$(legacy_watchdog_pid_file_for_port "$PORT")"
DAEMON_PID_FILE="$(daemon_pid_file_for_port "$PORT")"

ensure_watchdog_state_dir

echo "[safe-restart] Step 1/4: Building App..."
cd "$CLI_DIR/.."
if ! APP_BUILD=$(cd app && npx vite build 2>&1); then
  echo "[safe-restart] APP BUILD FAILED -- daemon NOT restarted"
  echo "$APP_BUILD"
  exit 1
fi
echo "[safe-restart] App build OK"

echo "[safe-restart] Step 2/4: Building CLI..."
cd "$CLI_DIR"
if ! BUILD_OUTPUT=$(npm run build 2>&1); then
  echo "[safe-restart] CLI BUILD FAILED -- daemon NOT restarted"
  echo "$BUILD_OUTPUT"
  exit 1
fi
echo "[safe-restart] CLI build OK"

echo "[safe-restart] Step 3/4: Stopping old daemon (keeping tunnel alive)..."

OLD_WD_PID=$(read_pid_file_value "$WATCHDOG_PID_FILE" 2>/dev/null || true)
if [ -n "$OLD_WD_PID" ]; then
  echo "[safe-restart] Killing tracked watchdog PID $OLD_WD_PID (tree kill)"
  tree_kill_pid "$OLD_WD_PID"
fi

kill_matching_processes "$WATCHDOG_PATTERN"
remove_state_file "$WATCHDOG_PID_FILE"
if [ -n "$LEGACY_WATCHDOG_PID_FILE" ]; then
  remove_state_file "$LEGACY_WATCHDOG_PID_FILE"
fi

kill_tracked_daemon_tree "$DAEMON_PID_FILE"
kill_port_listener_tree "$PORT" "$WATCHDOG_LABEL"

if ! wait_for_port_free "$PORT" 10 1; then
  PID=$(port_listener_pid "$PORT")
  if [ -n "$PID" ]; then
    echo "[safe-restart] Port still occupied by PID $PID, tree-killing again..."
    tree_kill_pid "$PID"
  fi
fi

if ! wait_for_port_free "$PORT" 10 1; then
  PID=$(port_listener_pid "$PORT")
  echo "[safe-restart] ERROR: Port $PORT still occupied${PID:+ by PID $PID} after cleanup"
  exit 1
fi
echo "[safe-restart] Port $PORT is free"

echo "[safe-restart] Step 4/4: Starting daemon via watchdog..."

truncate_state_file "$LOG_FILE" "$WATCHDOG_LABEL"

cd "$CLI_DIR"
bash "$CLI_DIR/dev-daemon.sh" >> "$LOG_FILE" 2>&1 &
STARTER_PID=$!

WATCHDOG_PID=""
for i in $(seq 1 5); do
  WATCHDOG_PID=$(read_pid_file_value "$WATCHDOG_PID_FILE" 2>/dev/null || true)
  if [ -n "$WATCHDOG_PID" ]; then
    break
  fi
  sleep 1
done

if [ -n "$WATCHDOG_PID" ]; then
  echo "[safe-restart] Watchdog started (PID $WATCHDOG_PID), waiting for daemon health check..."
else
  echo "[safe-restart] Warning: watchdog PID file not ready yet, launcher PID is $STARTER_PID"
fi

for i in $(seq 1 20); do
  sleep 1
  HEALTH=$(curl -s --max-time 2 http://localhost:$PORT/api/auth/check 2>/dev/null || true)
  if echo "$HEALTH" | grep -q "mode"; then
    echo "[safe-restart] Daemon healthy on port $PORT"
    sleep 10

    TUNNEL=$(grep "Tunnel ready" "$LOG_FILE" 2>/dev/null | tail -1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' || true)
    if [ -n "$TUNNEL" ]; then
      echo "[safe-restart] Tunnel: $TUNNEL"
    else
      REUSE=$(grep "Reusing existing" "$LOG_FILE" 2>/dev/null | tail -1 || true)
      if [ -n "$REUSE" ]; then
        echo "[safe-restart] $REUSE"
      else
        echo "[safe-restart] Warning: no tunnel URL detected (may still be starting)"
      fi
    fi

    AUTO_COUNT=$(grep -o 'Loaded [0-9]* automations' "$LOG_FILE" 2>/dev/null | tail -1 || true)
    if [ -n "$AUTO_COUNT" ]; then
      echo "[safe-restart] Automations: $AUTO_COUNT"
    fi

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
