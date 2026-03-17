#!/bin/bash

umask 077

watchdog_state_dir() {
  printf '%s\n' "$HOME/.agentrune"
}

ensure_watchdog_state_dir() {
  local dir
  dir="$(watchdog_state_dir)"
  mkdir -p "$dir"
  chmod 700 "$dir" >/dev/null 2>&1 || true
}

assert_safe_state_path() {
  local path="$1"
  local label="${2:-watchdog}"

  if [ -L "$path" ]; then
    echo "[$label] ERROR: Refusing symlink state path: $path"
    return 1
  fi

  if [ -d "$path" ]; then
    echo "[$label] ERROR: Refusing directory state path: $path"
    return 1
  fi

  return 0
}

remove_state_file() {
  local path="$1"
  [ -n "$path" ] || return 0

  if [ -L "$path" ]; then
    rm -f "$path"
    return 0
  fi

  [ -e "$path" ] || return 0
  [ -d "$path" ] && return 1
  rm -f "$path"
}

write_state_file_value() {
  local path="$1"
  local value="$2"
  local label="${3:-watchdog}"

  ensure_watchdog_state_dir
  assert_safe_state_path "$path" "$label" || return 1
  printf '%s\n' "$value" > "$path"
  chmod 600 "$path" >/dev/null 2>&1 || true
}

try_create_lock_file() {
  local path="$1"
  local value="$2"
  local label="${3:-watchdog}"

  ensure_watchdog_state_dir
  assert_safe_state_path "$path" "$label" || return 1
  if ( set -o noclobber; printf '%s\n' "$value" > "$path" ) 2>/dev/null; then
    chmod 600 "$path" >/dev/null 2>&1 || true
    return 0
  fi
  return 1
}

truncate_state_file() {
  local path="$1"
  local label="${2:-watchdog}"

  ensure_watchdog_state_dir
  assert_safe_state_path "$path" "$label" || return 1
  : > "$path"
  chmod 600 "$path" >/dev/null 2>&1 || true
}

watchdog_pid_file_for_port() {
  local port="$1"
  printf '%s/watchdog-%s.pid\n' "$(watchdog_state_dir)" "$port"
}

legacy_watchdog_pid_file_for_port() {
  local port="$1"
  if [ "$port" = "3457" ]; then
    printf '%s/watchdog.pid\n' "$(watchdog_state_dir)"
  fi
}

daemon_pid_file_for_port() {
  local port="$1"
  if [ "$port" = "3456" ]; then
    printf '%s/daemon.pid\n' "$(watchdog_state_dir)"
  else
    printf '%s/daemon-%s.pid\n' "$(watchdog_state_dir)" "$port"
  fi
}

normalize_pid() {
  printf '%s' "$1" | tr -cd '0-9'
}

read_pid_file_value() {
  local pid_file="$1"
  [ -f "$pid_file" ] || return 1
  assert_safe_state_path "$pid_file" "watchdog" >/dev/null 2>&1 || return 1

  local pid
  pid=$(normalize_pid "$(cat "$pid_file" 2>/dev/null)")
  [ -n "$pid" ] || return 1

  printf '%s\n' "$pid"
}

