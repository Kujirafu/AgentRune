import { describe, expect, it } from "vitest"

import type { AgentEvent } from "../shared/types.js"
import {
  MAX_SESSION_EVENT_HISTORY,
  mergeSessionRecentEvents,
  normalizeSessionRecentEvents,
} from "./session-event-buffer.js"

function makeEvent(index: number, type: AgentEvent["type"] = "info"): AgentEvent {
  return {
    id: `evt-${index}`,
    timestamp: index,
    type,
    status: "completed",
    title: `Event ${index}`,
  }
}

describe("session-event-buffer", () => {
  it("creates a new buffer when live events arrive before a session list exists", () => {
    const result = mergeSessionRecentEvents(undefined, [makeEvent(1), makeEvent(2)])

    expect(result.map((event) => event.id)).toEqual(["evt-1", "evt-2"])
  })

  it("filters token usage noise from stored history", () => {
    const result = mergeSessionRecentEvents([makeEvent(1, "token_usage")], [makeEvent(2), makeEvent(3, "token_usage")])

    expect(result.map((event) => event.id)).toEqual(["evt-2"])
  })

  it("caps persisted history to the newest session events", () => {
    const manyEvents = Array.from({ length: MAX_SESSION_EVENT_HISTORY + 20 }, (_, index) => makeEvent(index))

    const result = normalizeSessionRecentEvents(manyEvents)

    expect(result).toHaveLength(MAX_SESSION_EVENT_HISTORY)
    expect(result[0]?.id).toBe("evt-20")
    expect(result.at(-1)?.id).toBe(`evt-${MAX_SESSION_EVENT_HISTORY + 19}`)
  })
})
