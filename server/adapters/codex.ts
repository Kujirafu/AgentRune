// server/adapters/codex.ts
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../../shared/types.js"
import { makeEventId } from "./types.js"

export const codexAdapter: AgentAdapter = {
  id: "codex",
  name: "Codex CLI",
  icon: "\u26A1",
  capabilities: ["file_edit", "command_run", "decision_request"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []

    // File edit pattern
    const editMatch = chunk.match(/(?:Editing|Modifying|Updating)\s+[`"]?([^\s`"]+)[`"]?/i)
    if (editMatch) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "file_edit",
        status: "in_progress",
        title: `Editing ${editMatch[1]}`,
        raw: chunk,
      })
    }

    // File create pattern
    const createMatch = chunk.match(/(?:Creating|Writing)\s+[`"]?([^\s`"]+)[`"]?/i)
    if (createMatch) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "file_create",
        status: "in_progress",
        title: `Creating ${createMatch[1]}`,
        raw: chunk,
      })
    }

    // Approval prompt
    if (/\[approve\]|\[deny\]|approve this/i.test(chunk)) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "decision_request",
        status: "waiting",
        title: "Approval requested",
        detail: chunk.trim().split("\n")[0].slice(0, 200),
        raw: chunk,
        decision: {
          options: [
            { label: "Approve", input: "y\n", style: "primary" },
            { label: "Deny", input: "n\n", style: "danger" },
          ],
        },
      })
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const lastLine = buffer.split("\n").filter(Boolean).pop()?.trim() || ""
    return /[$%>]\s*$/.test(lastLine)
  },
}
