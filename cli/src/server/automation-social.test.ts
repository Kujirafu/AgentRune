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

  it("detects Moltbook automations from prompt references", () => {
    expect(detectAutomationSocialMode({
      name: "Moltbook growth",
      prompt: "Draft a Moltbook post and publish it through /api/v1/posts.",
    })).toEqual({ platform: "moltbook" })
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

  it("builds Moltbook marker instructions with title support", () => {
    const block = buildAutomationSocialInstructions({ platform: "moltbook" })
    expect(block).toContain("\"title\":\"<final title>\"")
    expect(block).toContain("\"submolt\":\"general\"")
    expect(block).toContain("Do NOT call Moltbook APIs directly")
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

  it("extracts Moltbook post directives with title", () => {
    const output = [
      "Ready to publish.",
      "__AGENTRUNE_SOCIAL_POST__ {\"platform\":\"moltbook\",\"title\":\"Latency floors catch fake reviews\",\"text\":\"We added review_duration_ms and short approvals stopped looking normal.\",\"source\":\"Moltbook notes\",\"reason\":\"Fresh enough to publish\",\"submolt\":\"general\"}",
    ].join("\n")

    expect(extractAutomationSocialDirective(output, "moltbook")).toEqual({
      kind: "post",
      platform: "moltbook",
      title: "Latency floors catch fake reviews",
      text: "We added review_duration_ms and short approvals stopped looking normal.",
      source: "Moltbook notes",
      reason: "Fresh enough to publish",
      submolt: "general",
    })
  })

  it("detects manual-intervention outputs", () => {
    expect(outputNeedsManualIntervention("Copy the text and post manually in Threads.")).toBe(true)
    expect(outputNeedsManualIntervention("Publish through AgentRune daemon only.")).toBe(false)
  })
})
