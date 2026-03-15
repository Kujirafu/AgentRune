import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Manually mock localStorage before importing analytics
const storage = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  removeItem: vi.fn((key: string) => storage.delete(key)),
}
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true })

// Mock crypto
Object.defineProperty(globalThis, "crypto", {
  value: {
    randomUUID: () => "test-uuid-1234",
    subtle: {
      digest: async () => new ArrayBuffer(32),
    },
  },
  writable: true,
})

// Mock fetch
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve({ ok: true } as Response))
globalThis.fetch = fetchMock as any

// Mock document.addEventListener (prevent real listener attachment)
vi.spyOn(document, "addEventListener").mockImplementation(() => {})

// Now import after mocks are in place
import {
  _resetForTesting,
  initAnalytics,
  identifyUser,
  setOptOut,
  getOptOut,
  trackAppOpen,
  trackLogin,
  trackSessionStart,
  trackSessionEnd,
  trackSettingsChange,
  trackAutomationTrigger,
  trackAgentLaunch,
  trackSlashCommand,
  trackDecision,
  trackMessageSend,
  trackProjectSwitch,
  trackChainExecute,
  trackPrdAction,
  trackGitAction,
  trackVoiceInput,
  trackScreenView,
  trackTabSwitch,
  trackCrewStart,
  trackCrewEnd,
  trackScheduleCreate,
  trackPlanCreate,
  trackPlanExecute,
  trackFileBrowse,
  trackViewModeChange,
} from "./analytics"

// Helper: advance fake timers to trigger setInterval flush, then drain microtasks
// so the async chain (flush → signPayload → crypto.subtle.digest → fetch) completes.
async function flushAndParse() {
  await vi.advanceTimersByTimeAsync(31_000)
  // setInterval fires flush() but doesn't await it — drain microtask queue manually
  for (let i = 0; i < 10; i++) await Promise.resolve()
  if (fetchMock.mock.calls.length === 0) return null
  const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return JSON.parse(lastCall[1]?.body as string)
}

