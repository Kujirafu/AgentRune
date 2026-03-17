import { describe, expect, it } from "vitest"

import { getSessionActivityNotificationId, getSessionActivityNotificationKey, hashStableString } from "./session-activity"

describe("hashStableString", () => {
  it("returns a stable unsigned hash", () => {
    expect(hashStableString("codex-crash")).toBe(hashStableString("codex-crash"))
    expect(hashStableString("codex-crash")).toBeGreaterThanOrEqual(0)
  })
})

describe("getSessionActivityNotificationKey", () => {
  it("prefers the server event id when available", () => {
    expect(getSessionActivityNotificationKey({
      sessionId: "sid-1",
      eventId: "crash_sid-1_1",
      eventTitle: "Codex has exited",
      agentStatus: "waiting",
    })).toBe("event:sid-1:crash_sid-1_1")
  })

  it("falls back to session-scoped content when the event id is missing", () => {
    expect(getSessionActivityNotificationKey({
      sessionId: "sid-2",
      eventType: "decision_request",
      eventTitle: "Agent needs confirmation",
      agentStatus: "waiting",
    })).toBe("fallback:sid-2:decision_request:waiting:Agent needs confirmation")
  })

  it("returns null without a session id", () => {
    expect(getSessionActivityNotificationKey({ eventId: "evt-1" })).toBeNull()
  })
})

describe("getSessionActivityNotificationId", () => {
  it("uses the derived key for stable notification ids", () => {
    const first = getSessionActivityNotificationId({
      sessionId: "sid-3",
      eventId: "evt-3",
      eventTitle: "Codex has exited",
      agentStatus: "waiting",
    })
    const second = getSessionActivityNotificationId({
      sessionId: "sid-3",
      eventId: "evt-3",
      eventTitle: "Codex has exited",
      agentStatus: "waiting",
    })

    expect(first).toBe(second)
    expect(first).toBeGreaterThan(0)
  })
})
