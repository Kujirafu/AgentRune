import { describe, expect, it } from "vitest"
import type { AgentEvent, AppSession } from "../types"
import { resolveDesktopSessionTarget, looksLikeFollowUpReply } from "./desktop-session-routing"
import type { SessionDecisionDigest } from "./session-summary"

const sessions: AppSession[] = [
  { id: "s1", projectId: "p1", agentId: "claude", createdAt: 1000, taskTitle: "Fix auth flow" },
  { id: "s2", projectId: "p1", agentId: "codex", createdAt: 2000, taskTitle: "Refresh dashboard docs" },
]

function makeDigests(
  overrides?: Partial<Record<string, Partial<SessionDecisionDigest>>>,
): Map<string, SessionDecisionDigest> {
  const base: Record<string, SessionDecisionDigest> = {
    s1: {
      sessionId: "s1",
      agentId: "claude",
      displayLabel: "Auth Fix",
      status: "working",
      summary: "Fixing login redirect bug",
      nextAction: "Verify the callback path",
      updatedAt: 2_000,
      priority: 90,
      source: "progress",
      shouldResume: true,
    },
    s2: {
      sessionId: "s2",
      agentId: "codex",
      displayLabel: "Docs",
      status: "idle",
      summary: "Update dashboard copy",
      nextAction: "",
      updatedAt: 1_500,
      priority: 20,
      source: "response",
      shouldResume: false,
    },
  }
  for (const [sessionId, patch] of Object.entries(overrides || {})) {
    if (base[sessionId] && patch) Object.assign(base[sessionId], patch)
  }
  return new Map(Object.entries(base))
}

function makeEvents(overrides?: Partial<Record<string, AgentEvent[]>>): Map<string, AgentEvent[]> {
  const base = new Map<string, AgentEvent[]>([
    ["s1", [{ id: "e1", timestamp: 2_100, type: "progress_report", status: "in_progress", title: "Still fixing auth" }]],
    ["s2", [{ id: "e2", timestamp: 1_200, type: "response", status: "completed", title: "Docs ready" }]],
  ])
  for (const [sessionId, events] of Object.entries(overrides || {})) {
    base.set(sessionId, events || [])
  }
  return base
}

describe("looksLikeFollowUpReply", () => {
  it("treats short acknowledgements as follow-up replies", () => {
    expect(looksLikeFollowUpReply("好")).toBe(true)
    expect(looksLikeFollowUpReply("繼續")).toBe(true)
    expect(looksLikeFollowUpReply("continue")).toBe(true)
  })

  it("does not treat slash commands or long prompts as follow-up replies", () => {
    expect(looksLikeFollowUpReply("/model opus")).toBe(false)
    expect(looksLikeFollowUpReply("請幫我另外開一個 session 處理 dashboard 的重構")).toBe(false)
  })
})

describe("resolveDesktopSessionTarget", () => {
  it("routes follow-up replies to the current working session instead of opening a new one", () => {
    const sessionId = resolveDesktopSessionTarget({
      text: "好",
      targetSessionId: null,
      sessions,
      digests: makeDigests(),
      sessionEvents: makeEvents(),
    })
    expect(sessionId).toBe("s1")
  })

  it("prefers the single expanded session when the user is focused on it", () => {
    const sessionId = resolveDesktopSessionTarget({
      text: "幫我補上驗證",
      targetSessionId: null,
      expandedSessionIds: new Set(["s2"]),
      sessions,
      digests: makeDigests(),
      sessionEvents: makeEvents(),
    })
    expect(sessionId).toBe("s2")
  })

  it("keeps routing to the only actionable session", () => {
    const sessionId = resolveDesktopSessionTarget({
      text: "繼續",
      targetSessionId: null,
      sessions,
      digests: makeDigests({ s2: { status: "done" } }),
      sessionEvents: makeEvents(),
    })
    expect(sessionId).toBe("s1")
  })

  it("still targets the only live session even before its digest is available", () => {
    const sessionId = resolveDesktopSessionTarget({
      text: "好",
      targetSessionId: null,
      sessions: [{ id: "s3", projectId: "p1", agentId: "claude", createdAt: 3000 }],
      digests: new Map(),
      sessionEvents: new Map(),
    })
    expect(sessionId).toBe("s3")
  })

  it("routes related work to an idle session instead of creating a new one", () => {
    const sessionId = resolveDesktopSessionTarget({
      text: "update dashboard docs",
      targetSessionId: null,
      sessions,
      digests: makeDigests({ s1: { status: "done" } }),
      sessionEvents: makeEvents(),
    })
    expect(sessionId).toBe("s2")
  })

  it("still returns null when every live session is busy and the prompt is unrelated new work", () => {
    const sessionId = resolveDesktopSessionTarget({
      text: "build a brand new android release checklist",
      targetSessionId: null,
      sessions,
      digests: makeDigests({ s2: { status: "working", summary: "Refactoring session events", updatedAt: 2_200, priority: 95 } }),
      sessionEvents: makeEvents({
        s2: [{ id: "e3", timestamp: 2_300, type: "progress_report", status: "in_progress", title: "Refactoring session events" }],
      }),
    })
    expect(sessionId).toBeNull()
  })

  it("returns null when the desktop UI explicitly requested a brand-new session", () => {
    const sessionId = resolveDesktopSessionTarget({
      text: "start a new android release checklist",
      forceNewSession: true,
      targetSessionId: "s1",
      expandedSessionIds: new Set(["s2"]),
      sessions,
      digests: makeDigests(),
      sessionEvents: makeEvents(),
    })
    expect(sessionId).toBeNull()
  })
})
