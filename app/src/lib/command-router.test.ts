import { describe, it, expect } from "vitest"
import { splitCompoundCommand, routeCommand, routeCommandEnhanced } from "./command-router"
import type { AppSession } from "../types"
import type { SessionDecisionDigest } from "./session-summary"

// --- splitCompoundCommand ---
describe("splitCompoundCommand", () => {
  it("splits on Chinese connectors", () => {
    expect(splitCompoundCommand("修 auth 然後更新 docs")).toEqual(["修 auth", "更新 docs"])
  })

  it("splits on semicolons", () => {
    expect(splitCompoundCommand("fix auth; update docs")).toEqual(["fix auth", "update docs"])
  })

  it("returns single part when no connectors", () => {
    expect(splitCompoundCommand("fix the login bug")).toEqual(["fix the login bug"])
  })
})

// --- routeCommandEnhanced ---
const sessions: AppSession[] = [
  { id: "s1", projectId: "p1", agentId: "claude" },
  { id: "s2", projectId: "p1", agentId: "gemini" },
]

function makeDigests(overrides?: Partial<Record<string, Partial<SessionDecisionDigest>>>): Map<string, SessionDecisionDigest> {
  const base: Record<string, SessionDecisionDigest> = {
    s1: { status: "working", summary: "Fixing auth module login flow", nextAction: "Run tests", displayLabel: "Auth Fix", updatedAt: Date.now(), priority: 1, source: "progress", shouldResume: false },
    s2: { status: "idle", summary: "Updating documentation pages", nextAction: "", displayLabel: "Docs Update", updatedAt: Date.now(), priority: 2, source: "progress", shouldResume: false },
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (base[k] && v) Object.assign(base[k], v)
    }
  }
  return new Map(Object.entries(base))
}

const emptyEvents = new Map<string, { title?: string }[]>()

describe("routeCommandEnhanced", () => {
  it("routes >claude to claude session", () => {
    const result = routeCommandEnhanced(">claude fix auth", sessions, makeDigests(), emptyEvents)
    expect(result).toHaveLength(1)
    expect(result[0].sessionId).toBe("s1")
    expect(result[0].agents).toEqual(["claude"])
    expect(result[0].instruction).toBe("fix auth")
  })

  it("routes >gemini to gemini session", () => {
    const result = routeCommandEnhanced(">gemini update docs", sessions, makeDigests(), emptyEvents)
    expect(result).toHaveLength(1)
    expect(result[0].sessionId).toBe("s2")
    expect(result[0].agents).toEqual(["gemini"])
  })

  it("multi-agent command routes to different sessions", () => {
    const result = routeCommandEnhanced(">claude fix auth; >gemini update docs", sessions, makeDigests(), emptyEvents)
    expect(result).toHaveLength(2)
    expect(result[0].sessionId).toBe("s1")
    expect(result[0].agents).toEqual(["claude"])
    expect(result[1].sessionId).toBe("s2")
    expect(result[1].agents).toEqual(["gemini"])
  })

  it("extracts model in result", () => {
    const result = routeCommandEnhanced(">claude >opus refactor core", sessions, makeDigests(), emptyEvents)
    expect(result[0].models).toEqual(["opus"])
    expect(result[0].agents).toEqual(["claude"])
  })

  it("falls back to keyword matching when no agent specified", () => {
    const result = routeCommandEnhanced("fix the auth login", sessions, makeDigests(), emptyEvents)
    expect(result).toHaveLength(1)
    // Should match s1 (auth/login keywords)
    expect(result[0].sessionId).toBe("s1")
    expect(result[0].agents).toEqual([])
  })

  it("signals new session for unknown agent session", () => {
    const result = routeCommandEnhanced(">aider do something", sessions, makeDigests(), emptyEvents)
    expect(result[0].sessionId).toBeNull()
    expect(result[0].agents).toEqual(["aider"])
    expect(result[0].matchReason).toContain("new")
  })

  it("skips done sessions for agent matching", () => {
    const digests = makeDigests({ s1: { status: "done" } })
    const result = routeCommandEnhanced(">claude fix auth", sessions, digests, emptyEvents)
    // s1 is done, so no match -> launch new
    expect(result[0].sessionId).toBeNull()
  })
})

// --- routeCommand (legacy) ---
describe("routeCommand", () => {
  it("routes to best keyword match", () => {
    const result = routeCommand("fix auth login", sessions, makeDigests(), emptyEvents)
    expect(result).toHaveLength(1)
    expect(result[0].sessionId).toBe("s1")
  })

  it("returns null session when no match", () => {
    const result = routeCommand("something completely unrelated xyz", sessions, makeDigests(), emptyEvents)
    expect(result[0].sessionId).toBeNull()
  })
})
