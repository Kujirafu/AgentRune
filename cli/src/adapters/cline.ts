// adapters/cline.ts
// Cline CLI adapter -- parses output from `cline` terminal sessions.
// Cline CLI 2.0 supports two output modes:
//   1. Interactive (rich terminal UI) -- similar to other CLI agents
//   2. JSON mode (--json) -- streams newline-delimited JSON events:
//      {"type":"say","text":"I'll create the file now.","ts":1760501486669,"say":"text"}
//      {"type":"ask","text":"Allow write_to_file?","ts":...,"ask":"tool"}
// Tool names: write_to_file, replace_in_file, read_file, execute_command,
//   browser_action, search_files, list_files, insert_code_block
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../shared/types.js"
import { makeEventId } from "./types.js"

interface ClineState {
  lastToolTime: number
  lastErrorTime: number
  jsonMode: boolean
}

function getState(ctx: ParseContext): ClineState {
  if (!(ctx as any)._clineState) {
    (ctx as any)._clineState = {
      lastToolTime: 0,
      lastErrorTime: 0,
      jsonMode: false,
    }
  }
  return (ctx as any)._clineState
}

function tryParseJson(line: string): any {
  try {
    const trimmed = line.trim()
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return JSON.parse(trimmed)
    }
  } catch {}
  return null
}

export const clineAdapter: AgentAdapter = {
  id: "cline",
  name: "Cline",
  icon: ">_",
  capabilities: ["file_edit", "file_create", "command_run", "decision_request", "error"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []
    const now = Date.now()
    const state = getState(ctx)
    const lines = chunk.split("\n")

    for (const line of lines) {
      // --- JSON mode detection & parsing ---
      const json = tryParseJson(line)
      if (json && json.type && json.ts) {
        state.jsonMode = true

        if (json.type === "say") {
          // Agent saying something
          const text = (json.text || "").trim()
          if (!text) continue

          // Detect tool usage from say text
          if (/write_to_file|replace_in_file/i.test(json.say || "")) {
            const fileMatch = text.match(/[`'"]([\w/.\\-]+)[`'"]/)?.[1] || "file"
            events.push({
              id: makeEventId(),
              timestamp: json.ts || now,
              type: "file_edit",
              status: "in_progress",
              title: `Editing ${fileMatch}`,
              detail: text.slice(0, 200),
            })
          } else if (/execute_command/i.test(json.say || "")) {
            events.push({
              id: makeEventId(),
              timestamp: json.ts || now,
              type: "command_run",
              status: "in_progress",
              title: text.slice(0, 60),
              detail: text.slice(0, 200),
            })
          } else if (/error|failed|exception/i.test(json.say || "")) {
            events.push({
              id: makeEventId(),
              timestamp: json.ts || now,
              type: "error",
              status: "failed",
              title: text.slice(0, 80),
              detail: text.slice(0, 200),
            })
          } else if (/completion_result/i.test(json.say || "")) {
            events.push({
              id: makeEventId(),
              timestamp: json.ts || now,
              type: "info",
              status: "completed",
              title: text.slice(0, 80),
              detail: text.length > 80 ? text.slice(0, 300) : undefined,
            })
          }
          // Skip generic "text" say events to reduce noise
          continue
        }

        if (json.type === "ask") {
          // Agent requesting permission
          const text = (json.text || "").trim()
          events.push({
            id: makeEventId(),
            timestamp: json.ts || now,
            type: "decision_request",
            status: "waiting",
            title: text.slice(0, 80) || "Permission requested",
            detail: text.slice(0, 200),
            decision: {
              options: [
                { label: "Approve", input: "y", style: "primary" },
                { label: "Deny", input: "n", style: "danger" },
              ],
            },
          })
          continue
        }
        continue
      }

      // --- Interactive (non-JSON) mode parsing ---
      const trimmed = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim()
      if (!trimmed || state.jsonMode) continue

      // Tool use: "Using tool: write_to_file ..."
      const toolMatch = trimmed.match(/Using tool:\s*(\w+)\s*(.*)/i)
      if (toolMatch && now - state.lastToolTime > 2000) {
        state.lastToolTime = now
        const tool = toolMatch[1]
        const detail = toolMatch[2] || ""

        if (/write_to_file|replace_in_file|insert_code_block/i.test(tool)) {
          events.push({
            id: makeEventId(), timestamp: now,
            type: "file_edit", status: "in_progress",
            title: `Writing: ${detail || "file"}`,
            detail,
          })
        } else if (/execute_command|run_command/i.test(tool)) {
          events.push({
            id: makeEventId(), timestamp: now,
            type: "command_run", status: "in_progress",
            title: `Running: ${detail.slice(0, 60) || "command"}`,
            detail,
          })
        } else if (/read_file|search_files|list_files/i.test(tool)) {
          events.push({
            id: makeEventId(), timestamp: now,
            type: "info", status: "in_progress",
            title: `${tool}: ${detail || ""}`.slice(0, 60),
          })
        }
        continue
      }

      // File operations: "Writing to file.ts", "Creating file.ts"
      const writeMatch = trimmed.match(/^(Writing to|Creating|Editing)\s+(?:file:?\s*)?(.+)/i)
      if (writeMatch) {
        events.push({
          id: makeEventId(), timestamp: now,
          type: /creating/i.test(writeMatch[1]) ? "file_create" : "file_edit",
          status: "in_progress",
          title: `${writeMatch[1]} ${writeMatch[2]}`,
          detail: writeMatch[2],
        })
        continue
      }

      // Command execution: "Executing: npm run build"
      const cmdMatch = trimmed.match(/^(Executing|Running):?\s+(.+)/i)
      if (cmdMatch) {
        events.push({
          id: makeEventId(), timestamp: now,
          type: "command_run", status: "in_progress",
          title: cmdMatch[2].slice(0, 60),
          detail: cmdMatch[2],
        })
        continue
      }

      // Task completion
      if (/^(Task completed|Done|Finished|All tasks complete)/i.test(trimmed)) {
        events.push({
          id: makeEventId(), timestamp: now,
          type: "info", status: "completed",
          title: trimmed.slice(0, 80),
        })
        continue
      }

      // Errors
      if (/^(Error|FAILED|Exception)/i.test(trimmed) && !/test/i.test(trimmed)) {
        if (now - state.lastErrorTime > 5000) {
          state.lastErrorTime = now
          events.push({
            id: makeEventId(), timestamp: now,
            type: "error", status: "failed",
            title: trimmed.slice(0, 80),
            raw: trimmed,
          })
        }
        continue
      }
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const lines = buffer.split("\n").filter(l => l.trim())
    const last = lines[lines.length - 1]?.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim() || ""
    return /^[>$%]\s*$/.test(last) || /^cline>\s*$/i.test(last)
  },
}
