import { describe, expect, it } from "vitest"
import {
  buildQueuedSessionTextPayload,
  getQueuedSessionSubmitDelayMs,
  isImmediateSessionInput,
  isSessionPromptReady,
} from "./session-command-dispatch.js"

describe("session-command-dispatch", () => {
  it("detects prompt markers in scrollback", () => {
    expect(isSessionPromptReady("OpenAI Codex\n> ", "codex")).toBe(true)
    expect(isSessionPromptReady("Claude Code\n❯ ", "claude")).toBe(true)
  })

  it("does not treat normal output as a ready prompt", () => {
    expect(isSessionPromptReady("Reading .agentrune/agentlore.md", "codex")).toBe(false)
  })

  it("treats control sequences and approval keystrokes as immediate input", () => {
    expect(isImmediateSessionInput("\x03")).toBe(true)
    expect(isImmediateSessionInput("\x1b[B\r")).toBe(true)
    expect(isImmediateSessionInput("y\n")).toBe(true)
    expect(isImmediateSessionInput("a\n")).toBe(true)
    expect(isImmediateSessionInput("please continue")).toBe(false)
  })

  it("wraps only Claude initial multiline payloads in bracket paste", () => {
    const text = "[AgentLore Skill Chain: qa]\nStep 1\nStep 2"
    expect(buildQueuedSessionTextPayload("claude", text, "initial")).toContain("\x1b[200~")
    expect(buildQueuedSessionTextPayload("codex", text, "initial")).toBe(text)
    expect(buildQueuedSessionTextPayload("claude", text, "regular")).toBe(text)
  })

  it("uses a shorter submit delay for slash commands", () => {
    expect(getQueuedSessionSubmitDelayMs("/status")).toBe(300)
    expect(getQueuedSessionSubmitDelayMs("review this patch")).toBe(500)
  })
})
