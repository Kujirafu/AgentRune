import { describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "../types"
import { buildSessionAttachMessage } from "./session-attach"

describe("session-attach", () => {
  it("includes Codex settings in attach messages", () => {
    const msg = buildSessionAttachMessage({
      projectId: "demo",
      agentId: "codex",
      sessionId: "demo_123",
      autoSaveKeys: true,
      autoSaveKeysPath: "~/.agentrune/secrets",
      shouldResumeAgent: true,
      settings: {
        ...DEFAULT_SETTINGS,
        codexModel: "gpt-5.4",
        codexMode: "full-auto",
        codexReasoningEffort: "high",
      },
      locale: "zh-TW",
    })

    expect(msg.settings.codexModel).toBe("gpt-5.4")
    expect(msg.settings.codexMode).toBe("full-auto")
    expect(msg.settings.codexReasoningEffort).toBe("high")
    expect(msg.settings.sandboxLevel).toBe("none")
    expect(msg.settings.requirePlanReview).toBe(false)
    expect(msg.settings.requireMergeApproval).toBe(false)
    expect(msg.isAgentResume).toBe(true)
  })
})
