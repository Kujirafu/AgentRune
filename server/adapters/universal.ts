// server/adapters/universal.ts
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../../shared/types.js"
import { makeEventId } from "./types.js"

export const universalAdapter: AgentAdapter = {
  id: "terminal",
  name: "Terminal",
  icon: ">_",
  capabilities: ["decision_request"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []

    // Detect Y/n or y/N prompts
    if (/\[Y\/n\]|\(y\/N\)|\(yes\/no\)|\[y\/N\]/i.test(chunk)) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "decision_request",
        status: "waiting",
        title: "Confirmation requested",
        detail: chunk.trim().slice(0, 200),
        raw: chunk,
        decision: {
          options: [
            { label: "Yes", input: "y\n", style: "primary" },
            { label: "No", input: "n\n", style: "danger" },
          ],
        },
      })
    }

    // Detect error patterns
    if (/^(Error|ERROR|FATAL|FAIL)[:!\s]/m.test(chunk) || /npm ERR!/m.test(chunk)) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "error",
        status: "failed",
        title: "Error detected",
        detail: chunk.trim().split("\n")[0].slice(0, 200),
        raw: chunk,
      })
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const lastLine = buffer.split("\n").filter(Boolean).pop()?.trim() || ""
    return /[$%>]\s*$/.test(lastLine)
  },
}
