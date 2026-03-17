import { describe, expect, it } from "vitest"
import { extractAutomationSummary } from "./automation-summary.js"

describe("extractAutomationSummary", () => {
  it("keeps social summaries readable and removes internal markers", () => {
    const output = [
      "**發文前檢查清單：**",
      "1. **距離上篇 > 24h？** 最後記錄是 03-15，今天 03-17，距離超過 48h ✅",
      "2. **跟最近 3 篇角度不同？** 最近是觀點文、乾貨文、乾貨文，這篇是 Agent 視角（全新格式）✅",
      "",
      "**判斷：符合全部前置條件，直接發定稿，一字不改。**",
      "",
      "__AGENTRUNE_SOCIAL_POST__ {\"platform\":\"threads\",\"text\":\"long body\"}",
      "",
      "--- AgentRune Social Publish ---",
      "Platform: threads",
      "Posted: yes",
      "Post ID: 18313545688286987",
    ].join("\n")

    const summary = extractAutomationSummary(output, "success")

    expect(summary).toContain("符合全部前置條件")
    expect(summary).toContain("Posted: yes")
    expect(summary).not.toContain("__AGENTRUNE_SOCIAL_POST__")
  })

  it("formats markdown tables into readable summary lines", () => {
    const output = [
      "Session 27 完成。以下是執行摘要：",
      "",
      "| 項目 | 結果 |",
      "|------|------|",
      "| 通知處理 | 30 則未讀 |",
      "| 回覆成功 | 10/13（3 則 rate limit/重複） |",
      "| 發文 | 未發（距上篇僅 1.1h，需 2.5h） |",
      "",
      "**下次排程（Session 28）**：",
      "- 可發文時間：UTC 21:30 後",
    ].join("\n")

    const summary = extractAutomationSummary(output, "success")

    expect(summary).toContain("Session 27 完成")
    expect(summary).toContain("通知處理: 30 則未讀")
    expect(summary).toContain("回覆成功: 10/13（3 則 rate limit/重複）")
  })

  it("falls back to internal publish status when the main body is empty", () => {
    const output = [
      "__AGENTRUNE_SOCIAL_POST__ {\"platform\":\"threads\",\"text\":\"x\"}",
      "--- AgentRune Social Publish ---",
      "Platform: threads",
      "Posted: no",
      "Error: Threads credentials not available in key vault",
    ].join("\n")

    const summary = extractAutomationSummary(output, "failed")

    expect(summary).toContain("Posted: no")
    expect(summary).toContain("Error: Threads credentials not available in key vault")
  })

  it("keeps duplicate-guard skip details in the fallback summary", () => {
    const output = [
      "__AGENTRUNE_SOCIAL_POST__ {\"platform\":\"threads\",\"text\":\"x\"}",
      "--- AgentRune Social Publish ---",
      "Platform: threads",
      "Posted: skipped",
      "Reason: duplicate content matched a recently published post",
      "Duplicate Of: 03/17 09:00 | Agent 視角 | AI 盲區 | post 123",
    ].join("\n")

    const summary = extractAutomationSummary(output, "skipped_no_action")

    expect(summary).toContain("Posted: skipped")
    expect(summary).toContain("Duplicate Of: 03/17 09:00 | Agent 視角 | AI 盲區 | post 123")
  })

  it("returns a status fallback when there is no output", () => {
    expect(extractAutomationSummary("", "timeout")).toBe("Timed out (no output)")
  })
})
