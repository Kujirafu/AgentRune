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

function track(event: string, properties: Record<string, unknown> = {}) {
  if (optOut) return
  queue.push({ event, properties, platform: "app" })
  if (queue.length >= MAX_QUEUE) flush()
}

async function flush() {
  if (queue.length === 0 || optOut) return
  const batch = queue.splice(0, MAX_QUEUE)
  try {
    await fetch(TELEMETRY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ distinctId, events: batch }),
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

export function trackSettingsChange(field: string, value: string) {
  track("settings_change", { field, value })
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
