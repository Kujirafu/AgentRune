/**
 * Parse Claude Code terminal output into structured blocks.
 * Detects code diffs, tool usage, and Claude's response text.
 *
 * NOTE: Claude Code does NOT output extended thinking to the terminal.
 * The "thinking" status bar fragments (e.g. "*9thinking", "12 tokens · thinking)")
 * are status indicators, not actual thought content. We skip them entirely.
 */

export interface OutputBlock {
  type: "thinking" | "code" | "diff" | "text" | "tool" | "response"
  content: string
  timestamp: number
}

// Tool call pattern
const TOOL_PATTERNS = /●\s*(?:Read|Write|Edit|Bash|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit|Skill|TaskCreate|TaskUpdate|TaskList|TaskGet)\(/
// Claude response marker (● followed by non-tool text)
const RESPONSE_MARKER = /●\s*(?!Read|Write|Edit|Bash|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit|Skill|TaskCreate|TaskUpdate|TaskList|TaskGet)\S/
const DIFF_PATTERNS = /^[+-]{3}\s|^@@\s|^diff --git|^\s*\d+\s+[-+]\s/
const CODE_FENCE = /^```/

/**
 * Detect status bar noise lines that should be completely skipped.
 */
function isNoiseLine(line: string): boolean {
  if (line.length <= 2) return true
  if (/^PS\s+[A-Z]:/i.test(line)) return true
  if (/^[A-Z]:\\[^●]*>/i.test(line)) return true
  if (/^[>$%#]\s*$/.test(line)) return true
  if (/^著作權|^版权|^Copyright.*Microsoft/i.test(line)) return true
  if (/^安裝最新|^install.*latest.*powershell/i.test(line)) return true
  if (/[*]\s*\d*\s*(?:Thinking|Whirring|Tinkering|Cogitating|Infusing|Brewing|Sketching|Lollygagging|Frolicking|Schlepping|Pondering|Musing|Grooving|Brewed|Thought|Philosophising|Philosophizing)/i.test(line)) return true
  if (/(?:Thinking|Philosophising|Philosophizing|Pondering|Musing|Brewing|Whirring)/i.test(line) && (line.match(/(?:Thinking|Philosophising|Philosophizing|Pondering|Musing|Brewing|Whirring)/gi) || []).length >= 2) return true
  if (/^\(\d+\.?\d*s\s*[·•]\s*[↑↓]?\s*\d[\d,]*\s*tokens?\)/i.test(line)) return true
  if (/^plan\s+mode\s+on\s*\(/i.test(line)) return true
  if (/^shift\+tab\s+to\s+cycle/i.test(line)) return true
  if (/^thought\s+for\s+\d+s$/i.test(line)) return true
  if (/^\/remote.control\s+is\s+active/i.test(line)) return true
  if (/^[├└│┌┐┘┤┬┴┼╭╮╰╯⎿]/.test(line)) return true
  return false
}

export class AnsiParser {
  private blocks: OutputBlock[] = []
  private currentBlock: OutputBlock | null = null
  private inCodeFence = false

  getBlocks(): OutputBlock[] {
    return [...this.blocks]
  }

  getThinkingBlocks(): OutputBlock[] {
    return this.blocks.filter((b) => b.type === "thinking")
  }

  getCodeBlocks(): OutputBlock[] {
    const raw = this.blocks.filter((b) => b.type === "code" || b.type === "diff")
    const merged: OutputBlock[] = []
    for (const b of raw) {
      const prev = merged[merged.length - 1]
      if (prev && prev.type === "diff" && b.type === "diff" && b.timestamp - prev.timestamp < 10000) {
        prev.content += "\n" + b.content
      } else {
        merged.push({ ...b })
      }
    }
    return merged
  }

  getToolBlocks(): OutputBlock[] {
    return this.blocks.filter((b) => b.type === "tool")
  }

  /** Extract URLs found across all blocks, with surrounding context */
  getUrlBlocks(): { url: string; context: string; timestamp: number }[] {
    const urlRe = /https?:\/\/[^\s)<>\]"'`]+/g
    const seen = new Set<string>()
    const results: { url: string; context: string; timestamp: number }[] = []

    for (const block of this.blocks) {
      const lines = block.content.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const matches = lines[i].matchAll(urlRe)
        for (const m of matches) {
          const url = m[0].replace(/[.,;:!?)]+$/, "")
          if (seen.has(url)) continue
          seen.add(url)
          const start = Math.max(0, i - 1)
          const end = Math.min(lines.length - 1, i + 1)
          const context = lines.slice(start, end + 1).join("\n").trim()
          results.push({ url, context, timestamp: block.timestamp })
        }
      }
    }
    return results
  }

  /**
   * Feed raw terminal output data and parse into blocks.
   */
  feed(data: string) {
    const clean = stripAnsi(data)
    const lines = clean.split("\n")

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      if (isNoiseLine(trimmed)) continue

      if (CODE_FENCE.test(trimmed)) {
        if (this.inCodeFence) {
          if (this.currentBlock?.type === "code") {
            this.currentBlock.content += "\n" + trimmed
          }
          this.inCodeFence = false
          this.flushBlock()
          continue
        } else {
          this.flushBlock()
          this.inCodeFence = true
          this.currentBlock = { type: "code", content: trimmed, timestamp: Date.now() }
          continue
        }
      }

      if (this.inCodeFence && this.currentBlock?.type === "code") {
        this.currentBlock.content += "\n" + trimmed
        continue
      }

      if (TOOL_PATTERNS.test(trimmed)) {
        this.flushBlock()
        this.currentBlock = { type: "tool", content: trimmed, timestamp: Date.now() }
        this.flushBlock()
        continue
      }

      if (RESPONSE_MARKER.test(trimmed)) {
        this.flushBlock()
        this.currentBlock = { type: "response", content: trimmed.replace(/^●\s*/, ""), timestamp: Date.now() }
        continue
      }

      if (this.currentBlock?.type === "response" && !TOOL_PATTERNS.test(trimmed) && !DIFF_PATTERNS.test(trimmed)) {
        this.currentBlock.content += "\n" + trimmed
        continue
      }

      if (DIFF_PATTERNS.test(trimmed)) {
        if (this.currentBlock?.type === "diff") {
          this.currentBlock.content += "\n" + trimmed
        } else {
          this.flushBlock()
          this.currentBlock = { type: "diff", content: trimmed, timestamp: Date.now() }
        }
        continue
      }

      if (this.currentBlock?.type === "text") {
        this.currentBlock.content += "\n" + trimmed
      } else {
        this.flushBlock()
        this.currentBlock = { type: "text", content: trimmed, timestamp: Date.now() }
      }
    }

    if (this.currentBlock?.type === "text" || this.currentBlock?.type === "response") {
      this.flushBlock()
    }
  }

  private flushBlock() {
    if (this.currentBlock && this.currentBlock.content.trim()) {
      this.blocks.push(this.currentBlock)
      if (this.blocks.length > 200) {
        this.blocks = this.blocks.slice(-200)
      }
    }
    this.currentBlock = null
  }

  clear() {
    this.blocks = []
    this.currentBlock = null
    this.inCodeFence = false
  }
}

/**
 * Strip ANSI escape sequences from text
 */
export function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[\d+;\d+H/g, "\n")
    .replace(/\x1b\[\d*[ABCD]/g, " ")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[78]/g, "")
    .replace(/\x1b\([A-Z]/g, "")
}
