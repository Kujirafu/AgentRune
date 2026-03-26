const CSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g
const OSC_RE = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g
const CONTROL_RE = /[\x00-\x08\x0b-\x1f]/g
const PROMPT_RE = /(?:[$%>#]|[\u203A\u276F\u00BB])\s*$/
const CODEX_SEPARATOR_CLASS = "[\\u00B7\\u2022\\u2027\\u2219\\u25CF\\u30FB]"
const CODEX_STATUS_RE = new RegExp(
  `gpt-[\\w.-]+(?:\\s+\\w+)?\\s+${CODEX_SEPARATOR_CLASS}\\s+\\d+%\\s+left\\s+${CODEX_SEPARATOR_CLASS}`,
  "i",
)
const CODEX_WORKING_RE = new RegExp(
  `(?:^|${CODEX_SEPARATOR_CLASS})\\s*Working\\b|\\besc to interrupt\\b`,
  "i",
)

export type QueuedSessionTextMode = "initial" | "regular"

function stripAnsiForPromptDetection(text: string): string {
  return text
    .replace(CSI_RE, "")
    .replace(OSC_RE, "")
    .replace(CONTROL_RE, "")
}

export function isSessionPromptReady(scrollback: string, agentId: string): boolean {
  const stripped = stripAnsiForPromptDetection(scrollback)
  const lines = stripped
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  if (lines.length === 0) return false

  if (agentId === "codex") {
    const tail = lines.slice(-8).map((line) => line.trim())
    const hasStatusLine = tail.some((line) => CODEX_STATUS_RE.test(line))
    const hasWorkingLine = tail.some((line) => CODEX_WORKING_RE.test(line))
    const lastLine = tail[tail.length - 1] || ""
    return (hasStatusLine && !hasWorkingLine) || PROMPT_RE.test(lastLine)
  }

  const lastLine = lines[lines.length - 1]?.trim() || ""
  if (!lastLine) return false
  return PROMPT_RE.test(lastLine)
}

export function isImmediateSessionInput(input: string): boolean {
  if (!input) return true
  if (input === "\r" || input === "\n") return true
  if (input.startsWith("\x1b")) return true
  if (/^[\x00-\x1f\x7f]+$/.test(input)) return true

  const trimmed = input.trim()
  if (!trimmed) return true

  // Approval responses and numbered TUI selections should go through immediately.
  if (trimmed.length === 1 && /^[0-9yna]$/i.test(trimmed)) return true
  return false
}

export function buildQueuedSessionTextPayload(
  agentId: string,
  text: string,
  _mode: QueuedSessionTextMode,
): string {
  const supportsBracketPaste = agentId === "claude" || agentId === "codex"
  if (supportsBracketPaste && text.includes("\n")) {
    return `\x1b[200~${text}\x1b[201~`
  }
  return text
}

export function getQueuedSessionSubmitDelayMs(
  text: string,
  agentId?: string,
): number {
  if (agentId === "codex" && text.includes("\n")) {
    return Math.max(5000, Math.min(12000, 3000 + Math.ceil(text.length / 2)))
  }
  return text.trimStart().startsWith("/") ? 300 : 500
}
