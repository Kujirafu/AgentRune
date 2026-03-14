import posthog from "posthog-js"

const POSTHOG_KEY = "phc_FBBcGz9EVzHDLdy25PHNZzReSXtRMBjX708yiqKRBTc"
const POSTHOG_HOST = "https://us.i.posthog.com"

let initialized = false

export function initAnalytics() {
  if (initialized) return
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false, // SPA, we track manually
    persistence: "localStorage",
    person_profiles: "identified_only",
  })
  posthog.register({ platform: "app" })
  initialized = true
}

// ── Key events ──

export function trackSessionStart(agentId: string, projectId: string) {
  posthog.capture("session_start", { agentId, projectId })
}

export function trackSessionEnd(agentId: string, durationMs: number) {
  posthog.capture("session_end", { agentId, durationMs })
}

export function trackSettingsChange(field: string, value: string | boolean) {
  posthog.capture("settings_change", { field, value })
}

export function trackAutomationTrigger(automationName: string) {
  posthog.capture("automation_trigger", { automationName })
}

export function trackPlanAction(action: "approve" | "reject" | "create", prdId?: string) {
  posthog.capture("plan_action", { action, prdId })
}

export function trackDeviceRegister() {
  posthog.capture("device_register")
}

export function trackAgentLaunch(agentId: string) {
  posthog.capture("agent_launch", { agentId })
}

export function trackSlashCommand(command: string, agentId: string) {
  posthog.capture("slash_command", { command, agentId })
}

export { posthog }
