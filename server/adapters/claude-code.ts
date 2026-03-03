// server/adapters/claude-code.ts
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../../shared/types.js"
import { makeEventId } from "./types.js"

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude",
  name: "Claude Code",
  icon: "\u{1F916}",
  capabilities: ["file_edit", "file_create", "command_run", "test_result", "decision_request"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []

    // Tool call: Read
    const readMatch = chunk.match(/● Read\(([^)]+)\)/)
    if (readMatch) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "info",
        status: "completed",
        title: `Reading ${readMatch[1]}`,
        raw: chunk,
      })
    }

    // Tool call: Edit
    const editMatch = chunk.match(/● Edit\(([^)]+)\)/)
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

    // Tool call: Write (new file)
    const writeMatch = chunk.match(/● Write\(([^)]+)\)/)
    if (writeMatch) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "file_create",
        status: "in_progress",
        title: `Creating ${writeMatch[1]}`,
        raw: chunk,
      })
    }

    // Tool call: Bash
    const bashMatch = chunk.match(/● Bash\(([^)]*)\)/)
    if (bashMatch) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "command_run",
        status: "in_progress",
        title: `Running command`,
        detail: bashMatch[1].slice(0, 100) || undefined,
        raw: chunk,
      })
    }

    // Permission prompt: Allow tool? (y/n/a)
    if (/\(y\/n\/a\)/.test(chunk) || (/allow/i.test(chunk) && /\(y\/n\)/.test(chunk))) {
      const toolLine = chunk.split("\n").find((l) => /allow/i.test(l) || /\(y\/n/.test(l)) || ""
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "decision_request",
        status: "waiting",
        title: "Permission requested",
        detail: toolLine.trim().slice(0, 200),
        raw: chunk,
        decision: {
          options: [
            { label: "Allow once", input: "y", style: "primary" },
            { label: "Always allow", input: "a", style: "primary" },
            { label: "Deny", input: "n", style: "danger" },
          ],
        },
      })
    }

    // Test results
    if (/tests?\s+passed/i.test(chunk) || /\d+\s+passing/i.test(chunk)) {
      const passMatch = chunk.match(/(\d+)\s+(?:tests?\s+)?pass/i)
      const failMatch = chunk.match(/(\d+)\s+(?:tests?\s+)?fail/i)
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "test_result",
        status: failMatch ? "failed" : "completed",
        title: "Test results",
        detail: `${passMatch?.[1] || "?"} passed${failMatch ? `, ${failMatch[1]} failed` : ""}`,
        raw: chunk,
      })
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const lastLine = buffer.split("\n").filter(Boolean).pop()?.trim() || ""
    return /[$%>]\s*$/.test(lastLine) || /^>\s*$/.test(lastLine)
  },
}
