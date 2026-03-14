// Lightweight telemetry for AgentRune APP
// Events batched locally, flushed to AgentLore every 30s or on app background

const TELEMETRY_URL = "https://agentlore.vercel.app/api/telemetry"
const FLUSH_INTERVAL = 30_000
const MAX_QUEUE = 50

let queue: { event: string; properties: Record<string, unknown>; platform: string }[] = []
let distinctId = ""
let optOut = false
let timer: ReturnType<typeof setInterval> | null = null

function getDistinctId(): string {
  // Prefer AgentLore userId (set after login)
  const userId = localStorage.getItem("agentrune_user_id")
  if (userId) return userId

  // Fallback to device-level ID
  let id = localStorage.getItem("agentrune_telemetry_id")
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem("agentrune_telemetry_id", id)
  }
  return id
}

export function initAnalytics() {
  optOut = localStorage.getItem("agentrune_telemetry_optout") === "true"
  distinctId = getDistinctId()
  if (!timer) {
    timer = setInterval(flush, FLUSH_INTERVAL)
  }
  // Flush when app goes to background
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush()
  })
}

/** Re-identify after AgentLore login — unifies user across web/app/api */
export function identifyUser() {
  distinctId = getDistinctId()
}

export function setOptOut(val: boolean) {
  optOut = val
  localStorage.setItem("agentrune_telemetry_optout", val ? "true" : "false")
}

export function getOptOut(): boolean {
  return localStorage.getItem("agentrune_telemetry_optout") === "true"
}

const MAX_PROPERTIES_SIZE = 4096

function track(event: string, properties: Record<string, unknown> = {}) {
  if (optOut) return
  // Limit properties size to prevent abuse
  const json = JSON.stringify(properties)
  const safeProps = json.length <= MAX_PROPERTIES_SIZE
    ? properties
    : { _truncated: true, _originalSize: json.length }
  queue.push({ event, properties: safeProps, platform: "app" })
  if (queue.length >= MAX_QUEUE) flush()
}

/** Generate device-specific signing key (persisted in localStorage) */
function getSigningKey(): string {
  let key = localStorage.getItem("agentrune_telemetry_key")
  if (!key) {
    key = crypto.randomUUID() + crypto.randomUUID()
    localStorage.setItem("agentrune_telemetry_key", key)
  }
  return key
}

/** Simple hash for request signing (not crypto-grade, but prevents casual spoofing) */
async function signPayload(payload: string): Promise<string> {
  const key = getSigningKey()
  const data = new TextEncoder().encode(key + payload)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("")
}

async function flush() {
  if (queue.length === 0 || optOut) return
  const batch = queue.splice(0, MAX_QUEUE)
  try {
    const body = JSON.stringify({ distinctId, events: batch })
    const sig = await signPayload(body)
    await fetch(TELEMETRY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telemetry-sig": sig,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    queue.unshift(...batch)
  }
}

// ─── Event helpers ───────────────────────────────────────────────

export function trackSessionStart(agentId: string, projectId: string) {
  track("session_start", { agentId, projectId })
}

export function trackSessionEnd(agentId: string, durationMs: number) {
  track("session_end", { agentId, durationMs })
}

const SENSITIVE_FIELDS = ["apiKey", "token", "password", "secret", "key", "credential"]

export function trackSettingsChange(field: string, value: string) {
  const isSensitive = SENSITIVE_FIELDS.some(s => field.toLowerCase().includes(s))
  track("settings_change", { field, value: isSensitive ? "[REDACTED]" : value })
}

export function trackAutomationTrigger(scheduleId: string, trigger: string) {
  track("automation_trigger", { scheduleId, trigger })
}

export function trackAgentLaunch(agentId: string, projectId: string) {
  track("agent_launch", { agentId, projectId })
}

export function trackSlashCommand(command: string) {
  track("slash_command", { command })
}

export function trackDecision(action: "approve" | "deny", agentId: string) {
  track("decision", { action, agentId })
}

export function trackMessageSend(agentId: string, hasAttachment: boolean) {
  track("message_send", { agentId, hasAttachment })
}

export function trackProjectSwitch(projectId: string) {
  track("project_switch", { projectId })
}

export function trackChainExecute(chainSlug: string) {
  track("chain_execute", { chainSlug })
}

export function trackPrdAction(action: string, projectId: string) {
  track("prd_action", { action, projectId })
}

export function trackGitAction(action: string, projectId: string) {
  track("git_action", { action, projectId })
}

export function trackVoiceInput() {
  track("voice_input", {})
}

export function trackAppOpen() {
  track("app_open", {})
}

export function trackLogin() {
  track("login", {})
}
