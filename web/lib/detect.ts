import type { Terminal as XTerm } from "@xterm/xterm"
import type { SmartAction } from "./types"

export function isIdle(term: XTerm | null): boolean {
  if (!term) return false
  const buf = term.buffer.active
  const line = buf.getLine(buf.cursorY)?.translateToString()?.trim() || ""
  return /[$%>]\s*$/.test(line)
}

export function detectPromptActions(term: XTerm | null): SmartAction[] {
  if (!term) return []

  const buf = term.buffer.active
  const lines: string[] = []
  for (let i = Math.max(0, buf.cursorY - 5); i <= buf.cursorY; i++) {
    const line = buf.getLine(i)?.translateToString()?.trim()
    if (line) lines.push(line)
  }
  const text = lines.join("\n")

  // Claude Code: Allow tool? (y/n/a)
  if (/\(y\/n\/a\)/.test(text) || (/allow/i.test(text) && /\(y\/n\)/.test(text))) {
    return [
      { label: "Allow Once", input: "y", style: "primary" },
      { label: "Always Allow", input: "a", style: "primary" },
      { label: "Deny", input: "n", style: "danger" },
    ]
  }

  // Generic Y/n
  if (/\[Y\/n\]|\(y\/N\)|\(yes\/no\)|\[y\/N\]/i.test(text)) {
    return [
      { label: "Yes", input: "y\n", style: "primary" },
      { label: "No", input: "n\n", style: "danger" },
    ]
  }

  // Numbered options: 1) foo  2) bar
  const numberOpts = text.match(/^\s*(\d)\)\s+.+/gm)
  if (numberOpts && numberOpts.length >= 2) {
    return numberOpts.slice(0, 6).map((line) => {
      const m = line.match(/^\s*(\d)\)\s+(.+)/)
      return {
        label: m ? `${m[1]}. ${m[2].slice(0, 30)}` : line.slice(0, 30),
        input: (m?.[1] || "") + "\n",
        style: "default" as const,
      }
    })
  }

  // Press Enter to continue
  if (/press enter|hit enter|press return/i.test(text)) {
    return [{ label: "Continue", input: "\n", style: "primary" }]
  }

  return []
}

export const isMobile =
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod|Android|webOS|Mobile/i.test(navigator.userAgent)
