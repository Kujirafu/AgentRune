import { describe, expect, it } from "vitest"
import {
  buildSummaryPrompt,
  resolveSummaryProviders,
  shouldUseLlmSummary,
} from "./llm-summary.js"

describe("llm-summary helpers", () => {
  it("chooses provider order based on the source agent", () => {
    expect(resolveSummaryProviders("claude")).toEqual(["claude", "openai", "gemini"])
    expect(resolveSummaryProviders("codex")).toEqual(["openai", "claude", "gemini"])
    expect(resolveSummaryProviders("gemini")).toEqual(["gemini", "claude", "openai"])
    expect(resolveSummaryProviders("openclaw")).toEqual(["openai", "claude", "gemini"])
  })

  it("builds locale-aware prompts without forcing every locale to zh-TW", () => {
    expect(buildSummaryPrompt("zh-TW")).toContain("請用繁體中文輸出")
    expect(buildSummaryPrompt("en")).toContain("Return the report in English")
    expect(buildSummaryPrompt("ja")).toContain("Return the report in Japanese")
    expect(buildSummaryPrompt("ko")).toContain("Return the report in Korean")
  })

  it("only enables llm summarization when the output is complex enough", () => {
    expect(shouldUseLlmSummary("Single line")).toBe(false)
    expect(shouldUseLlmSummary([
      "Line one",
      "Line two",
      "Line three",
      "Line four",
    ].join("\n"))).toBe(true)
    expect(shouldUseLlmSummary([
      "__AGENTRUNE_SOCIAL_POST__ {\"platform\":\"threads\"}",
      "--- AgentRune Social Publish ---",
      "Platform: threads",
      "Posted: yes",
      "Post ID: 123",
    ].join("\n"))).toBe(true)
  })
})
