import type { AutomationResult } from "../data/automation-types"

export type AutomationReportSectionKey = "actions" | "results" | "issues" | "decisions" | "notes"
export type AutomationReportLocale = "en" | "zh-TW"

export interface AutomationReportSection {
  key: AutomationReportSectionKey
  title: string
  markdown: string
  items: string[]
}

export interface AutomationReport {
  summary: string | null
  markdown: string
  sections: AutomationReportSection[]
  fullLog: string
}

type AutomationReportInput =
  Pick<AutomationResult, "summary" | "output">
  & Partial<Pick<AutomationResult, "behaviorStateHash" | "promptStateHash" | "launchStateHash" | "behaviorStateIssues">>

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const FE_RE = /\x1b[@-Z\\-_]/g
const CHARSET_RE = /\x1b[()][0-9A-B]/g
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g
const DONE_MARKER_RE = /___AGENTRUNE_DONE___/g
const INTERNAL_MARKER_RE = /^__AGENTRUNE_[A-Z0-9_]+\b/
const INTERNAL_BLOCK_TITLE_RE = /^---\s*AgentRune\b/i
const CODE_FENCE_RE = /^```/
const TABLE_ROW_RE = /^\|.*\|$/
const TABLE_DIVIDER_RE = /^\|?[\s:|-]+\|[\s:|-]*$/

const SECTION_ORDER: AutomationReportSectionKey[] = ["actions", "results", "issues", "decisions", "notes"]

const SECTION_TITLES: Record<AutomationReportLocale, Record<AutomationReportSectionKey, string>> = {
  en: {
    actions: "What Happened",
    results: "Outcome",
    issues: "Issues & Risks",
    decisions: "Decision Needed",
    notes: "Notes",
  },
  "zh-TW": {
    actions: "做了哪些事",
    results: "結果如何",
    issues: "問題與風險",
    decisions: "需要你決策",
    notes: "補充與備註",
  },
}

const STATUS_LABELS: Record<AutomationReportLocale, Partial<Record<AutomationResult["status"], string>>> = {
  en: {
    success: "Success",
    failed: "Failed",
    timeout: "Timed Out",
    blocked_by_risk: "Blocked",
    skipped_no_confirmation: "Skipped",
    skipped_no_action: "Skipped",
    skipped_daily_limit: "Skipped",
    interrupted: "Interrupted",
    pending_reauth: "Reauth Needed",
    circuit_broken: "Circuit Broken",
  },
  "zh-TW": {
    success: "成功",
    failed: "失敗",
    timeout: "逾時",
    blocked_by_risk: "阻擋",
    skipped_no_confirmation: "略過",
    skipped_no_action: "略過",
    skipped_daily_limit: "略過",
    interrupted: "中斷",
    pending_reauth: "需要重新驗證",
    circuit_broken: "熔斷中止",
  },
}

const SECTION_ALIASES: Record<AutomationReportSectionKey, string[]> = {
  actions: [
    "what happened",
    "actions",
    "actions taken",
    "what i did",
    "steps",
    "execution",
    "做了哪些事",
    "執行內容",
    "處理過程",
    "採取的動作",
    "실행 내용",
    "수행 내용",
    "実施内容",
    "実行内容",
  ],
  results: [
    "summary",
    "outcome",
    "outcomes",
    "result",
    "results",
    "final result",
    "report",
    "結果如何",
    "結果",
    "執行結果",
    "最終結果",
    "결과",
    "최종 결과",
    "요약",
    "結果概要",
  ],
  issues: [
    "issues",
    "issue",
    "risks",
    "risk",
    "warnings",
    "warning",
    "errors",
    "error",
    "blockers",
    "problem",
    "problems",
    "問題與風險",
    "問題",
    "風險",
    "阻塞",
    "이슈",
    "문제",
    "리스크",
    "課題",
    "リスク",
  ],
  decisions: [
    "decision needed",
    "decision",
    "decisions",
    "need decision",
    "needs decision",
    "next step",
    "next steps",
    "follow up",
    "follow-up",
    "action required",
    "todo",
    "需要你決策",
    "需要決策",
    "下一步",
    "待決策",
    "결정 필요",
    "다음 단계",
    "要決定",
    "次の対応",
  ],
  notes: [
    "notes",
    "note",
    "context",
    "details",
    "補充與備註",
    "補充",
    "備註",
    "背景",
    "메모",
    "참고",
    "備考",
    "補足",
  ],
}

const SYSTEM_FIELDS = [
  {
    aliases: ["platform", "平台"],
    label: { en: "Platform", "zh-TW": "平台" },
  },
  {
    aliases: ["posted", "posting", "已發文", "是否已發文"],
    label: { en: "Posted", "zh-TW": "已發文" },
  },
  {
    aliases: ["post id", "postid", "貼文 id", "貼文編號"],
    label: { en: "Post ID", "zh-TW": "貼文 ID" },
  },
  {
    aliases: ["source", "來源"],
    label: { en: "Source", "zh-TW": "來源" },
  },
  {
    aliases: ["error", "錯誤"],
    label: { en: "Error", "zh-TW": "錯誤" },
  },
  {
    aliases: ["reason", "原因"],
    label: { en: "Reason", "zh-TW": "原因" },
  },
  {
    aliases: ["duplicate of", "重複對象"],
    label: { en: "Duplicate Of", "zh-TW": "重複對象" },
  },
  {
    aliases: ["duplicate guard", "重複檢查"],
    label: { en: "Duplicate Guard", "zh-TW": "重複檢查" },
  },
  {
    aliases: ["duplicate guard error", "重複檢查錯誤"],
    label: { en: "Duplicate Guard Error", "zh-TW": "重複檢查錯誤" },
  },
  {
    aliases: ["cooldown guard", "冷卻檢查"],
    label: { en: "Cooldown Guard", "zh-TW": "冷卻檢查" },
  },
  {
    aliases: ["cooldown guard error", "冷卻檢查錯誤"],
    label: { en: "Cooldown Guard Error", "zh-TW": "冷卻檢查錯誤" },
  },
  {
    aliases: ["materials updated", "素材庫已更新"],
    label: { en: "Materials Updated", "zh-TW": "素材庫已更新" },
  },
  {
    aliases: ["materials path", "素材庫路徑"],
    label: { en: "Materials Path", "zh-TW": "素材庫路徑" },
  },
  {
    aliases: ["materials error", "素材庫錯誤"],
    label: { en: "Materials Error", "zh-TW": "素材庫錯誤" },
  },
  {
    aliases: ["config hash"],
    label: { en: "Config Hash", "zh-TW": "設定雜湊" },
  },
  {
    aliases: ["prompt hash"],
    label: { en: "Prompt Hash", "zh-TW": "Prompt 雜湊" },
  },
  {
    aliases: ["launch hash"],
    label: { en: "Launch Hash", "zh-TW": "啟動雜湊" },
  },
] as const

const VALUE_LABELS: Record<string, Record<AutomationReportLocale, string>> = {
  yes: { en: "yes", "zh-TW": "是" },
  no: { en: "no", "zh-TW": "否" },
  skipped: { en: "skipped", "zh-TW": "略過" },
  failed: { en: "failed", "zh-TW": "失敗" },
  recorded: { en: "recorded", "zh-TW": "已記錄" },
  cleared: { en: "cleared", "zh-TW": "已清除" },
  active: { en: "active", "zh-TW": "啟用中" },
  unknown: { en: "unknown", "zh-TW": "未知" },
  "not active": { en: "not active", "zh-TW": "未啟用" },
  "already recorded": { en: "already recorded", "zh-TW": "已經記錄過" },
  "already up to date": { en: "already up to date", "zh-TW": "已經是最新" },
}

function stripTerminalNoise(input: string): string {
  return input
    .replace(ANSI_RE, "")
    .replace(OSC_RE, "")
    .replace(FE_RE, "")
    .replace(CHARSET_RE, "")
    .replace(CONTROL_RE, "")
    .replace(DONE_MARKER_RE, "")
}

function sanitizeText(input: string | undefined | null): string {
  if (!input) return ""
  return stripTerminalNoise(input)
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_MARKER_RE.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function simplify(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function stripMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\*\*(.+?)\*\*:?$/, "$1")
    .replace(/^__(.+?)__:?$/, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim()
}

function getSectionTitle(key: AutomationReportSectionKey, locale: AutomationReportLocale): string {
  return SECTION_TITLES[locale][key]
}

export function getAutomationReportSectionTitle(
  key: AutomationReportSectionKey,
  locale: AutomationReportLocale,
): string {
  return getSectionTitle(key, locale)
}

export function getAutomationResultStatusLabel(
  status: AutomationResult["status"],
  locale: AutomationReportLocale,
): string {
  return STATUS_LABELS[locale][status] || status
}

function detectSystemField(label: string) {
  const simplifiedLabel = simplify(label)
  if (!simplifiedLabel) return null
  return SYSTEM_FIELDS.find((field) => field.aliases.some((alias) => simplify(alias) === simplifiedLabel)) || null
}

function translateKnownValue(value: string, locale: AutomationReportLocale): string {
  if (locale === "en") return value.trim()
  const normalized = simplify(value)
  if (!normalized) return value.trim()

  for (const [key, translations] of Object.entries(VALUE_LABELS)) {
    if (simplify(key) === normalized) {
      return translations[locale]
    }
  }
  return value.trim()
}

function localizeSystemLine(line: string, locale: AutomationReportLocale): string {
  const trimmed = line.trim()
  if (!trimmed) return ""
  if (INTERNAL_BLOCK_TITLE_RE.test(trimmed)) {
    return locale === "zh-TW" ? "AgentRune 發文紀錄" : "AgentRune Publish Record"
  }

  const match = trimmed.match(/^([^:]{1,40}):\s*(.+)$/)
  if (!match) return trimmed

  const [, rawLabel, rawValue] = match
  const field = detectSystemField(rawLabel)
  if (!field) return trimmed

  return `${field.label[locale]}: ${translateKnownValue(rawValue, locale)}`
}

function matchSectionHeading(line: string): AutomationReportSectionKey | null {
  const raw = line.trim()
  if (!raw) return null
  const candidate = stripMarkdown(raw).replace(/[:：]\s*$/, "")
  if (!candidate) return null

  const looksLikeHeading = /^#{1,6}\s+/.test(raw)
    || /^\*\*.+\*\*:?$/.test(raw)
    || /^__.+__:?$/.test(raw)
    || candidate.length <= 28

  if (!looksLikeHeading) return null

  const normalized = simplify(candidate)
  if (!normalized) return null

  for (const key of SECTION_ORDER) {
    if (SECTION_ALIASES[key].some((alias) => {
      const normalizedAlias = simplify(alias)
      return normalized === normalizedAlias
        || normalized.startsWith(`${normalizedAlias} `)
        || normalized.endsWith(` ${normalizedAlias}`)
    })) {
      return key
    }
  }

  return null
}

function normalizeMarkdownLine(line: string, locale: AutomationReportLocale): string {
  const trimmed = line.trim()
  if (!trimmed) return ""
  if (CODE_FENCE_RE.test(trimmed) || TABLE_ROW_RE.test(trimmed)) return trimmed
  const field = detectSystemField((trimmed.match(/^([^:]{1,40}):/) || [])[1] || "")
  if (field) return `- ${localizeSystemLine(trimmed, locale)}`
  if (/^\s*[-*+]\s+/.test(trimmed)) return `- ${stripMarkdown(trimmed)}`
  if (/^\s*\d+[.)]\s+/.test(trimmed)) return `- ${stripMarkdown(trimmed)}`
  return localizeSystemLine(trimmed, locale)
}

function renderMarkdown(lines: string[], locale: AutomationReportLocale): string {
  const blocks: string[] = []
  const paragraph: string[] = []
  let inCodeBlock = false

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(paragraph.join(" "))
    paragraph.length = 0
  }

  for (const rawLine of lines) {
    const normalized = normalizeMarkdownLine(rawLine, locale)

    if (!normalized) {
      flushParagraph()
      if (blocks.length > 0 && blocks[blocks.length - 1] !== "") {
        blocks.push("")
      }
      continue
    }

    if (CODE_FENCE_RE.test(normalized)) {
      flushParagraph()
      blocks.push(normalized)
      inCodeBlock = !inCodeBlock
      continue
    }

    if (inCodeBlock) {
      blocks.push(rawLine)
      continue
    }

    if (TABLE_ROW_RE.test(normalized)) {
      flushParagraph()
      blocks.push(normalized)
      continue
    }

    if (/^- /.test(normalized)) {
      flushParagraph()
      blocks.push(normalized)
      continue
    }

    paragraph.push(stripMarkdown(normalized))
  }

  flushParagraph()

  return blocks.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function extractItems(markdown: string): string[] {
  const items: string[] = []
  for (const rawLine of markdown.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed || TABLE_DIVIDER_RE.test(trimmed) || CODE_FENCE_RE.test(trimmed)) continue

    if (/^- /.test(trimmed)) {
      items.push(trimmed.replace(/^- /, "").trim())
      continue
    }

    if (TABLE_ROW_RE.test(trimmed)) {
      const cells = trimmed.split("|").map((cell) => stripMarkdown(cell)).filter(Boolean)
      if (cells.length >= 2) {
        items.push(cells.length === 2 ? `${cells[0]}: ${cells[1]}` : cells.join(" | "))
      }
      continue
    }

    items.push(stripMarkdown(trimmed))
  }

  return [...new Set(items.filter(Boolean))]
}

function mergeMarkdown(primary: string, secondary: string): string {
  if (!primary) return secondary
  if (!secondary) return primary

  const existing = new Set(extractItems(primary))
  const additions = extractItems(secondary).filter((item) => !existing.has(item))
  if (additions.length === 0) return primary

  return `${primary}\n${additions.map((item) => `- ${item}`).join("\n")}`.trim()
}

function parseSourceIntoSections(
  source: string,
  locale: AutomationReportLocale,
): { leadMarkdown: string; sections: Map<AutomationReportSectionKey, string> } {
  const sections = new Map<AutomationReportSectionKey, string>()
  const leadLines: string[] = []
  let currentKey: AutomationReportSectionKey | null = null
  let buffer: string[] = []

  const flush = () => {
    const markdown = renderMarkdown(buffer, locale)
    buffer = []

    if (!markdown) return
    if (!currentKey) {
      leadLines.push(markdown)
      return
    }

    sections.set(currentKey, mergeMarkdown(sections.get(currentKey) || "", markdown))
  }

  for (const rawLine of source.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed || INTERNAL_MARKER_RE.test(trimmed) || INTERNAL_BLOCK_TITLE_RE.test(trimmed)) {
      buffer.push("")
      continue
    }

    const heading = matchSectionHeading(trimmed)
    if (heading) {
      flush()
      currentKey = heading
      continue
    }

    buffer.push(rawLine)
  }

  flush()

  return {
    leadMarkdown: leadLines.join("\n\n").trim(),
    sections,
  }
}

function extractInternalPublishSection(output: string, locale: AutomationReportLocale): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      const label = line.split(":")[0] || ""
      return !!detectSystemField(label)
    })
    .map((line) => localizeSystemLine(line, locale))

  return renderMarkdown([...new Set(lines)], locale)
}

function extractSummary(markdown: string): string | null {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => stripMarkdown(line))
    .filter((line) => line && !TABLE_DIVIDER_RE.test(line) && !CODE_FENCE_RE.test(line))

  if (lines.length === 0) return null

  const summary = lines.join(" ").replace(/\s+/g, " ").trim()
  if (!summary) return null
  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary
}

function buildBehaviorStateMarkdown(result: AutomationReportInput, locale: AutomationReportLocale): string {
  const issues = result.behaviorStateIssues?.filter(Boolean) || []
  if (issues.length === 0 && !result.behaviorStateHash && !result.promptStateHash && !result.launchStateHash) {
    return ""
  }

  const lines: string[] = []

  if (issues.length > 0) {
    lines.push(locale === "zh-TW" ? "偵測到 runtime 設定漂移：" : "Runtime configuration drift was detected:")
    for (const issue of issues) {
      lines.push(`- ${issue}`)
    }
  }

  if (result.behaviorStateHash) {
    lines.push(`- ${localizeSystemLine(`Config Hash: ${result.behaviorStateHash}`, locale)}`)
  }
  if (result.promptStateHash) {
    lines.push(`- ${localizeSystemLine(`Prompt Hash: ${result.promptStateHash}`, locale)}`)
  }
  if (result.launchStateHash) {
    lines.push(`- ${localizeSystemLine(`Launch Hash: ${result.launchStateHash}`, locale)}`)
  }

  return renderMarkdown(lines, locale)
}

function toSections(
  map: Map<AutomationReportSectionKey, string>,
  locale: AutomationReportLocale,
): AutomationReportSection[] {
  return SECTION_ORDER
    .map((key) => {
      const markdown = (map.get(key) || "").trim()
      if (!markdown) return null
      return {
        key,
        title: getSectionTitle(key, locale),
        markdown,
        items: extractItems(markdown),
      }
    })
    .filter((section): section is AutomationReportSection => !!section)
}

export function buildAutomationReport(
  result: AutomationReportInput,
  locale: AutomationReportLocale = "en",
): AutomationReport {
  const cleanedSummary = sanitizeText(result.summary)
  const cleanedOutput = sanitizeText(result.output)

  const summaryParsed = parseSourceIntoSections(cleanedSummary, locale)
  const outputParsed = parseSourceIntoSections(cleanedOutput, locale)
  const mergedSections = new Map<AutomationReportSectionKey, string>(summaryParsed.sections)

  for (const key of SECTION_ORDER) {
    const outputMarkdown = outputParsed.sections.get(key) || ""
    if (!outputMarkdown) continue
    mergedSections.set(key, mergeMarkdown(mergedSections.get(key) || "", outputMarkdown))
  }

  const publishMarkdown = extractInternalPublishSection(cleanedOutput, locale)
  if (publishMarkdown) {
    mergedSections.set("results", mergeMarkdown(mergedSections.get("results") || "", publishMarkdown))
  }

  const behaviorStateMarkdown = buildBehaviorStateMarkdown(result, locale)
  if (behaviorStateMarkdown) {
    const targetKey: AutomationReportSectionKey = result.behaviorStateIssues?.length ? "issues" : "notes"
    mergedSections.set(targetKey, mergeMarkdown(mergedSections.get(targetKey) || "", behaviorStateMarkdown))
  }

  let leadMarkdown = summaryParsed.leadMarkdown || outputParsed.leadMarkdown
  if (!leadMarkdown && mergedSections.size === 0) {
    leadMarkdown = renderMarkdown(cleanedOutput.split(/\r?\n/), locale)
  }

  const sections = toSections(mergedSections, locale)
  const markdownParts: string[] = []

  if (leadMarkdown) {
    markdownParts.push(leadMarkdown)
  }

  for (const section of sections) {
    markdownParts.push(`## ${section.title}\n\n${section.markdown}`)
  }

  const markdown = markdownParts.join("\n\n").trim()

  return {
    summary: extractSummary(leadMarkdown || markdown),
    markdown,
    sections,
    fullLog: cleanedOutput,
  }
}