describe("analytics", () => {
  beforeEach(() => {
    storage.clear()
    fetchMock.mockClear()
    vi.useFakeTimers()
    _resetForTesting()
    setOptOut(false)
    initAnalytics()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Core ──

  it("initAnalytics creates a distinct ID", () => {
    expect(storage.has("agentrune_telemetry_id")).toBe(true)
  })

  it("identifyUser uses userId when available", async () => {
    storage.set("agentrune_user_id", "user-123")
    identifyUser()
    trackAppOpen()
    const body = await flushAndParse()
    expect(body.distinctId).toBe("user-123")
  })

  it("opt-out prevents tracking", async () => {
    setOptOut(true)
    expect(getOptOut()).toBe(true)
    trackAppOpen()
    const body = await flushAndParse()
    expect(body).toBeNull()
  })

  it("sensitive fields are redacted in settings_change", async () => {
    trackSettingsChange("apiKey", "sk-secret-123")
    const body = await flushAndParse()
    const event = body.events[0]
    expect(event.event).toBe("settings_change")
    expect(event.properties.value).toBe("[REDACTED]")
    expect(event.properties.field).toBe("apiKey")
  })

  it("non-sensitive fields are NOT redacted", async () => {
    trackSettingsChange("theme", "dark")
    const body = await flushAndParse()
    expect(body.events[0].properties.value).toBe("dark")
  })

  // ── Phase 1: Existing events ──

  it("trackSessionStart sends correct properties", async () => {
    trackSessionStart("claude", "proj-1")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("session_start")
    expect(body.events[0].properties).toEqual({ agentId: "claude", projectId: "proj-1" })
    expect(body.events[0].platform).toBe("app")
  })

  it("trackSessionEnd sends agentId and durationMs", async () => {
    trackSessionEnd("claude", 120000)
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("session_end")
    expect(body.events[0].properties).toEqual({ agentId: "claude", durationMs: 120000 })
  })

  it("trackAutomationTrigger sends scheduleId and trigger", async () => {
    trackAutomationTrigger("sched-1", "manual")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("automation_trigger")
    expect(body.events[0].properties).toEqual({ scheduleId: "sched-1", trigger: "manual" })
  })

  it("trackAgentLaunch sends agentId and projectId", async () => {
    trackAgentLaunch("codex", "proj-2")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("agent_launch")
    expect(body.events[0].properties).toEqual({ agentId: "codex", projectId: "proj-2" })
  })

  it("trackSlashCommand sends command", async () => {
    trackSlashCommand("/help")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("slash_command")
    expect(body.events[0].properties.command).toBe("/help")
  })

  it("trackDecision sends action and agentId", async () => {
    trackDecision("approve", "claude")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("decision")
    expect(body.events[0].properties).toEqual({ action: "approve", agentId: "claude" })
  })

  it("trackMessageSend sends agentId and hasAttachment", async () => {
    trackMessageSend("claude", true)
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("message_send")
    expect(body.events[0].properties).toEqual({ agentId: "claude", hasAttachment: true })
  })

  it("trackProjectSwitch sends projectId", async () => {
    trackProjectSwitch("proj-3")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("project_switch")
    expect(body.events[0].properties).toEqual({ projectId: "proj-3" })
  })

  it("trackChainExecute sends chainSlug", async () => {
    trackChainExecute("security-audit")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("chain_execute")
    expect(body.events[0].properties).toEqual({ chainSlug: "security-audit" })
  })

  it("trackPrdAction sends action and projectId", async () => {
    trackPrdAction("create", "proj-1")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("prd_action")
    expect(body.events[0].properties).toEqual({ action: "create", projectId: "proj-1" })
  })

  it("trackGitAction sends action and projectId", async () => {
    trackGitAction("commit", "proj-1")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("git_action")
    expect(body.events[0].properties).toEqual({ action: "commit", projectId: "proj-1" })
  })

  it("trackVoiceInput sends event", async () => {
    trackVoiceInput()
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("voice_input")
  })

  it("trackAppOpen sends event", async () => {
    trackAppOpen()
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("app_open")
  })

  it("trackLogin sends event", async () => {
    trackLogin()
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("login")
  })

  // ── Phase 2: New events ──

  it("trackScreenView sends screen and from", async () => {
    trackScreenView("session", "overview")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("screen_view")
    expect(body.events[0].properties).toEqual({ screen: "session", from: "overview" })
  })

  it("trackScreenView omits from when not provided", async () => {
    trackScreenView("launchpad")
    const body = await flushAndParse()
    expect(body.events[0].properties).toEqual({ screen: "launchpad" })
  })

  it("trackTabSwitch sends tab and context", async () => {
    trackTabSwitch("schedules", "unified_panel")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("tab_switch")
    expect(body.events[0].properties).toEqual({ tab: "schedules", context: "unified_panel" })
  })

  it("trackCrewStart sends crew details", async () => {
    trackCrewStart("overnight_sprint", 3, 50000)
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("crew_start")
    expect(body.events[0].properties).toEqual({
      crewName: "overnight_sprint",
      roleCount: 3,
      tokenBudget: 50000,
    })
  })

  it("trackCrewEnd sends success and duration", async () => {
    trackCrewEnd("overnight_sprint", true, 300000)
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("crew_end")
    expect(body.events[0].properties).toEqual({
      crewName: "overnight_sprint",
      success: true,
      durationMs: 300000,
    })
  })

  it("trackScheduleCreate sends templateId and interval", async () => {
    trackScheduleCreate("scan_commits", "daily@09:00")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("schedule_create")
    expect(body.events[0].properties).toEqual({
      templateId: "scan_commits",
      interval: "daily@09:00",
    })
  })

  it("trackPlanCreate sends projectId and priority", async () => {
    trackPlanCreate("proj-1", "p0")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("plan_create")
    expect(body.events[0].properties).toEqual({ projectId: "proj-1", priority: "p0" })
  })

  it("trackPlanExecute sends projectId and taskCount", async () => {
    trackPlanExecute("proj-1", 5)
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("plan_execute")
    expect(body.events[0].properties).toEqual({ projectId: "proj-1", taskCount: 5 })
  })

  it("trackFileBrowse sends projectId", async () => {
    trackFileBrowse("proj-1")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("file_browse")
    expect(body.events[0].properties).toEqual({ projectId: "proj-1" })
  })

  it("trackViewModeChange sends mode", async () => {
    trackViewModeChange("terminal")
    const body = await flushAndParse()
    expect(body.events[0].event).toBe("view_mode_change")
    expect(body.events[0].properties).toEqual({ mode: "terminal" })
  })

  // ── Batching ──

  it("batches multiple events in a single flush", async () => {
    trackAppOpen()
    trackLogin()
    trackSessionStart("claude", "proj-1")

    const body = await flushAndParse()
    expect(body.events).toHaveLength(3)
    expect(body.events[0].event).toBe("app_open")
    expect(body.events[1].event).toBe("login")
    expect(body.events[2].event).toBe("session_start")
  })

  it("all events have platform=app", async () => {
    trackScreenView("overview")
    trackCrewStart("test", 2, 10000)
    trackGitAction("commit", "p1")

    const body = await flushAndParse()
    for (const evt of body.events) {
      expect(evt.platform).toBe("app")
    }
  })

  it("sends x-telemetry-sig header", async () => {
    trackAppOpen()
    await vi.advanceTimersByTimeAsync(31_000)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    const call = fetchMock.mock.calls[0]
    expect(call[1]?.headers).toHaveProperty("x-telemetry-sig")
  })
})
