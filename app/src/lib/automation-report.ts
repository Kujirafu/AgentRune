import type { AutomationResult } from "../data/automation-types"

export type AutomationReportSectionKey = "actions" | "results" | "issues" | "decisions" | "notes"

export interface AutomationReportSection {
  key: AutomationReportSectionKey
  items: string[]
}

export interface AutomationReport {
  summary: string | null
  sections: AutomationReportSection[]
  fullLog: string
}

export type AutomationReportLocale = "en" | "zh-TW"

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const FE_RE = /\x1b[@-Z\\-_]/g
const CHARSET_RE = /\x1b[()][0-9A-B]/g
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g
const CODE_FENCE_RE = /^```/
const TABLE_ROW_RE = /^\|.*\|$/
const TABLE_DIVIDER_RE = /^\|?[\s:|-]+\|[\s:|-]*$/
const INTERNAL_BLOCK_TITLE_RE = /^---\s*AgentRune\b/i
const INTERNAL_BLOCK_LINE_RE = /^(Platform|Posted|Post ID|Source|Error|Reason|Duplicate Of|Duplicate Guard|Duplicate Guard Error|Materials Updated|Materials Path|Materials Error):/i
const INTERNAL_MARKER_RE = /^__AGENTRUNE_[A-Z0-9_]+\b/
const DONE_MARKER_RE = /___AGENTRUNE_DONE___/g

const SECTION_ORDER: AutomationReportSectionKey[] = ["actions", "results", "issues", "decisions", "notes"]

const SECTION_ALIASES: Record<AutomationReportSectionKey, string[]> = {
  actions: [
    "本次完成",
    "做了什麼",
    "執行流程",
    "執行流程分析",
    "發文前檢查清單",
    "수행한 작업",
    "실행 내용",
    "진행한 일",
    "steps",
    "step",
    "actions taken",
    "work completed",
    "what happened",
    "what i did",
    "checklist",
  ],
  results: [
    "執行結果",
    "結果",
    "執行成果",
    "狀態",
    "狀態報告",
    "摘要",
    "判斷",
    "結論",
    "결과",
    "실행 결과",
    "요약",
    "summary",
    "outcome",
    "outcomes",
    "result",
    "results",
    "report",
  ],
  issues: [
    "問題",
    "風險",
    "阻塞",
    "注意事項",
    "待修",
    "錯誤",
    "失敗原因",
    "문제",
    "위험",
    "오류",
    "issues",
    "issue",
    "risks",
    "risk",
    "warnings",
    "warning",
    "errors",
    "error",
    "blockers",
    "blocker",
    "problems",
    "problem",
  ],
  decisions: [
    "需要你決策",
    "需要決策",
    "需要你處理",
    "你需要手動做的事",
    "待辦",
    "下一步",
    "下次執行",
    "下次排程",
    "결정 필요",
    "다음 단계",
    "후속 조치",
    "manual action",
    "action required",
    "next step",
    "next steps",
    "need decision",
    "needs decision",
    "need input",
    "follow up",
    "follow-up",
    "todo",
  ],
  notes: [
    "已更新檔案",
    "記錄更新",
    "補充",
    "備註",
    "其他",
    "메모",
    "참고",
    "추가 사항",
    "details",
    "notes",
    "context",
    "新文重點",
  ],
}

const RESULT_KEYWORDS = [
  "完成",
  "成功",
  "posted",
  "post id",
  "duplicate guard",
  "duplicate of",
  "發布",
  "發文",
  "upvote",
  "karma",
  "通知",
  "回覆",
  "已更新",
  "updated",
  "generated",
  "created",
  "source",
]

const ISSUE_KEYWORDS = [
  "問題",
  "風險",
  "warning",
  "error",
  "duplicate guard error",
  "失敗",
  "rate limit",
  "429",
  "403",
  "sandbox 禁止",
  "sandbox",
  "blocked",
  "ban",
  "無法",
]

const DECISION_KEYWORDS = [
  "需要你",
  "需要手動",
  "手動",
  "下一步",
  "待辦",
  "need",
  "action required",
  "follow up",
  "執行 python",
  "可發文時間",
]

const NOTE_KEYWORDS = ["已更新", "已更新檔案", "記錄更新", "補充", "備註"]

const NOISE_PATTERNS = [
  /^[$#>]\s*$/,
  /^-{3,}$/,
  /^\|[-:\s|]+\|?$/,
  /^(PS )?[A-Z]:\\/i,
  /^windows powershell/i,
  /^microsoft corporation/i,
  /aka\.ms\/pswindows/i,
]

function stripAnsi(input: string): string {
  return input
    .replace(ANSI_RE, "")
    .replace(OSC_RE, "")
    .replace(FE_RE, "")
    .replace(CHARSET_RE, "")
    .replace(CONTROL_RE, "")
    .replace(DONE_MARKER_RE, "")
}

function simplifyMatchValue(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[：:]+$/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function stripFormatting(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/^\*\*(.+)\*\*[:：]?$/, "$1")
    .replace(/^__(.+)__[:：]?$/, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeLine(line: string): string {
  return stripFormatting(line)
}

function isNoiseLine(line: string): boolean {
  if (!line) return true
  if (line.length > 600 && line.includes("{")) return true
  return NOISE_PATTERNS.some((pattern) => pattern.test(line))
}

function formatTableRow(line: string): string | null {
  if (!TABLE_ROW_RE.test(line.trim()) || TABLE_DIVIDER_RE.test(line.trim())) return null
  const cells = line.split("|").map((cell) => stripFormatting(cell)).filter(Boolean)
  if (cells.length < 2) return null

  const simplified = cells.map((cell) => simplifyMatchValue(cell))
  if (
    cells.length === 2 &&
    ((simplified[0] === "項目" && simplified[1] === "結果") ||
      (simplified[0] === "step" && simplified[1] === "content"))
  ) {
    return null
  }

  return cells.length === 2 ? `${cells[0]}: ${cells[1]}` : cells.join(" | ")
}

function detectSectionHeading(line: string): AutomationReportSectionKey | null {
  const candidate = normalizeLine(line)
  if (!candidate) return null
  const raw = line.trim()
  const looksLikeHeading = /^#{1,6}\s+/.test(raw)
    || /^\*\*.*\*\*[:：]?$/.test(raw)
    || /^__.*__[:：]?$/.test(raw)
    || (candidate.length <= 24 && !/[。！？]/.test(candidate))
  if (!looksLikeHeading) return null

  const simplified = simplifyMatchValue(candidate)
  for (const key of SECTION_ORDER) {
    for (const alias of SECTION_ALIASES[key]) {
      const aliasValue = simplifyMatchValue(alias)
      if (!aliasValue) continue
      if (simplified === aliasValue || simplified.startsWith(aliasValue) || simplified.endsWith(aliasValue)) {
        return key
      }
    }
  }
  return null
}

function extractHeadingBody(line: string): string | null {
  const normalized = normalizeLine(line)
  const parts = normalized.split(/[：:]/)
  if (parts.length < 2) return null
  const body = parts.slice(1).join("：").trim()
  return body || null
}

function classifyLine(line: string): AutomationReportSectionKey | null {
  const value = line.toLowerCase()
  if (ISSUE_KEYWORDS.some((keyword) => value.includes(keyword.toLowerCase()))) return "issues"
  if (DECISION_KEYWORDS.some((keyword) => value.includes(keyword.toLowerCase()))) return "decisions"
  if (NOTE_KEYWORDS.some((keyword) => value.includes(keyword.toLowerCase()))) return "notes"
  if (RESULT_KEYWORDS.some((keyword) => value.includes(keyword.toLowerCase()))) return "results"
  if (/^(session|第\s*\d+\s*次執行|步驟)/i.test(line)) return "actions"
  return null
}

function isUsefulSummaryLine(line: string): boolean {
  if (!line) return false
  if (INTERNAL_MARKER_RE.test(line)) return false
  if (CODE_FENCE_RE.test(line)) return false
  if (line.includes("{\"platform\"")) return false
  if (line.includes("__AGENTRUNE")) return false
  if (isNoiseLine(line)) return false
  return true
}

function pushUnique(target: string[], value: string): void {
  const trimmed = value.trim()
  if (!trimmed) return
  if (!target.includes(trimmed)) target.push(trimmed)
}

function compressSummaryLines(lines: string[]): string | null {
  const filtered = lines.filter(isUsefulSummaryLine)
  if (filtered.length === 0) return null

  const chosen = filtered.slice(0, 4)
  const summary = chosen.join("\n").trim()
  if (!summary) return null
  return summary.length > 420 ? `${summary.slice(0, 417)}...` : summary
}

function uniqueLines(lines: Array<string | null | undefined>): string[] {
  const result: string[] = []
  for (const line of lines) {
    if (!line) continue
    pushUnique(result, line)
  }
  return result
}

const INTERNAL_FIELD_LABELS_ZH: Record<string, string> = {
  Platform: "平台",
  Posted: "發文結果",
  "Post ID": "貼文 ID",
  Source: "來源",
  Error: "錯誤",
  Reason: "原因",
  "Duplicate Of": "重複對象",
  "Duplicate Guard": "重複保護",
  "Duplicate Guard Error": "重複保護錯誤",
  "Materials Updated": "素材庫已更新",
  "Materials Path": "素材路徑",
  "Materials Error": "素材庫錯誤",
}

const INTERNAL_VALUE_LABELS_ZH: Record<string, string> = {
  yes: "已發布",
  no: "未發布",
  skipped: "已略過",
  success: "成功",
  failed: "失敗",
  timeout: "逾時",
  interrupted: "已中斷",
  pending_reauth: "等待重新驗證",
}

const ZH_LINE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Session (\d+) 완전히 완료됐습니다\./gi, "Session $1 已完整完成。"],
  [/포스트는 타임아웃이 났지만 API 확인 결과 실제 발행 성공입니다\./gi, "貼文雖然逾時，但 API 確認實際已發佈成功。"],
  [/실제 발행 성공/gi, "實際發佈成功"],
  [/완전히 완료됐습니다/gi, "已完整完成"],
  [/완료되었습니다/gi, "已完成"],
  [/완료됐습니다/gi, "已完成"],
  [/타임아웃/gi, "逾時"],
  [/Cloudflare cooldown active for ([^\n]+)/gi, "Cloudflare 冷卻中（$1）"],
  [/Retry after cooldown expires/gi, "冷卻結束後重試"],
  [/Threads draft created successfully/gi, "Threads 草稿已建立"],
  [/Completed \(no output\)/gi, "已完成（沒有輸出）"],
  [/Timed out \(no output\)/gi, "已逾時（沒有輸出）"],
  [/Failed \(no output\)/gi, "已失敗（沒有輸出）"],
  [/Interrupted by daemon shutdown/gi, "因 daemon 關閉而中斷"],
  [/duplicate content matched a recently published post/gi, "內容與近期已發布貼文重複"],
  [/Retry after cooldown/gi, "冷卻後重試"],
]

function localizeInternalValue(value: string): string {
  const trimmed = value.trim()
  const lowered = trimmed.toLowerCase()
  if (lowered === "threads") return "Threads"
  if (lowered === "x") return "X"
  if (lowered === "moltbook") return "Moltbook"
  return INTERNAL_VALUE_LABELS_ZH[lowered] || trimmed
}

export function localizeAutomationReportText(text: string, locale: AutomationReportLocale = "en"): string {
  const trimmed = text.trim()
  if (!trimmed || locale !== "zh-TW") return trimmed

  const internalMatch = trimmed.match(/^([A-Za-z ]+):\s*(.+)$/)
  if (internalMatch) {
    const [, rawLabel, rawValue] = internalMatch
    const label = INTERNAL_FIELD_LABELS_ZH[rawLabel.trim()]
    if (label) {
      return `${label}：${localizeInternalValue(rawValue)}`
    }
  }

  let localized = trimmed
  for (const [pattern, replacement] of ZH_LINE_REPLACEMENTS) {
    localized = localized.replace(pattern, replacement)
  }
  return localized
}

function localizeLines(lines: string[], locale: AutomationReportLocale): string[] {
  return uniqueLines(lines.map((line) => localizeAutomationReportText(line, locale)))
}

function processCodeBlock(buffer: string[], currentSection: AutomationReportSectionKey | null, target: Record<AutomationReportSectionKey, string[]>): void {
  const lines = buffer.map((line) => normalizeLine(line)).filter(Boolean)
  if (lines.length === 0) return
  const joined = lines.join("\n")
  if (joined.length > 220 || lines.length > 3) return
  pushUnique(target[currentSection || "notes"], joined)
}

function buildSections(output: string): { sections: Record<AutomationReportSectionKey, string[]>; intro: string[] } {
  const sections: Record<AutomationReportSectionKey, string[]> = {
    actions: [],
    results: [],
    issues: [],
    decisions: [],
    notes: [],
  }
  const intro: string[] = []

  let currentSection: AutomationReportSectionKey | null = null
  let inCodeBlock = false
  let codeBuffer: string[] = []

  for (const rawLine of output.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    if (INTERNAL_MARKER_RE.test(trimmed)) continue

    if (inCodeBlock) {
      if (CODE_FENCE_RE.test(trimmed)) {
        processCodeBlock(codeBuffer, currentSection, sections)
        inCodeBlock = false
        codeBuffer = []
      } else {
        codeBuffer.push(trimmed)
      }
      continue
    }

    if (CODE_FENCE_RE.test(trimmed)) {
      inCodeBlock = true
      codeBuffer = []
      continue
    }

    if (INTERNAL_BLOCK_TITLE_RE.test(trimmed)) {
      currentSection = "results"
      continue
    }

    if (INTERNAL_BLOCK_LINE_RE.test(trimmed)) {
      pushUnique(sections.results, normalizeLine(trimmed))
      continue
    }

    const tableItem = formatTableRow(trimmed)
    if (tableItem) {
      pushUnique(sections[currentSection || classifyLine(tableItem) || "results"], tableItem)
      continue
    }

    const headingKey = detectSectionHeading(trimmed)
    if (headingKey) {
      currentSection = headingKey
      const headingBody = extractHeadingBody(trimmed)
      if (headingBody) pushUnique(sections[headingKey], headingBody)
      continue
    }

    const normalized = normalizeLine(trimmed)
    if (!normalized || isNoiseLine(normalized)) continue

    const classifiedSection = classifyLine(normalized)
    const targetSection = classifiedSection === "issues" || classifiedSection === "notes"
      ? classifiedSection
      : currentSection || classifiedSection
    if (targetSection) {
      pushUnique(sections[targetSection], normalized)
    } else if (intro.length < 3) {
      pushUnique(intro, normalized)
    } else {
      pushUnique(sections.notes, normalized)
    }
  }

  if (inCodeBlock) processCodeBlock(codeBuffer, currentSection, sections)

  return { sections, intro }
}

function cleanStoredSummary(summary?: string): string | null {
  if (!summary) return null
  const lines = summary
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter(isUsefulSummaryLine)

  return compressSummaryLines(lines)
}

function isThinSummary(summary: string | null): boolean {
  if (!summary) return true
  const lines = summary.split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) return true
  if (lines.length === 1 && /^(Platform|Posted|Post ID|Source|Error|Reason):/i.test(lines[0])) return true
  return summary.length < 24
}

function pickHeadline(intro: string[], sections: Record<AutomationReportSectionKey, string[]>): string | null {
  const headlinePattern = /(session|完成|已完成|摘要|狀態報告|判斷|結論|summary|status)/i
  return intro[0]
    || sections.actions.find((line) => headlinePattern.test(line))
    || sections.results.find((line) => headlinePattern.test(line))
    || sections.issues.find((line) => headlinePattern.test(line))
    || sections.results[0]
    || sections.actions[0]
    || sections.issues[0]
    || null
}

export function buildAutomationReport(
  result: Pick<AutomationResult, "summary" | "output">,
  locale: AutomationReportLocale = "en",
): AutomationReport {
  const fullLog = stripAnsi(result.output || "")
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_MARKER_RE.test(line.trim()))
    .join("\n")
    .trim()

  const { sections, intro } = buildSections(fullLog)
  const storedSummary = cleanStoredSummary(result.summary)
  const derivedSummary = compressSummaryLines(uniqueLines([
    pickHeadline(intro, sections),
    ...intro,
    ...sections.results.slice(0, 2),
    ...sections.actions.slice(0, 2),
    ...sections.issues.slice(0, 1),
  ]))

  const localizedSummary = localizeAutomationReportText(
    !isThinSummary(derivedSummary) ? derivedSummary || "" : storedSummary || derivedSummary || "",
    locale,
  )
  const localizedSections = SECTION_ORDER
    .map((key) => ({ key, items: localizeLines(sections[key], locale) }))
    .filter((section) => section.items.length > 0)

  return {
    summary: localizedSummary || null,
    sections: localizedSections,
    fullLog,
  }
}
