import { renderHook } from "@testing-library/react"
import { useSessionDigests } from "./useSessionDigests"
import { describe, it, expect } from "vitest"
import type { AppSession, AgentEvent } from "../types"

function makeSession(id: string, projectId = "proj1", agentId = "claude"): AppSession {
  return { id, projectId, agentId }
}

function makeEvent(id: string, type: AgentEvent["type"], status: AgentEvent["status"], title = "", timestamp = Date.now()): AgentEvent {
  return { id, timestamp, type, status, title }
}

describe("useSessionDigests", () => {
  it("returns empty map for no sessions", () => {
    const { result } = renderHook(() => useSessionDigests([], new Map(), "en"))
    expect(result.current.size).toBe(0)
  })

  it("builds digest for each session", () => {
    const sessions = [makeSession("s1"), makeSession("s2")]
    const events = new Map<string, AgentEvent[]>()
    events.set("s1", [makeEvent("e1", "response", "completed", "Did something")])
    events.set("s2", [makeEvent("e2", "error", "failed", "Build failed")])

    const { result } = renderHook(() => useSessionDigests(sessions, events, "en"))
    expect(result.current.size).toBe(2)
    expect(result.current.get("s1")).toBeDefined()
    expect(result.current.get("s2")).toBeDefined()
    expect(result.current.get("s2")!.status).toBe("blocked")
  })

  it("passes locale through to digest", () => {
    const sessions = [makeSession("s1")]
    const events = new Map<string, AgentEvent[]>()
    events.set("s1", [
      makeEvent("e1", "error", "failed", "Build failed"),
    ])

    const { result: enResult } = renderHook(() => useSessionDigests(sessions, events, "en"))
    const { result: zhResult } = renderHook(() => useSessionDigests(sessions, events, "zh-TW"))

    // Both should have a digest but may differ in nextAction text
    expect(enResult.current.get("s1")!.status).toBe("blocked")
    expect(zhResult.current.get("s1")!.status).toBe("blocked")
  })

  it("uses display label callback", () => {
    const sessions = [makeSession("s1")]
    const events = new Map<string, AgentEvent[]>()
    events.set("s1", [makeEvent("e1", "response", "completed", "Working on feature")])

    const getLabel = (s: AppSession) => `Custom-${s.id}`
    const { result } = renderHook(() => useSessionDigests(sessions, events, "en", getLabel))

    expect(result.current.get("s1")!.displayLabel).toBe("Custom-s1")
  })

  it("memoizes: same input returns same reference", () => {
    const sessions = [makeSession("s1")]
    const events = new Map<string, AgentEvent[]>()
    events.set("s1", [makeEvent("e1", "response", "completed", "Done")])

    const { result, rerender } = renderHook(() => useSessionDigests(sessions, events, "en"))
    const first = result.current
    rerender()
    expect(result.current).toBe(first) // Same reference
  })

  it("categorizes working session correctly", () => {
    const sessions = [makeSession("s1")]
    const events = new Map<string, AgentEvent[]>()
    events.set("s1", [makeEvent("e1", "command_run", "in_progress", "npm run build")])

    const { result } = renderHook(() => useSessionDigests(sessions, events, "en"))
    expect(result.current.get("s1")!.status).toBe("working")
  })

  it("handles session with no events as idle", () => {
    const sessions = [makeSession("s1")]
    const events = new Map<string, AgentEvent[]>()
    // No events for s1

    const { result } = renderHook(() => useSessionDigests(sessions, events, "en"))
    expect(result.current.get("s1")!.status).toBe("idle")
  })
})
