#!/usr/bin/env bash
# e2e-crew.sh — End-to-end test for AgentRune crew automation APIs
# Usage: bash cli/src/server/__tests__/e2e-crew.sh [BASE_URL]
# Default BASE_URL: http://localhost:3457

# Do NOT use set -e — we want every test to run even if earlier ones fail.
set -uo pipefail

BASE="${1:-http://localhost:3457}"
PROJECT_ID="agentrune"
E2E_TMP="/tmp/e2e_crew_$$"

# --- Counters ---
PASS=0
FAIL=0
SKIP=0

# --- HTTP state globals ---
HTTP_CODE=""
HTTP_BODY=""

# --- Colours ---
if [ -t 1 ]; then
  GREEN="\033[0;32m"
  RED="\033[0;31m"
  YELLOW="\033[0;33m"
  CYAN="\033[0;36m"
  BOLD="\033[1m"
  RESET="\033[0m"
else
  GREEN="" RED="" YELLOW="" CYAN="" BOLD="" RESET=""
fi

# --- Output helpers ---
pass()    { echo -e "${GREEN}[PASS]${RESET} $1"; PASS=$((PASS + 1)); }
fail()    { echo -e "${RED}[FAIL]${RESET} $1"; FAIL=$((FAIL + 1)); }
info()    { echo -e "${CYAN}[INFO]${RESET} $1"; }
section() { echo -e "\n${BOLD}${CYAN}=== $1 ===${RESET}"; }

# --- HTTP helper ---
# Sends a request; populates HTTP_CODE and HTTP_BODY globals.
# Usage: http METHOD URL [extra curl args...]
http() {
  local method="$1"; shift
  local url="$1";    shift
  # Write body to file, write status code to stdout
  HTTP_CODE=$(curl -s \
    -o "$E2E_TMP" \
    -w "%{http_code}" \
    -X "$method" \
    -H "Content-Type: application/json" \
    "$@" \
    "$url" 2>/dev/null)
  HTTP_BODY=$(cat "$E2E_TMP" 2>/dev/null || echo "")
}

# --- JSON helpers (no side-effects, return via stdout only) ---
# Extract a single scalar field from HTTP_BODY
json_get() {
  local field="$1"
  echo "$HTTP_BODY" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('$field',''))" \
    2>/dev/null || echo ""
}

# Check if HTTP_BODY is a JSON array; print length on success
json_array_len() {
  echo "$HTTP_BODY" | python3 -c \
    "import sys,json; v=json.load(sys.stdin); print(len(v)) if isinstance(v,list) else exit(1)" \
    2>/dev/null
}

# Check if HTTP_BODY array contains an object where field==value
json_array_has() {
  local field="$1" value="$2"
  echo "$HTTP_BODY" | python3 -c "
import sys,json
data=json.load(sys.stdin)
found=any(str(item.get('$field',''))=='$value' for item in data if isinstance(item,dict))
print('yes' if found else 'no')
" 2>/dev/null || echo "no"
}

# --- Assertion helpers ---
assert_status() {
  local label="$1" expected="$2"
  if [ "$HTTP_CODE" = "$expected" ]; then
    pass "$label (HTTP $expected)"
  else
    fail "$label — expected HTTP $expected, got HTTP $HTTP_CODE | body: ${HTTP_BODY:0:250}"
  fi
}

assert_field_set() {
  local label="$1" field="$2"
  local val
  val=$(json_get "$field")
  if [ -n "$val" ] && [ "$val" != "None" ] && [ "$val" != "null" ]; then
    pass "$label (field '$field' = '$val')"
  else
    fail "$label — field '$field' missing/null | body: ${HTTP_BODY:0:250}"
  fi
}

assert_field_eq() {
  local label="$1" field="$2" expected="$3"
  local val
  val=$(json_get "$field")
  if [ "$val" = "$expected" ]; then
    pass "$label (field '$field' = '$val')"
  else
    fail "$label — expected '$expected', got '$val'"
  fi
}

assert_is_array() {
  local label="$1"
  local len
  if len=$(json_array_len); then
    pass "$label (array, length $len)"
  else
    fail "$label — expected JSON array | body: ${HTTP_BODY:0:250}"
  fi
}

assert_array_contains() {
  local label="$1" field="$2" value="$3"
  local found
  found=$(json_array_has "$field" "$value")
  if [ "$found" = "yes" ]; then
    pass "$label (array has '$field' = '$value')"
  else
    fail "$label — item with '$field'='$value' not found | body: ${HTTP_BODY:0:350}"
  fi
}

