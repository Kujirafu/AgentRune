// server/adapters/cline.ts
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../../shared/types.js"
import { makeEventId } from "./types.js"

export const clineAdapter: AgentAdapter = {
  id: "cline",
  name: "Cline",
  icon: ">_",
  capabilities: ["file_edit", "file_create", "command_run"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []
    const lines = chunk.split("\n")

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // Tool use detection
      const toolMatch = trimmed.match(/Using tool:\s*(\w+)\s*(.*)/i)
      if (toolMatch) {
        const tool = toolMatch[1]
        const detail = toolMatch[2] || ""

        if (/write_to_file|create_file/i.test(tool)) {
          events.push({
            id: makeEventId(),
            timestamp: Date.now(),
            type: detail ? "file_edit" : "file_create",
            status: "in_progress",
            title: `Writing: ${detail || "file"}`,
            detail,
          })
        } else if (/read_file/i.test(tool)) {
          events.push({
            id: makeEventId(),
            timestamp: Date.now(),
            type: "info",
            status: "in_progress",
            title: `Reading: ${detail || "file"}`,
          })
        } else if (/execute_command|run_command/i.test(tool)) {
          events.push({
            id: makeEventId(),
            timestamp: Date.now(),
            type: "command_run",
            status: "in_progress",
            title: `Running: ${detail || "command"}`,
            detail,
          })
        }
        continue
      }

      // File operations
      const writeMatch = trimmed.match(/^(Writing to|Creating)\s+(?:file:?\s*)?(.+)/i)
      if (writeMatch) {
        events.push({
          id: makeEventId(),
          timestamp: Date.now(),
          type: /creating/i.test(writeMatch[1]) ? "file_create" : "file_edit",
          status: "in_progress",
          title: `${writeMatch[1]} ${writeMatch[2]}`,
          detail: writeMatch[2],
        })
        continue
      }

      // Command execution
      const cmdMatch = trimmed.match(/^(Executing|Running):?\s+(.+)/i)
      if (cmdMatch) {
        events.push({
          id: makeEventId(),
          timestamp: Date.now(),
          type: "command_run",
          status: "in_progress",
          title: cmdMatch[2].slice(0, 60),
          detail: cmdMatch[2],
        })
        continue
      }

      // Task completion
      if (/^(Task completed|Done|Finished)/i.test(trimmed)) {
        events.push({
          id: makeEventId(),
          timestamp: Date.now(),
          type: "info",
          status: "completed",
          title: trimmed.slice(0, 80),
        })
        continue
      }

      // Error detection
      if (/^(Error|FAILED|Exception)/i.test(trimmed) && !/test/i.test(trimmed)) {
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
    return /[$%>]\s*$/.test(last) || /^cline>\s*$/.test(last)
  },
}
