import { describe, expect, it } from "vitest"

import { cursorAdapter } from "./cursor.js"
import type { ParseContext } from "../shared/types.js"

function makeContext(): ParseContext {
  return {
    agentId: "cursor",
    projectId: "demo",
    buffer: "",
    isIdle: false,
  }
}

describe("cursor adapter fallback responses", () => {
  it("keeps the full accumulated fallback response detail instead of truncating at 3000 characters", () => {
    const ctx = makeContext()
    const longReply = "B".repeat(4_500)

    cursorAdapter.parse(`• ${longReply}\n`, ctx)

    ctx.buffer += "\n>"
    ctx.isIdle = true

    const events = cursorAdapter.parse(">\n", ctx)
    const response = events.find((event) => event.title === "Cursor responded (detailed)")

    expect(response?.type).toBe("info")
    expect(response?.detail?.length || 0).toBeGreaterThan(longReply.length)
    expect(response?.detail).toContain(longReply)
  })
})