is_pid_alive() {
  local pid
  pid=$(normalize_pid "$1")
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

pid_matches_pattern() {
  local pid
  pid=$(normalize_pid "$1")
  local pattern="$2"
  [ -n "$pid" ] || return 1
  [ -n "$pattern" ] || return 0

  local cmdline
  cmdline=$(ps -p "$pid" -o args= 2>/dev/null || true)
  [ -n "$cmdline" ] || return 1
  printf '%s\n' "$cmdline" | grep -Eq "$pattern"
}

claim_watchdog_pid_lock() {
  local pid_file="$1"
  local label="$2"
  local process_pattern="$3"
  local legacy_pid_file="${4:-}"

  ensure_watchdog_state_dir

  if [ -n "$legacy_pid_file" ] && [ -f "$legacy_pid_file" ]; then
    assert_safe_state_path "$legacy_pid_file" "$label" || return 1
    local legacy_pid=""
    legacy_pid=$(read_pid_file_value "$legacy_pid_file" 2>/dev/null || true)
    if [ -n "$legacy_pid" ] && is_pid_alive "$legacy_pid" && pid_matches_pattern "$legacy_pid" "$process_pattern"; then
      echo "[$label] ERROR: Legacy watchdog is still running (PID $legacy_pid)"
      echo "[$label] Stop it first or use safe-restart.sh"
      return 1
    fi
    remove_state_file "$legacy_pid_file"
  fi

  if try_create_lock_file "$pid_file" "$$" "$label"; then
    return 0
  fi

  local old_pid=""
  old_pid=$(read_pid_file_value "$pid_file" 2>/dev/null || true)
  if [ -n "$old_pid" ] && is_pid_alive "$old_pid" && pid_matches_pattern "$old_pid" "$process_pattern"; then
    echo "[$label] ERROR: Another watchdog is already running (PID $old_pid)"
    return 1
  fi

  assert_safe_state_path "$pid_file" "$label" || return 1
  remove_state_file "$pid_file"

  if try_create_lock_file "$pid_file" "$$" "$label"; then
    return 0
  fi

  local contender=""
  contender=$(read_pid_file_value "$pid_file" 2>/dev/null || true)
  echo "[$label] ERROR: Failed to acquire watchdog lock${contender:+ (held by PID $contender)}"
  return 1
}

assert_watchdog_lock_owner() {
  local pid_file="$1"
  local label="$2"

  local owner=""
  owner=$(read_pid_file_value "$pid_file" 2>/dev/null || true)
  if [ "$owner" != "$$" ]; then
    echo "[$label] Watchdog lock ownership changed${owner:+ to PID $owner}; exiting"
    return 1
  fi

  return 0
}

release_watchdog_pid_lock() {
  local pid_file="$1"
  local legacy_pid_file="${2:-}"

  local owner=""
  owner=$(read_pid_file_value "$pid_file" 2>/dev/null || true)
  if [ "$owner" = "$$" ]; then
    remove_state_file "$pid_file"
  fi

  if [ -n "$legacy_pid_file" ] && [ -f "$legacy_pid_file" ]; then
    local legacy_owner=""
    legacy_owner=$(read_pid_file_value "$legacy_pid_file" 2>/dev/null || true)
    if [ -z "$legacy_owner" ] || [ "$legacy_owner" = "$$" ] || ! is_pid_alive "$legacy_owner"; then
      remove_state_file "$legacy_pid_file"
    fi
  fi
}

write_pid_file_value() {
  local pid_file="$1"
  local pid_value="$2"
  local label="${3:-watchdog}"

  write_state_file_value "$pid_file" "$pid_value" "$label" || {
    echo "[$label] WARNING: Failed to write PID file: $pid_file" >&2
    return 1
  }
}

clear_pid_file_if_owned_by() {
  local pid_file="$1"
  local pid_value="$2"

  local current=""
  current=$(read_pid_file_value "$pid_file" 2>/dev/null || true)
  if [ -z "$current" ] || [ "$current" = "$pid_value" ]; then
    remove_state_file "$pid_file"
  fi
}

tree_kill_pid() {
  local pid
  pid=$(normalize_pid "$1")
  [ -n "$pid" ] || return 0
  [ "$pid" = "$$" ] && return 0

  if command -v taskkill >/dev/null 2>&1; then
    taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
    return 0
  fi

  kill -TERM "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1 || true
}

kill_tracked_daemon_tree() {
  local daemon_pid_file="$1"

  local daemon_pid=""
  daemon_pid=$(read_pid_file_value "$daemon_pid_file" 2>/dev/null || true)
  if [ -n "$daemon_pid" ]; then
    tree_kill_pid "$daemon_pid"
  fi
  remove_state_file "$daemon_pid_file"
}

port_listener_pid() {
  local port="$1"
  netstat -ano 2>/dev/null | tr -d '\r' | awk -v port=":$port" '$0 ~ port && $0 ~ /LISTEN/ { print $NF; exit }'
}

wait_for_port_free() {
  local port="$1"
  local max_attempts="${2:-10}"
  local sleep_secs="${3:-1}"
  local attempt=1

  while [ "$attempt" -le "$max_attempts" ]; do
    local pid=""
    pid=$(port_listener_pid "$port")
    if [ -z "$pid" ]; then
      return 0
    fi
    sleep "$sleep_secs"
    attempt=$((attempt + 1))
  done

  return 1
}

kill_port_listener_tree() {
  local port="$1"
  local label="$2"

  local pid=""
  pid=$(port_listener_pid "$port")
  if [ -n "$pid" ]; then
    echo "[$label] Port $port already in use by PID $pid, tree-killing..."
    tree_kill_pid "$pid"
    sleep 2
  fi
}

kill_matching_processes() {
  local pattern="$1"
  local skip_pid="${2:-}"

  if command -v powershell.exe >/dev/null 2>&1; then
    WATCHDOG_MATCH_PATTERN="$pattern" WATCHDOG_SKIP_PID="$skip_pid" powershell.exe -NoProfile -Command '
      $pattern = $env:WATCHDOG_MATCH_PATTERN
      $skipPid = 0
      if ($env:WATCHDOG_SKIP_PID) {
        [int]::TryParse($env:WATCHDOG_SKIP_PID, [ref]$skipPid) | Out-Null
      }
      Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern -and $_.ProcessId -ne $skipPid } |
        ForEach-Object {
          try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
        }
    ' >/dev/null 2>&1 || true
    return 0
  fi

  if command -v pkill >/dev/null 2>&1; then
    if [ -n "$skip_pid" ]; then
      local pid
      for pid in $(pgrep -f "$pattern" 2>/dev/null || true); do
        if [ "$pid" != "$skip_pid" ]; then
          kill "$pid" >/dev/null 2>&1 || true
        fi
      done
    else
      pkill -f "$pattern" >/dev/null 2>&1 || true
    fi
  fi
}
