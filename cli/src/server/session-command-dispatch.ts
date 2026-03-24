const CSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g
const OSC_RE = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g
const CONTROL_RE = /[\x00-\x08\x0b-\x1f]/g
const PROMPT_RE = /(?:[$%>#]|[\u203A\u276F\u00BB])\s*$/

export type QueuedSessionTextMode = "initial" | "regular"

function stripAnsiForPromptDetection(text: string): string {
  return text
    .replace(CSI_RE, "")
    .replace(OSC_RE, "")
    .replace(CONTROL_RE, "")
}

export function isSessionPromptReady(scrollback: string, _agentId: string): boolean {
  const stripped = stripAnsiForPromptDetection(scrollback)
  const lines = stripped
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
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
  mode: QueuedSessionTextMode,
): string {
  if (mode === "initial" && agentId === "claude" && text.includes("\n")) {
    return `\x1b[200~${text}\x1b[201~`
  }
  return text
}

export function getQueuedSessionSubmitDelayMs(
  text: string,
): number {
  return text.trimStart().startsWith("/") ? 300 : 500
}
