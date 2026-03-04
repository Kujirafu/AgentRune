/**
 * Parse Claude Code terminal output into structured blocks.
 * Detects code diffs, tool usage, and Claude's response text.
 *
 * NOTE: Claude Code does NOT output extended thinking to the terminal.
 * The "thinking" status bar fragments (e.g. "*9thinking", "12 tokens · thinking)")
 * are status indicators, not actual thought content. We skip them entirely.
 */

export interface OutputBlock {
  type: "thinking" | "code" | "diff" | "text" | "tool"
  content: string
  timestamp: number
}

// Tool call pattern
const TOOL_PATTERNS = /●\s*(?:Read|Write|Edit|Bash|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit|Skill|TaskCreate|TaskUpdate|TaskList|TaskGet)\(/
const DIFF_PATTERNS = /^[+-]{3}\s|^@@\s|^diff --git/
const CODE_FENCE = /^```/

/**
 * Detect status bar noise lines that should be completely skipped.
 * Claude Code status bar emits fragments like:
 *   * Thinking...    *9thinking    12 tokens · thinking)
 *   (5s · ↓ 28681 tokens)    plan mode on (shift+tab to cycle)
 */
function isNoiseLine(line: string): boolean {
  // Very short lines — single digits, symbols, fragments
  if (line.length <= 2) return true
  // Lines containing ANY box-drawing / separator / middle-dot chars
  if (/[─━═┄┈╌╍┅┉▬▭▮▯│┃┆┊╎║╏┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬·]/.test(line)) return true
  // 3+ consecutive dashes/equals/underscores
  if (/[-=_]{3,}/.test(line)) return true
  // Lines containing ellipsis (status animation)
  if (/…/.test(line)) return true
  // Shell prompts
  if (/^PS\s+[A-Z]:/i.test(line)) return true
  if (/^[A-Z]:\\.*>/i.test(line)) return true
  if (/^[❯>$%#]\s*/.test(line)) return true
  if (/^\w+@\w+[:\s~]/.test(line)) return true
  // Lines starting with / (commands/paths)
  if (/^\/\w/.test(line)) return true
  // Shell banners & system messages
  if (/powershell|著作權|版权|copyright|microsoft/i.test(line)) return true
  if (/\(c\)\s*\d{4}/i.test(line)) return true
  if (/^安裝最新|^install.*latest/i.test(line)) return true
  if (/^bash-?\d|^zsh|^fish/i.test(line)) return true
  // Error output
  if (/categoryinfo|fullyqualifiederrorid/i.test(line)) return true
  if (/commandnotfound/i.test(line)) return true
  if (/^\+\s+\w+/i.test(line)) return true
  // Claude Code / AI branding / versions
  if (/claude|anthropic|sonnet|opus|haiku/i.test(line)) return true
  if (/v\d+\.\d+/i.test(line)) return true
  if (/remote.control|is active|Code in CLI/i.test(line)) return true
  // MCP / session noise
  if (/mcp|needs?\s+auth|session_/i.test(line)) return true
  // URLs and paths
  if (/https?:\/\//i.test(line)) return true
  if (/[A-Z]:\\[\w\\]/i.test(line)) return true
  if (/~[\\\/]\w/.test(line)) return true
  // Status verbs & thinking
  if (/^[*✱∗∴]\s*\d*\s*[A-Za-z]/i.test(line)) return true
  if (/thinking|whirring/i.test(line)) return true
  if (/^running\s+\w+/i.test(line)) return true
  // Metadata: tokens, timing
  if (/\d+\s*tokens?/i.test(line)) return true
  if (/^\(\d+\.?\d*s/i.test(line)) return true
  if (/plan\s+mode/i.test(line)) return true
  if (/shift\+tab/i.test(line)) return true
  if (/thought\s+for\s+\d+s/i.test(line)) return true
  if (/^[🟥🟩🟨⬛🔴🟢🟡⚪]\s/.test(line)) return true
  if (/^[↑↓]/.test(line)) return true
  // Short garbage — low alpha ratio
  if (line.length < 20) {
    const alpha = (line.match(/[a-zA-Z\u4e00-\u9fff]/g) || []).length
    if (alpha / line.length < 0.6) return true
  }
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
    return this.blocks.filter((b) => b.type === "code" || b.type === "diff")
  }

  getToolBlocks(): OutputBlock[] {
    return this.blocks.filter((b) => b.type === "tool")
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

      // Skip ALL status bar noise
      if (isNoiseLine(trimmed)) continue

      // Code fence toggle
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

      // Inside code fence — accumulate
      if (this.inCodeFence && this.currentBlock?.type === "code") {
        this.currentBlock.content += "\n" + trimmed
        continue
      }

      // Detect tool usage
      if (TOOL_PATTERNS.test(trimmed)) {
        this.flushBlock()
        this.currentBlock = { type: "tool", content: trimmed, timestamp: Date.now() }
        this.flushBlock()
        continue
      }

      // Detect diff blocks
      if (DIFF_PATTERNS.test(trimmed)) {
        if (this.currentBlock?.type === "diff") {
          this.currentBlock.content += "\n" + trimmed
        } else {
          this.flushBlock()
          this.currentBlock = { type: "diff", content: trimmed, timestamp: Date.now() }
        }
        continue
      }

      // Everything else is response text — accumulate into text blocks
      if (this.currentBlock?.type === "text") {
        this.currentBlock.content += "\n" + trimmed
      } else {
        this.flushBlock()
        this.currentBlock = { type: "text", content: trimmed, timestamp: Date.now() }
      }
    }

    // Flush text blocks immediately so they appear in the panel
    if (this.currentBlock?.type === "text") {
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
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[78DMEHcn]/g, "")
    .replace(/\x1b\(B/g, "")
}
