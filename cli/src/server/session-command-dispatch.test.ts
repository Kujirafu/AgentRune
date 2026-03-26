import { describe, expect, it } from "vitest"
import {
  buildQueuedSessionTextPayload,
  getQueuedSessionScrollbackSignature,
  getQueuedSessionStablePollThreshold,
  getQueuedSessionSubmitDelayMs,
  isImmediateSessionInput,
  isQueuedSessionScrollbackStable,
  isSessionPromptReady,
} from "./session-command-dispatch.js"

describe("session-command-dispatch", () => {
  it("detects prompt markers in scrollback", () => {
    expect(isSessionPromptReady("OpenAI Codex\n\n  gpt-5.4 xhigh · 100% left · ~\\repo", "codex")).toBe(true)
    expect(isSessionPromptReady("Claude Code\n> ", "claude")).toBe(true)
  })

  it("does not treat normal output as a ready prompt", () => {
    expect(isSessionPromptReady("Reading .agentrune/agentlore.md", "codex")).toBe(false)
    expect(isSessionPromptReady("Working (3s, esc to interrupt)\n\n  gpt-5.4 xhigh · 100% left · ~\\repo", "codex")).toBe(false)
  })

  it("accepts a plain terminal prompt as a Codex-ready fallback", () => {
    expect(isSessionPromptReady("OpenAI Codex\n\n>", "codex")).toBe(true)
  })

  it("uses stable non-empty scrollback as a fallback when prompt markers are missing", () => {
    const scrollback = "\u001b[2mThinking about repository structure...\u001b[0m"
    expect(getQueuedSessionScrollbackSignature(scrollback)).toContain("Thinking about repository structure")
    expect(isQueuedSessionScrollbackStable(scrollback, "claude", getQueuedSessionStablePollThreshold("claude") - 1)).toBe(false)
    expect(isQueuedSessionScrollbackStable(scrollback, "claude", getQueuedSessionStablePollThreshold("claude"))).toBe(true)
    expect(isQueuedSessionScrollbackStable("", "claude", getQueuedSessionStablePollThreshold("claude"))).toBe(false)
  })

  it("treats control sequences and approval keystrokes as immediate input", () => {
    expect(isImmediateSessionInput("\x03")).toBe(true)
    expect(isImmediateSessionInput("\x1b[B\r")).toBe(true)
    expect(isImmediateSessionInput("y\n")).toBe(true)
    expect(isImmediateSessionInput("a\n")).toBe(true)
    expect(isImmediateSessionInput("please continue")).toBe(false)
  })

  it("wraps Claude and Codex multiline payloads in bracket paste", () => {
    const text = "[AgentLore Skill Chain: qa]\nStep 1\nStep 2"
    expect(buildQueuedSessionTextPayload("claude", text, "initial")).toContain("\x1b[200~")
    expect(buildQueuedSessionTextPayload("codex", text, "initial")).toContain("\x1b[200~")
    expect(buildQueuedSessionTextPayload("codex", text, "regular")).toContain("\x1b[200~")
    expect(buildQueuedSessionTextPayload("gemini", text, "initial")).toBe(text)
  })

  it("uses shorter queued submit delays", () => {
    expect(getQueuedSessionSubmitDelayMs("/status")).toBe(180)
    expect(getQueuedSessionSubmitDelayMs("review this patch")).toBe(220)
    expect(getQueuedSessionSubmitDelayMs("[AgentLore Skill Chain: qa]\nStep 1\nStep 2", "codex")).toBeGreaterThanOrEqual(450)
    expect(getQueuedSessionSubmitDelayMs("[AgentLore Skill Chain: qa]\nStep 1\nStep 2", "codex")).toBeLessThanOrEqual(1600)
  })
})
