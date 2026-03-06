// server/vault-sync.ts
// Writes structured data to Obsidian vault as markdown files
// Vault structure per project:
//   {projectName}/
//   ├── 狀態總覽.md       ← overwrite: session status table
//   ├── 進度.md           ← append: recent progress reports
//   ├── 前提條件.md       ← merge: prerequisites (deduplicated)
//   ├── 架構決策.md       ← append: architecture decisions
//   ├── 變更記錄/YYYY-MM-DD.md  ← append: daily detailed reports
//   ├── Bug記錄/YYYY-MM-DD.md   ← append: blocked/error reports
//   └── 測試結果/YYYY-MM-DD.md  ← append: reports with test results

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import type { ProgressReport } from "../shared/types.js"

export interface VaultSyncOptions {
  vaultPath: string
  projectName: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function now(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ")
}

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true })
}

function appendToFile(filePath: string, content: string) {
  ensureDir(join(filePath, ".."))
  appendFileSync(filePath, content, "utf-8")
}

function readOrEmpty(filePath: string): string {
  if (!existsSync(filePath)) return ""
  return readFileSync(filePath, "utf-8")
}

function writeFile(filePath: string, content: string) {
  ensureDir(join(filePath, ".."))
  writeFileSync(filePath, content, "utf-8")
}

export class VaultSync {
  private dir: string

  constructor(opts: VaultSyncOptions) {
    this.dir = join(opts.vaultPath, opts.projectName)
    ensureDir(this.dir)
  }

  /** Write a progress report to vault */
  writeProgress(report: ProgressReport, sessionId?: string): void {
    const ts = now()
    const agent = sessionId ? ` (${sessionId.slice(0, 8)})` : ""

    // 1. Append to 進度.md
    const progressEntry = `\n## ${report.title}${agent}\n- **時間**: ${ts}\n- **狀態**: ${report.status}\n- **摘要**: ${report.summary}${report.nextSteps.length > 0 ? `\n- **下一步**: ${report.nextSteps.join(", ")}` : ""}${report.details ? `\n\n${report.details}` : ""}\n`

    appendToFile(join(this.dir, "進度.md"), progressEntry)

    // 2. Append to 變更記錄/YYYY-MM-DD.md
    appendToFile(join(this.dir, "變更記錄", `${today()}.md`), progressEntry)

    // 3. If blocked/error → also append to Bug記錄/
    if (report.status === "blocked") {
      appendToFile(join(this.dir, "Bug記錄", `${today()}.md`), progressEntry)
    }

    // 4. If summary mentions tests → append to 測試結果/
    if (/test|測試|passed|failed/i.test(report.summary)) {
      const testEntry = `\n## ${report.title} — Tests${agent}\n- **時間**: ${ts}\n- **摘要**: ${report.summary}\n`
      appendToFile(join(this.dir, "測試結果", `${today()}.md`), testEntry)
    }
  }

  /** Write a prerequisite/constraint to vault */
  writePrerequisite(title: string, content: string): void {
    const filePath = join(this.dir, "前提條件.md")
    const existing = readOrEmpty(filePath)

    // Deduplicate by title
    if (existing.includes(`## ${title}`)) return

    const entry = `\n## ${title}\n- **記錄時間**: ${now()}\n\n${content}\n`
    appendToFile(filePath, entry)
  }

  /** Write an architecture decision to vault */
  writeDecision(title: string, decision: string, alternatives?: string, rationale?: string): void {
    const entry = `\n## ${title}\n- **時間**: ${now()}\n- **決策**: ${decision}${alternatives ? `\n- **替代方案**: ${alternatives}` : ""}${rationale ? `\n- **理由**: ${rationale}` : ""}\n`
    appendToFile(join(this.dir, "架構決策.md"), entry)
  }

  /** Read project context for agent onboarding */
  readContext(): string {
    const sections: string[] = []

    const statusOverview = readOrEmpty(join(this.dir, "狀態總覽.md"))
    if (statusOverview.trim()) {
      sections.push("# 狀態總覽\n" + statusOverview)
    }

    const prerequisites = readOrEmpty(join(this.dir, "前提條件.md"))
    if (prerequisites.trim()) {
      sections.push("# 前提條件\n" + prerequisites)
    }

    const decisions = readOrEmpty(join(this.dir, "架構決策.md"))
    if (decisions.trim()) {
      sections.push("# 架構決策\n" + decisions)
    }

    // Recent progress — last 50 lines
    const progress = readOrEmpty(join(this.dir, "進度.md"))
    if (progress.trim()) {
      const lines = progress.split("\n")
      const recent = lines.slice(Math.max(0, lines.length - 50)).join("\n")
      sections.push("# 最近進度\n" + recent)
    }

    const workflow = readOrEmpty(join(this.dir, "開發流程.md"))
    if (workflow.trim()) {
      sections.push("# 開發流程\n" + workflow)
    }

    if (sections.length === 0) {
      return "No project context found in vault. This appears to be a new project."
    }

    return sections.join("\n\n---\n\n")
  }

  /** Update session status overview */
  updateStatusOverview(sessions: Array<{ id: string; agent: string; status: string; lastReport?: string }>): void {
    const lines = ["# 狀態總覽", "", `> 更新時間: ${now()}`, "", "| Session | Agent | 狀態 | 最近報告 |", "|---------|-------|------|----------|"]

    for (const s of sessions) {
      lines.push(`| ${s.id.slice(0, 8)} | ${s.agent} | ${s.status} | ${s.lastReport || "-"} |`)
    }

    writeFile(join(this.dir, "狀態總覽.md"), lines.join("\n") + "\n")
  }
}
