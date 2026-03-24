import { describe, expect, it } from "vitest"

import type { AgentEvent } from "../types"
import { buildSessionActivityEventId, mergeAgentEvent, mergeAgentEventLists, upsertAgentEvent } from "./session-events"

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: "evt-1",
    timestamp: 100,
    type: "response",
    status: "completed",
    title: "Agent replied",
    ...overrides,
  }
}

describe("buildSessionActivityEventId", () => {
  it("prefers the original server event id", () => {
    expect(buildSessionActivityEventId({
      sessionId: "sid-1",
      eventId: "evt-123",
      eventType: "response",
      eventTitle: "Reply",
      agentStatus: "idle",
    })).toBe("evt-123")
  })

  it("falls back to a stable activity id when eventId is missing", () => {
    expect(buildSessionActivityEventId({
      sessionId: "sid-2",
      eventType: "decision_request",
      eventTitle: "Need approval",
      agentStatus: "waiting",
    })).toBe("activity:fallback:sid-2:decision_request:waiting:Need approval")
  })
})

describe("mergeAgentEvent", () => {
  it("keeps rich fields when a later duplicate is only a minimal activity event", () => {
    const rich = makeEvent({ detail: "Detailed response", raw: "raw text" })
    const minimal = makeEvent({ timestamp: 120, detail: undefined, raw: undefined })

    expect(mergeAgentEvent(rich, minimal)).toMatchObject({
      id: "evt-1",
      timestamp: 120,
      detail: "Detailed response",
      raw: "raw text",
    })
  })
})

describe("upsertAgentEvent", () => {
  it("upgrades a minimal session_activity event with the later rich event payload", () => {
    const initial = [makeEvent({ detail: undefined, raw: undefined, timestamp: 100 })]
    const next = upsertAgentEvent(initial, makeEvent({ detail: "Full detail", raw: "raw body", timestamp: 101 }))

    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({
      id: "evt-1",
      detail: "Full detail",
      raw: "raw body",
      timestamp: 101,
    })
  })
})

describe("mergeAgentEventLists", () => {
  it("dedups replayed events by id while preserving the richer payload", () => {
    const existing = [makeEvent({ detail: undefined, timestamp: 100 })]
    const replayed = [
      makeEvent({ detail: "Replayed detail", timestamp: 99 }),
      makeEvent({ id: "evt-2", title: "Another event", timestamp: 110 }),
    ]

    const merged = mergeAgentEventLists(existing, replayed)

    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ id: "evt-1", detail: "Replayed detail" })
    expect(merged[1]).toMatchObject({ id: "evt-2", title: "Another event" })
  })
})
