import { describe, expect, it } from "vitest"
import type { AppSession } from "../types"
import { resolveDesktopLaunchAgentId } from "./desktop-session-launch"

const sessions: AppSession[] = [
  { id: "p1_1000", projectId: "p1", agentId: "claude", createdAt: 1000 },
  { id: "p1_2000", projectId: "p1", agentId: "codex", createdAt: 2000, status: "recoverable" },
  { id: "p2_3000", projectId: "p2", agentId: "gemini", createdAt: 3000 },
]

describe("resolveDesktopLaunchAgentId", () => {
  it("uses the targeted session agent when one is selected", () => {
    expect(resolveDesktopLaunchAgentId({
      targetSessionId: "p1_1000",
      sessions,
      selectedProjectId: "p1",
    })).toBe("claude")
  })

  it("prefers the newest session agent in the selected project", () => {
    expect(resolveDesktopLaunchAgentId({
      targetSessionId: null,
      sessions,
      selectedProjectId: "p1",
    })).toBe("codex")
  })

  it("prefers the expanded session agent inside the selected project", () => {
    expect(resolveDesktopLaunchAgentId({
      targetSessionId: null,
      expandedSessionIds: new Set(["p1_1000"]),
      sessions,
      selectedProjectId: "p1",
    })).toBe("claude")
  })

  it("falls back to the newest overall session agent, then Claude", () => {
    expect(resolveDesktopLaunchAgentId({
      targetSessionId: null,
      sessions,
      selectedProjectId: "missing",
    })).toBe("gemini")

    expect(resolveDesktopLaunchAgentId({
      targetSessionId: null,
      sessions: [],
      selectedProjectId: null,
    })).toBe("claude")
  })
})