assert_error_substr() {
  local label="$1" substr="$2"
  local errval
  errval=$(json_get "error")
  if echo "$errval" | grep -qi "$substr"; then
    pass "$label (error: '$errval')"
  else
    fail "$label — error '$errval' does not contain '$substr'"
  fi
}

# --- Cleanup on exit ---
cleanup() { rm -f "$E2E_TMP"; }
trap cleanup EXIT

# ============================================================
# Pre-flight
# ============================================================
section "Pre-flight"
info "Target: $BASE"
if ! curl -sf --max-time 5 "$BASE/api/projects" > /dev/null 2>&1; then
  echo -e "${RED}[ERROR]${RESET} Cannot reach $BASE — is the daemon running?"
  exit 1
fi
pass "Daemon reachable"

# ============================================================
# Test 1 — POST /api/automations/:projectId — Create crew automation
# ============================================================
section "Test 1 — Create crew automation"

CREATE_BODY=$(cat <<'ENDJSON'
{
  "name": "E2E Test Crew",
  "prompt": "Test task for e2e validation",
  "schedule": { "type": "manual" },
  "bypass": true,
  "crew": {
    "roles": [
      {
        "id": "researcher",
        "nameKey": "Researcher",
        "prompt": "Research the topic",
        "skill": "research",
        "phase": 1,
        "persona": { "tone": "analytical", "focus": "research", "style": "concise" },
        "icon": "search",
        "color": "#6366f1"
      }
    ],
    "tokenBudget": 20000
  }
}
ENDJSON
)

http POST "$BASE/api/automations/$PROJECT_ID" --data "$CREATE_BODY"
assert_status "POST /api/automations" "200"
assert_field_set "Create — has id" "id"
assert_field_set "Create — has name" "name"

AUTO_ID=$(json_get "id")
if [ -z "$AUTO_ID" ] || [ "$AUTO_ID" = "None" ]; then
  fail "Create — no id returned; downstream tests will be skipped"
  AUTO_ID="__missing__"
else
  info "Created automation id: $AUTO_ID"
fi

# ============================================================
# Test 2 — GET /api/automations/:projectId — List automations
# ============================================================
section "Test 2 — List automations"

http GET "$BASE/api/automations/$PROJECT_ID"
assert_status "GET /api/automations" "200"
assert_is_array "List — returns array"

if [ "$AUTO_ID" != "__missing__" ]; then
  assert_array_contains "List — contains created automation" "id" "$AUTO_ID"
fi

# ============================================================
# Test 3 — POST /api/automations/:projectId/fire — Fire and forget
# ============================================================
section "Test 3 — Fire and forget"

FIRE_BODY=$(cat <<'ENDJSON'
{
  "name": "E2E Fire Test",
  "sessionContext": "Quick e2e test",
  "crew": {
    "roles": [
      {
        "id": "writer",
        "nameKey": "Writer",
        "prompt": "Write a short test",
        "skill": "write",
        "phase": 1,
        "persona": { "tone": "clear", "focus": "writing", "style": "brief" },
        "icon": "pen",
        "color": "#22c55e"
      }
    ],
    "tokenBudget": 10000
  }
}
ENDJSON
)

http POST "$BASE/api/automations/$PROJECT_ID/fire" --data "$FIRE_BODY"
assert_status "POST /fire" "200"
assert_field_set "Fire — has automationId" "automationId"

FIRE_OK=$(json_get "ok")
if [ "$FIRE_OK" = "True" ] || [ "$FIRE_OK" = "true" ]; then
  pass "Fire — ok: true"
else
  fail "Fire — expected ok:true, got '$FIRE_OK' | body: ${HTTP_BODY:0:200}"
fi

FIRE_ID=$(json_get "automationId")
if [ -n "$FIRE_ID" ] && [ "$FIRE_ID" != "None" ]; then
  info "Fired automation id: $FIRE_ID"
else
  FIRE_ID="__missing__"
  info "Fire — no automationId returned"
fi

# ============================================================
# Test 4 — GET /api/automations/:projectId/:id/results
# ============================================================
section "Test 4 — Get results"

if [ "$AUTO_ID" != "__missing__" ]; then
  http GET "$BASE/api/automations/$PROJECT_ID/$AUTO_ID/results"
  assert_status "GET results (created auto)" "200"
  assert_is_array "Results (created auto) — returns array"
