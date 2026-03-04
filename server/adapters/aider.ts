// server/adapters/aider.ts
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../../shared/types.js"
import { makeEventId } from "./types.js"

export const aiderAdapter: AgentAdapter = {
  id: "aider",
  name: "Aider",
  icon: ">_",
  capabilities: ["file_edit", "git_commit", "cost_tracking"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []
    const lines = chunk.split("\n")

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // File editing
      const editMatch = trimmed.match(/^>\s*(Add|Editing|Applied edit to)\s+(.+)/i)
      if (editMatch) {
        const isNew = /^add/i.test(editMatch[1])
        events.push({
          id: makeEventId(),
          timestamp: Date.now(),
          type: isNew ? "file_create" : "file_edit",
          status: "in_progress",
          title: `${isNew ? "Adding" : "Editing"} ${editMatch[2]}`,
          detail: editMatch[2],
        })
        continue
      }

      // Git commit
      const commitMatch = trimmed.match(/^Commit\s+([a-f0-9]+)\s+(.+)/i)
      if (commitMatch) {
        events.push({
          id: makeEventId(),
          timestamp: Date.now(),
          type: "info",
          status: "completed",
          title: `Committed: ${commitMatch[2]}`,
          detail: `Commit ${commitMatch[1].slice(0, 7)}`,
        })
        continue
      }

      // Cost tracking
      const costMatch = trimmed.match(/Tokens:.*Cost:\s*\$?([\d.]+)/i)
      if (costMatch) {
        events.push({
          id: makeEventId(),
          timestamp: Date.now(),
          type: "info",
          status: "completed",
          title: `Session cost: $${costMatch[1]}`,
        })
        continue
      }

      // Error
      if (/^(Error|FAILED|Traceback)/i.test(trimmed) && !/test/i.test(trimmed)) {
        events.push({
          id: makeEventId(),
          timestamp: Date.now(),
          type: "error",
          status: "failed",
          title: trimmed.slice(0, 80),
          raw: trimmed,
        })
        continue
      }
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const lines = buffer.split("\n").filter(l => l.trim())
    const last = lines[lines.length - 1]?.trim() || ""
    // Aider prompt patterns
    return /^(aider|>)\s*[>$]\s*$/.test(last) || /[$%>]\s*$/.test(last)
  },
}
