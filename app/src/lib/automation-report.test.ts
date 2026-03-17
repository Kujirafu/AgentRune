import { describe, expect, it } from "vitest"
import {
  buildAutomationReport,
  getAutomationReportSectionTitle,
  getAutomationResultStatusLabel,
} from "./automation-report"

describe("buildAutomationReport", () => {
  it("turns mixed raw output into a readable markdown report", () => {
    const output = [
      "__AGENTRUNE_SOCIAL_POST__ {\"platform\":\"threads\",\"text\":\"draft\"}",
      "## What Happened",
      "- Reviewed recent high-performing posts",
      "- Drafted a new angle from user replies",
      "",
      "## Issues & Risks",
      "- Cloudflare cooldown still active for 12m",
      "",
      "--- AgentRune Social Publish ---",
      "Platform: threads",
      "Posted: yes",
      "Post ID: 18313545688286987",
      "Source: Threads materials library",
    ].join("\n")

    const report = buildAutomationReport({ summary: "", output }, "en")

    expect(report.summary).toContain("Reviewed recent high-performing posts")
    expect(report.markdown).toContain("## What Happened")
    expect(report.markdown).toContain("## Issues & Risks")
    expect(report.fullLog).not.toContain("__AGENTRUNE_SOCIAL_POST__")

    const results = report.sections.find((section) => section.key === "results")
    expect(results?.items).toContain("Platform: threads")
    expect(results?.items).toContain("Posted: yes")
    expect(results?.items).toContain("Post ID: 18313545688286987")
  })

  it("localizes known system labels for zh-TW", () => {
    const report = buildAutomationReport({
      summary: [
        "## 結果如何",
        "- 已根據 3 則高互動回覆整理出新觀點",
      ].join("\n"),
      output: [
        "--- AgentRune Social Publish ---",
        "Platform: threads",
        "Posted: yes",
        "Post ID: 18313545688286987",
      ].join("\n"),
    }, "zh-TW")

    expect(report.markdown).toContain("## 結果如何")
    expect(report.markdown).toContain("平台: threads")
    expect(report.markdown).toContain("已發文: 是")
    expect(report.markdown).toContain("貼文 ID: 18313545688286987")

    const results = report.sections.find((section) => section.key === "results")
    expect(results?.title).toBe("結果如何")
  })

  it("recognizes korean headings and remaps them into localized sections", () => {
    const report = buildAutomationReport({
      summary: "",
      output: [
        "최종 결과",
        "- Threads draft created successfully",
        "",
        "문제",
        "- Cloudflare cooldown active for 12m",
        "",
        "다음 단계",
        "- Retry after cooldown expires",
      ].join("\n"),
    }, "en")

    expect(report.sections.find((section) => section.key === "results")?.items).toContain("Threads draft created successfully")
    expect(report.sections.find((section) => section.key === "issues")?.items).toContain("Cloudflare cooldown active for 12m")
    expect(report.sections.find((section) => section.key === "decisions")?.items).toContain("Retry after cooldown expires")
  })
})

describe("automation report labels", () => {
  it("returns localized section titles and status labels", () => {
    expect(getAutomationReportSectionTitle("issues", "zh-TW")).toBe("問題與風險")
    expect(getAutomationReportSectionTitle("results", "en")).toBe("Outcome")
    expect(getAutomationResultStatusLabel("success", "zh-TW")).toBe("成功")
    expect(getAutomationResultStatusLabel("timeout", "en")).toBe("Timed Out")
  })
})
