import { describe, it, expect } from "vitest"
import { extractAgentTokens } from "./agent-parser"

describe("extractAgentTokens", () => {
  it("extracts single agent", () => {
    const r = extractAgentTokens(">claude fix the auth bug")
    expect(r.agents).toEqual(["claude"])
    expect(r.models).toEqual([])
    expect(r.cleanedText).toBe("fix the auth bug")
  })

  it("extracts model", () => {
    const r = extractAgentTokens(">opus refactor core")
    expect(r.agents).toEqual([])
    expect(r.models).toEqual(["opus"])
    expect(r.cleanedText).toBe("refactor core")
  })

  it("extracts agent + model combo", () => {
    const r = extractAgentTokens(">claude >opus fix auth")
    expect(r.agents).toEqual(["claude"])
    expect(r.models).toEqual(["opus"])
    expect(r.cleanedText).toBe("fix auth")
  })

  it("handles unknown token as warning", () => {
    const r = extractAgentTokens(">unknown do stuff")
    expect(r.agents).toEqual([])
    expect(r.models).toEqual([])
    expect(r.unknowns).toEqual(["unknown"])
    expect(r.cleanedText).toBe("do stuff")
  })

  it("leaves non-> text untouched", () => {
    const r = extractAgentTokens("fix the login page")
    expect(r.agents).toEqual([])
    expect(r.models).toEqual([])
    expect(r.cleanedText).toBe("fix the login page")
  })

  it("handles > in middle of text", () => {
    const r = extractAgentTokens("fix >claude the auth >opus bug")
    expect(r.agents).toEqual(["claude"])
    expect(r.models).toEqual(["opus"])
    expect(r.cleanedText).toBe("fix the auth bug")
  })

  it("handles multiple agents for multi-session", () => {
    const r = extractAgentTokens(">claude fix auth; >gemini update docs")
    expect(r.agents).toEqual(["claude", "gemini"])
    expect(r.cleanedText).toBe("fix auth; update docs")
  })

  it("deduplicates repeated agents", () => {
    const r = extractAgentTokens(">claude do this >claude and that")
    expect(r.agents).toEqual(["claude"])
    expect(r.cleanedText).toBe("do this and that")
  })
})
