import { describe, it, expect, vi } from "vitest"

// We need to test isConversationalResponse which is not exported,
// so we test it indirectly via cleanupVoiceText (no API key → returns raw text)
// But first, let's test the exported function's edge cases.

// Mock logger to avoid file system side effects
vi.mock("../shared/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Mock fs to avoid reading credential files
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => { throw new Error("not found") }),
}))

import { cleanupVoiceText } from "./voice-cleanup.js"

describe("cleanupVoiceText", () => {
  it("空字串直接回傳，不呼叫任何 API", async () => {
    const result = await cleanupVoiceText("", "claude")
    expect(result.original).toBe("")
    expect(result.cleaned).toBe("")
    expect(result.model).toBe("none")
  })

  it("純空白也算空", async () => {
    const result = await cleanupVoiceText("   ", "claude")
    expect(result.cleaned).toBe("")
    expect(result.model).toBe("none")
  })

  it("沒有 API key 時回傳 trimmed 原文", async () => {
    // 清除所有可能的 env key
    const saved = { ...process.env }
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_API_KEY

    const result = await cleanupVoiceText("  幫我寫一個 function  ", "claude")
    expect(result.original).toBe("  幫我寫一個 function  ")
    expect(result.cleaned).toBe("幫我寫一個 function")
    expect(result.model).toBe("none")
    expect(result.provider).toBe("none")

    // 還原 env
    Object.assign(process.env, saved)
  })

  it("未知 agent ID 也不會 crash", async () => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_API_KEY

    const result = await cleanupVoiceText("test input", "unknown-agent")
    expect(result.cleaned).toBe("test input")
    expect(result.model).toBe("none")
  })
})
