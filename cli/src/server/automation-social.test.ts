import { describe, expect, it } from "vitest"
import {
  buildAutomationSocialInstructions,
  detectAutomationSocialMode,
  extractAutomationSocialDirective,
  outputNeedsManualIntervention,
} from "./automation-social.js"

describe("automation-social", () => {
  it("detects Threads automations from prompt references", () => {
    expect(detectAutomationSocialMode({
      name: "Threads",
      prompt: "Read the materials library and publish to Threads.",
    })).toEqual({ platform: "threads" })
  })

  it("builds marker instructions for social automations", () => {
    const block = buildAutomationSocialInstructions({ platform: "threads" })
    expect(block).toContain("__AGENTRUNE_SOCIAL_POST__")
    expect(block).toContain("__AGENTRUNE_SOCIAL_SKIP__")
    expect(block).toContain("Do NOT tell the user to post manually.")
    expect(block).toContain("Do NOT edit the materials library")
    expect(block).toContain("Network access is NOT required for you.")
    expect(block).toContain("reject duplicate or trivially reformatted post text")
  })

  it("extracts post directives from final output", () => {
    const output = [
      "Selected approved copy.",
      "__AGENTRUNE_SOCIAL_POST__ {\"platform\":\"threads\",\"text\":\"Use the approved copy\",\"source\":\"Threads materials Day 1\",\"reason\":\"More than 24h since the previous post\",\"recordType\":\"Agent 視角\",\"recordTitle\":\"AI 盲區\",\"recordMetrics\":\"-\"}",
    ].join("\n")

    expect(extractAutomationSocialDirective(output, "threads")).toEqual({
      kind: "post",
      platform: "threads",
      text: "Use the approved copy",
      source: "Threads materials Day 1",
      reason: "More than 24h since the previous post",
      recordType: "Agent 視角",
      recordTitle: "AI 盲區",
      recordMetrics: "-",
    })
  })

  it("extracts skip directives from final output", () => {
    const output = [
      "No post should be sent now.",
      "__AGENTRUNE_SOCIAL_SKIP__ {\"platform\":\"threads\",\"reason\":\"Cooldown has not expired\",\"source\":\"Threads materials index\"}",
    ].join("\n")

    expect(extractAutomationSocialDirective(output, "threads")).toEqual({
      kind: "skip",
      platform: "threads",
      reason: "Cooldown has not expired",
      source: "Threads materials index",
    })
  })

  it("detects manual-intervention outputs", () => {
    expect(outputNeedsManualIntervention("Copy the text and post manually in Threads.")).toBe(true)
    expect(outputNeedsManualIntervention("Publish through AgentRune daemon only.")).toBe(false)
  })
})
