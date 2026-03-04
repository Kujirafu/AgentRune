// server/adapters/openclaw.ts
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../../shared/types.js"
import { makeEventId } from "./types.js"

export const openclawAdapter: AgentAdapter = {
  id: "openclaw",
  name: "OpenClaw",
  icon: ">_",
  capabilities: ["command_run", "decision_request", "info"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []

    // Skill execution
    const skillMatch = chunk.match(/(?:Running|Executing|Using)\s+skill[:\s]+[`"]?([^\s`"\n]+)[`"]?/i)
    if (skillMatch) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "command_run",
        status: "in_progress",
        title: `Running skill: ${skillMatch[1]}`,
        raw: chunk,
      })
    }

    // Task completion
    if (/(?:completed|done|finished|success)/i.test(chunk) && /(?:task|skill|action)/i.test(chunk)) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "info",
        status: "completed",
        title: "Task completed",
        detail: chunk.trim().split("\n")[0].slice(0, 200),
        raw: chunk,
      })
    }

    // Confirmation prompts
    if (/\[Y\/n\]|\(y\/N\)|confirm|proceed\?/i.test(chunk)) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "decision_request",
        status: "waiting",
        title: "Confirmation needed",
        detail: chunk.trim().split("\n")[0].slice(0, 200),
        raw: chunk,
        decision: {
          options: [
            { label: "Yes", input: "y\n", style: "primary" },
            { label: "No", input: "n\n", style: "danger" },
          ],
        },
      })
    }

    // Error patterns
    if (/(?:error|failed|exception)/i.test(chunk) && !/test/i.test(chunk)) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "error",
        status: "failed",
        title: "Error occurred",
        detail: chunk.trim().split("\n")[0].slice(0, 200),
        raw: chunk,
      })
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const lastLine = buffer.split("\n").filter(Boolean).pop()?.trim() || ""
    return /[$%>]\s*$/.test(lastLine) || /openclaw>/i.test(lastLine)
  },
}