else
  info "Skipping results check for created auto (no id)"
  SKIP=$((SKIP + 1))
fi

if [ "$FIRE_ID" != "__missing__" ]; then
  http GET "$BASE/api/automations/$PROJECT_ID/$FIRE_ID/results"
  assert_status "GET results (fired auto)" "200"
  assert_is_array "Results (fired auto) — returns array"
else
  info "Skipping results check for fired auto (no id)"
  SKIP=$((SKIP + 1))
fi

# ============================================================
# Test 5 — PATCH /api/automations/:projectId/:id — Update automation
# ============================================================
section "Test 5 — Update automation"

if [ "$AUTO_ID" != "__missing__" ]; then
  http PATCH "$BASE/api/automations/$PROJECT_ID/$AUTO_ID" \
    --data '{"name":"E2E Test Crew Updated"}'
  assert_status "PATCH /api/automations/:id" "200"
  assert_field_eq "PATCH — name updated" "name" "E2E Test Crew Updated"
else
  info "Skipping PATCH test (no automation id)"
  SKIP=$((SKIP + 1))
fi

# ============================================================
# Test 6 — DELETE /api/automations/:projectId/:id
# ============================================================
section "Test 6 — Delete automation"

if [ "$AUTO_ID" != "__missing__" ]; then
  http DELETE "$BASE/api/automations/$PROJECT_ID/$AUTO_ID"
  assert_status "DELETE /api/automations/:id" "200"

  DEL_OK=$(json_get "ok")
  if [ "$DEL_OK" = "True" ] || [ "$DEL_OK" = "true" ]; then
    pass "DELETE — ok: true"
  else
    fail "DELETE — expected ok:true, got '$DEL_OK' | body: ${HTTP_BODY:0:200}"
  fi
else
  info "Skipping DELETE test (no automation id)"
  SKIP=$((SKIP + 1))
fi

# ============================================================
# Test 7 — Error cases
# ============================================================
section "Test 7 — Error cases"

# 7a. POST missing name -> 400
http POST "$BASE/api/automations/$PROJECT_ID" \
  --data '{"prompt":"no name","schedule":{"type":"manual"}}'
assert_status "7a: POST missing name" "400"
assert_error_substr "7a: error mentions name/schedule" "name"

# 7b. POST missing schedule -> 400
http POST "$BASE/api/automations/$PROJECT_ID" \
  --data '{"name":"No Schedule","prompt":"missing schedule"}'
assert_status "7b: POST missing schedule" "400"
assert_error_substr "7b: error mentions schedule" "schedule"

# 7c. POST /fire with no crew -> 400
http POST "$BASE/api/automations/$PROJECT_ID/fire" \
  --data '{"name":"No Crew","sessionContext":"test"}'
assert_status "7c: POST /fire no crew" "400"
assert_error_substr "7c: error mentions crew" "crew"

# 7d. PATCH non-existent id -> 404
NONEXIST_ID="auto_000000000000_nonexistent"
http PATCH "$BASE/api/automations/$PROJECT_ID/$NONEXIST_ID" \
  --data '{"name":"Ghost"}'
assert_status "7d: PATCH non-existent id" "404"

# 7e. DELETE non-existent id -> 404
http DELETE "$BASE/api/automations/$PROJECT_ID/$NONEXIST_ID"
assert_status "7e: DELETE non-existent id" "404"

# ============================================================
# Summary
# ============================================================
TOTAL=$((PASS + FAIL + SKIP))
echo ""
echo -e "${BOLD}======================================${RESET}"
echo -e "${BOLD}  E2E Crew API — Test Summary${RESET}"
echo -e "${BOLD}======================================${RESET}"
printf "  Total   : %d\n" "$TOTAL"
echo -e "  ${GREEN}Passed${RESET}  : $PASS"
echo -e "  ${RED}Failed${RESET}  : $FAIL"
if [ "$SKIP" -gt 0 ]; then
  echo -e "  ${YELLOW}Skipped${RESET} : $SKIP"
fi
echo -e "${BOLD}======================================${RESET}"

if [ "$FAIL" -gt 0 ]; then
  echo -e "\n${RED}Some tests failed.${RESET}"
  exit 1
else
  echo -e "\n${GREEN}All tests passed.${RESET}"
  exit 0
fi
