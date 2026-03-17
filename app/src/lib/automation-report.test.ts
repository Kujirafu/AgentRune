import { describe, expect, it } from "vitest"
import { buildAutomationReport } from "./automation-report"

describe("buildAutomationReport", () => {
  it("turns noisy social output into a readable report", () => {
    const output = [
      "**發文前檢查清單：**",
      "",
      "1. **距離上篇 > 24h？** 最後記錄是 03-15，今天 03-17，距離超過 48h ✅",
      "2. **跟最近 3 篇角度不同？** 最近是觀點文、乾貨文、乾貨文，這篇是 Agent 視角（全新格式）✅",
      "",
      "**判斷：符合全部前置條件，直接發定稿，一字不改。**",
      "",
      "__AGENTRUNE_SOCIAL_POST__ {\"platform\":\"threads\",\"text\":\"long body\",\"source\":\"Threads素材庫.md\",\"reason\":\"all checks passed\"}",
      "",
      "--- AgentRune Social Publish ---",
      "Platform: threads",
      "Posted: yes",
      "Post ID: 18313545688286987",
      "Source: Threads素材庫.md → 候選主題 A",
    ].join("\n")

    const report = buildAutomationReport({
      summary: "T__ {\"platform\":\"threads\"}\n--- AgentRune Social Publish ---\nPosted: yes",
      output,
    })

    expect(report.summary).toContain("符合全部前置條件")
    expect(report.summary).not.toContain("__AGENTRUNE_SOCIAL_POST__")
    expect(report.fullLog).not.toContain("__AGENTRUNE_SOCIAL_POST__")

    const actions = report.sections.find((section) => section.key === "actions")
    const results = report.sections.find((section) => section.key === "results")

    expect(actions?.items.some((item) => item.includes("距離上篇 > 24h"))).toBe(true)
    expect(results?.items).toContain("Posted: yes")
    expect(results?.items).toContain("Post ID: 18313545688286987")
  })

  it("parses markdown tables and next-step sections generically", () => {
    const output = [
      "Session 27 完成。以下是執行摘要：",
      "",
      "---",
      "",
      "**Moltbook Session 27 執行結果**",
      "",
      "| 項目 | 結果 |",
      "|------|------|",
      "| 通知處理 | 30 則未讀 |",
      "| 回覆成功 | 10/13（3 則 rate limit/重複） |",
      "| 發文 | 未發（距上篇僅 1.1h，需 2.5h） |",
      "",
      "**下次排程（Session 28）**：",
      "- 新文《Correction source blindspot》",
      "- 可發文時間：UTC 21:30 後",
      "",
      "已更新 `進度.md` 和 `Moltbook社群回饋.md`。",
    ].join("\n")

    const report = buildAutomationReport({ summary: "", output })

    expect(report.summary).toContain("Session 27 完成")

    const results = report.sections.find((section) => section.key === "results")
    const decisions = report.sections.find((section) => section.key === "decisions")
    const notes = report.sections.find((section) => section.key === "notes")

    expect(results?.items).toContain("通知處理: 30 則未讀")
    expect(results?.items).toContain("發文: 未發（距上篇僅 1.1h，需 2.5h）")
    expect(decisions?.items).toContain("可發文時間：UTC 21:30 後")
    expect(notes?.items).toContain("已更新 進度.md 和 Moltbook社群回饋.md。")
  })

  it("separates issues and manual follow-up from general output", () => {
    const output = [
      "---",
      "",
      "**⚠️ 無法自動發文：Sandbox 禁止所有網路請求**",
      "",
      "Threads API 需要 HTTP，sandbox 已限制。",
      "",
      "**你需要手動做的事：**",
      "1. 複製上方文字，貼到 Threads app 發文",
      "2. 發完後回覆我，我來更新素材庫的表格",
    ].join("\n")

    const report = buildAutomationReport({ summary: "", output })

    const issues = report.sections.find((section) => section.key === "issues")
    const decisions = report.sections.find((section) => section.key === "decisions")

    expect(issues?.items.some((item) => item.includes("Sandbox 禁止所有網路請求"))).toBe(true)
    expect(decisions?.items).toContain("複製上方文字，貼到 Threads app 發文")
    expect(decisions?.items).toContain("發完後回覆我，我來更新素材庫的表格")
  })

  it("shows duplicate-guard skips as readable social results", () => {
    const output = [
      "__AGENTRUNE_SOCIAL_POST__ {\"platform\":\"threads\",\"text\":\"duplicate copy\"}",
      "--- AgentRune Social Publish ---",
      "Platform: threads",
      "Posted: skipped",
      "Reason: duplicate content matched a recently published post",
      "Duplicate Of: 03/17 09:00 | Agent 視角 | AI 盲區 | post 123",
      "Source: Threads素材庫.md → 候選主題 A",
    ].join("\n")

    const report = buildAutomationReport({ summary: "", output })
    const results = report.sections.find((section) => section.key === "results")

    expect(report.summary).toContain("Posted: skipped")
    expect(results?.items).toContain("Duplicate Of: 03/17 09:00 | Agent 視角 | AI 盲區 | post 123")
    expect(results?.items).toContain("Reason: duplicate content matched a recently published post")
  })

  it("recognizes korean section headings and maps them into structured sections", () => {
    const output = [
      "실행 결과",
      "- Threads draft created successfully",
      "",
      "문제",
      "- Cloudflare cooldown active for 12m",
      "",
      "다음 단계",
      "- Retry after cooldown expires",
    ].join("\n")

    const report = buildAutomationReport({ summary: "", output })
    const results = report.sections.find((section) => section.key === "results")
    const issues = report.sections.find((section) => section.key === "issues")
    const decisions = report.sections.find((section) => section.key === "decisions")

    expect(results?.items).toContain("Threads draft created successfully")
    expect(issues?.items).toContain("Cloudflare cooldown active for 12m")
    expect(decisions?.items).toContain("Retry after cooldown expires")
  })

  it("localizes common korean and internal publish lines for zh-TW presentation", () => {
    const output = [
      "Session 91 완전히 완료됐습니다. 포스트는 타임아웃이 났지만 API 확인 결과 실제 발행 성공입니다.",
      "",
      "--- AgentRune Social Publish ---",
      "Platform: threads",
      "Posted: yes",
      "Post ID: 18313545688286987",
    ].join("\n")

    const report = buildAutomationReport({ summary: "", output }, "zh-TW")
    const results = report.sections.find((section) => section.key === "results")

    expect(report.summary).toContain("Session 91 已完整完成")
    expect(report.summary).toContain("API 確認實際已發佈成功")
    expect(results?.items).toContain("平台：Threads")
    expect(results?.items).toContain("發文結果：已發布")
    expect(results?.items).toContain("貼文 ID：18313545688286987")
  })
})
