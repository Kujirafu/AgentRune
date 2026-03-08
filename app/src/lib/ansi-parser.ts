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
  // Strip leading emoji/symbols/boxes for pattern matching
  // NOTE: Do NOT include ● (U+25CF) or ○ (U+25CB) — they are Claude Code's tool/response markers
  const stripped = line.replace(/^[\s\u2588\u25A0\u25AA\u25AB\u25FC\u25FD\u25FE\u25FF\u{1F534}\u{1F7E5}\u{1F7E6}\u{1F7E7}\u{1F7E8}\u{1F7E9}\u{1F7EA}\u{1F7EB}\u{1F7E0}\u{1F535}\u{1F536}\u{1F537}\u{1F538}\u{1F539}\u{1F53A}\u{1F53B}\u2B1B\u2B1C\u26AA\u26AB\u{1F7E2}\u{1F7E3}■□▪▫\u2022\u2023\u2043\u204E\u2055\u{1F6D1}]+/u, "").trim()
  if (!stripped) return true
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
  if (/^background\s+command\b/i.test(line)) return true
  if (/^Update\([A-Z]:\\/i.test(line)) return true
  if (/^Update\(\//i.test(line)) return true
  if (/^(Read|Write|Edit|Bash|Glob|Grep|Agent)\([A-Z]:\\/i.test(line)) return true
  if (/^(Read|Write|Edit|Bash|Glob|Grep|Agent)\(\//i.test(line)) return true
  if (/^\d+ tokens? remaining/i.test(line)) return true
  if (/^Session \w{8}/i.test(line)) return true
  // Match using stripped line (emoji/symbols removed)
  if (/^plan\s+mode\s+on/i.test(stripped)) return true
  if (/^found\s+\d+\s+settings?\s+issue/i.test(stripped)) return true
  if (/^\d+\s*tokens?$/i.test(stripped)) return true
  if (/^Medium\s+\/model/i.test(stripped)) return true
  if (/^current:\s/i.test(stripped)) return true
  if (/^Checking\s+for\s+updates/i.test(stripped)) return true
  if (/^\d+\.\d+\.\d+\s*[·•.]\s*latest:/i.test(stripped)) return true
  if (/^[_─━═\-~]{4,}$/.test(stripped)) return true
  if (/^[·•.─━═\-~¼½¾—–\s]{3,}$/.test(line.trim())) return true
  if (/^■\s*■|^▪\s*▪/u.test(stripped)) return true
  if (/^\/doctor\b/i.test(stripped)) return true
  if (/^\/model\b/i.test(stripped)) return true
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
