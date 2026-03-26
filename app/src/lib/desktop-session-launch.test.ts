import { describe, expect, it } from "vitest"
import type { AppSession } from "../types"
import { DEFAULT_SETTINGS } from "../types"
import { buildDesktopLaunchAttachMessage, resolveDesktopLaunchAgentId } from "./desktop-session-launch"

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

describe("buildDesktopLaunchAttachMessage", () => {
  it("uses saved desktop launch settings and resumes agent sessions when requested", () => {
    localStorage.clear()
    localStorage.setItem("agentrune_auto_save_keys", "true")
    localStorage.setItem("agentrune_auto_save_keys_path", "C:\\vault")
    localStorage.setItem("agentrune_settings_demo", JSON.stringify({
      ...DEFAULT_SETTINGS,
      bypass: true,
      sandboxLevel: "workspace-write",
      requirePlanReview: true,
      codexModel: "gpt-5.4",
    }))

    const msg = buildDesktopLaunchAttachMessage({
      projectId: "demo",
      agentId: "codex",
      sessionId: "demo_123",
      locale: "zh-TW",
      resumeAgentSessionId: "resume-abc",
    })

    expect(msg.type).toBe("attach")
    expect(msg.projectId).toBe("demo")
    expect(msg.agentId).toBe("codex")
    expect(msg.sessionId).toBe("demo_123")
    expect(msg.autoSaveKeys).toBe(true)
    expect(msg.autoSaveKeysPath).toBe("C:\\vault")
    expect(msg.isAgentResume).toBe(true)
    expect(msg.claudeSessionId).toBe("resume-abc")
    expect(msg.settings.locale).toBe("zh-TW")
    expect(msg.settings.bypass).toBe(true)
    expect(msg.settings.sandboxLevel).toBe("workspace-write")
    expect(msg.settings.requirePlanReview).toBe(true)
    expect(msg.settings.codexModel).toBe("gpt-5.4")
  })
})
