import { describe, expect, it } from "vitest"

import { claudeCodeAdapter } from "./claude-code.js"
import type { ParseContext } from "../shared/types.js"

function makeContext(): ParseContext {
  return {
    agentId: "claude",
    projectId: "demo",
    buffer: "",
    isIdle: false,
  }
}

describe("claude-code adapter fallback responses", () => {
  it("keeps the full accumulated fallback response detail instead of truncating at 3000 characters", () => {
    const ctx = makeContext()
    const longReply = "A".repeat(4_500)

    claudeCodeAdapter.parse(`● ${longReply}\n`, ctx)

    ctx.buffer += "\n>"
    ctx.isIdle = true

    const events = claudeCodeAdapter.parse(">\n", ctx)
    const response = events.find((event) => event.title === "Claude responded (detailed)")

    expect(response?.type).toBe("info")
    expect(response?.detail).toHaveLength(longReply.length)
    expect(response?.detail).toBe(longReply)
  })
})
