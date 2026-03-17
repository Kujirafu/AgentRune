import { describe, expect, it } from "vitest"

import { buildSessionActivityPayload, CRASH_PUSH_COOLDOWN_MS, shouldSendCrashPush } from "./crash-notification.js"

describe("shouldSendCrashPush", () => {
  it("allows the first crash notification", () => {
    expect(shouldSendCrashPush(undefined, 1_000)).toBe(true)
  })

  it("suppresses duplicate crash notifications inside the cooldown window", () => {
    expect(shouldSendCrashPush(1_000, 1_000 + CRASH_PUSH_COOLDOWN_MS - 1)).toBe(false)
  })

  it("allows a new crash notification after the cooldown expires", () => {
    expect(shouldSendCrashPush(1_000, 1_000 + CRASH_PUSH_COOLDOWN_MS)).toBe(true)
  })
})

describe("buildSessionActivityPayload", () => {
  it("includes a stable event id and waiting status for decision requests", () => {
    expect(buildSessionActivityPayload("sid-1", {
      id: "evt-1",
      timestamp: 123,
      type: "decision_request",
      status: "waiting",
      title: "Codex has exited",
    })).toEqual({
      type: "session_activity",
      sessionId: "sid-1",
      eventId: "evt-1",
      eventType: "decision_request",
      eventTitle: "Codex has exited",
      agentStatus: "waiting",
    })
  })

  it("maps completed events to idle activity", () => {
    const payload = buildSessionActivityPayload("sid-2", {
      id: "evt-2",
      timestamp: 456,
      type: "response",
      status: "completed",
      title: "Done",
    })

    expect(payload.agentStatus).toBe("idle")
    expect(payload.eventId).toBe("evt-2")
  })
})
