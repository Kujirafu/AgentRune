const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const FE_RE = /\x1b[@-Z\\-_]/g
const CHARSET_RE = /\x1b[()][0-9A-B]/g
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g
const DONE_MARKER_RE = /___AGENTRUNE_DONE___/g
const CODE_FENCE_RE = /^```/
const TABLE_ROW_RE = /^\|.*\|$/
const TABLE_DIVIDER_RE = /^\|?[\s:|-]+\|[\s:|-]*$/
const INTERNAL_MARKER_RE = /^__AGENTRUNE_[A-Z0-9_]+\b/
const INTERNAL_BLOCK_TITLE_RE = /^---\s*AgentRune\b/i
const INTERNAL_BLOCK_LINE_RE = /^(Platform|Posted|Post ID|Source|Error|Reason|Duplicate Of|Duplicate Guard|Duplicate Guard Error|Materials Updated|Materials Path|Materials Error):/i

const HEADING_ALIASES = [
  "本次完成",
  "做了什麼",
  "執行流程",
  "執行結果",
  "執行成果",
  "發文前檢查清單",
  "結果",
  "摘要",
  "狀態",
  "問題",
  "風險",
  "你需要手動做的事",
  "下一步",
  "已更新檔案",
  "steps",
  "actions taken",
  "results",
  "summary",
  "issues",
  "next steps",
]

const NOISE_PATTERNS = [
  /^[$#>]\s*$/,
  /^-{3,}$/,
  /^\|[-:\s|]+\|?$/,
  /^(PS )?[A-Z]:\\/i,
  /^windows powershell/i,
  /^microsoft corporation/i,
  /aka\.ms\/pswindows/i,
]

const VERDICT_KEYWORDS = [
  "判斷",
  "結論",
  "狀態報告",
  "完成",
  "已完成",
  "summary",
  "執行結果",
  "本次完成",
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

function simplifyValue(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[：:]+$/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function normalizeLine(line: string): string {
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

function isNoiseLine(line: string): boolean {
  if (!line) return true
  if (line.length > 600 && line.includes("{")) return true
  return NOISE_PATTERNS.some((pattern) => pattern.test(line))
}

function isHeadingOnly(line: string): boolean {
  const normalized = normalizeLine(line)
  const raw = line.trim()
  const looksLikeHeading = /^#{1,6}\s+/.test(raw)
    || /^\*\*.*\*\*[:：]?$/.test(raw)
    || /^__.*__[:：]?$/.test(raw)
    || (normalized.length <= 24 && !/[。！？]/.test(normalized))
  if (!looksLikeHeading) return false

  const value = simplifyValue(normalized)
  if (!value) return false
  return HEADING_ALIASES.some((alias) => {
    const candidate = simplifyValue(alias)
    return value === candidate || value.startsWith(candidate) || value.endsWith(candidate)
  })
}

function extractHeadingBody(line: string): string | null {
  const normalized = normalizeLine(line)
  const parts = normalized.split(/[：:]/)
  if (parts.length < 2) return null
  const body = parts.slice(1).join("：").trim()
  return body || null
}

function formatTableRow(line: string): string | null {
  if (!TABLE_ROW_RE.test(line.trim()) || TABLE_DIVIDER_RE.test(line.trim())) return null
  const cells = line.split("|").map((cell) => normalizeLine(cell)).filter(Boolean)
  if (cells.length < 2) return null

  const simplified = cells.map((cell) => simplifyValue(cell))
  if (
    cells.length === 2 &&
    ((simplified[0] === "項目" && simplified[1] === "結果") ||
      (simplified[0] === "step" && simplified[1] === "content"))
  ) {
    return null
  }

  return cells.length === 2 ? `${cells[0]}: ${cells[1]}` : cells.join(" | ")
}

function fallbackStatus(status: string): string {
  if (status === "success") return "Completed (no output)"
  if (status === "timeout") return "Timed out (no output)"
  return `${status} (no output)`
}

function collectSummaryLines(rawOutput: string): { primary: string[]; fallback: string[] } {
  const primary: string[] = []
  const fallback: string[] = []
  const cleaned = stripAnsi(rawOutput)

  let inCodeBlock = false
  let codeBuffer: string[] = []

  const flushCodeBlock = () => {
    const lines = codeBuffer.map((line) => normalizeLine(line)).filter(Boolean)
    const joined = lines.join("\n")
    if (joined && joined.length <= 220 && lines.length <= 3) {
      primary.push(joined)
    }
    codeBuffer = []
  }

  for (const rawLine of cleaned.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    if (INTERNAL_MARKER_RE.test(trimmed)) continue

    if (inCodeBlock) {
      if (CODE_FENCE_RE.test(trimmed)) {
        flushCodeBlock()
        inCodeBlock = false
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

    if (INTERNAL_BLOCK_TITLE_RE.test(trimmed)) continue

    if (INTERNAL_BLOCK_LINE_RE.test(trimmed)) {
      fallback.push(normalizeLine(trimmed))
      continue
    }

    const tableItem = formatTableRow(trimmed)
    if (tableItem) {
      primary.push(tableItem)
      continue
    }

    const headingBody = extractHeadingBody(trimmed)
    if (headingBody && !isNoiseLine(headingBody)) {
      primary.push(headingBody)
      continue
    }

    const normalized = normalizeLine(trimmed)
    if (!normalized || isNoiseLine(normalized) || isHeadingOnly(normalized)) continue
    primary.push(normalized)
  }

  if (inCodeBlock) flushCodeBlock()

  return { primary, fallback }
}

function mergeUnique(lines: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

export function extractAutomationSummary(rawOutput: string, status: string): string {
  try {
    if (!rawOutput) return fallbackStatus(status)

    const { primary, fallback } = collectSummaryLines(rawOutput)
    if (primary.length === 0 && fallback.length === 0) return fallbackStatus(status)

    const verdictIndex = primary.findIndex((line) =>
      VERDICT_KEYWORDS.some((keyword) => line.toLowerCase().includes(keyword.toLowerCase()))
    )

    const baseLines = verdictIndex >= 0 ? primary.slice(verdictIndex, verdictIndex + 4) : primary.slice(0, 4)
    const summaryLines = mergeUnique([
      ...baseLines,
      ...fallback.slice(0, baseLines.length > 0 ? 3 : 4),
    ])

    if (summaryLines.length === 0) return fallbackStatus(status)

    const summary = summaryLines.join("\n").trim()
    return summary.length > 600 ? `${summary.slice(0, 597)}...` : summary
  } catch {
    return status
  }
}
