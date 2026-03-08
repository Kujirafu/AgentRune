// adapters/gemini.ts
// Adapter for Google Gemini CLI (https://github.com/anthropics/gemini-cli)
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../shared/types.js"
import { makeEventId } from "./types.js"

function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[\d+;\d+H/g, "\n")
    .replace(/\x1b\[\d*[ABCD]/g, " ")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\(B/g, "")
}

export const geminiAdapter: AgentAdapter = {
  id: "gemini",
  name: "Gemini CLI",
  icon: "\u25c6",
  capabilities: ["file_edit", "file_create", "command_run", "decision_request"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []
    const text = stripAnsi(chunk)

    // File edit/create patterns (Gemini uses similar tool call indicators)
    const editMatch = text.match(/(?:\u270f\ufe0f\s*)?(?:Editing|Modifying|Updating|Patching)\s+[`"']?([^\s`"'\n]+)/i)
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

    const createMatch = text.match(/(?:\ud83d\udcc4\s*)?(?:Creating|Writing)\s+[`"']?([^\s`"'\n]+)/i)
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

    // Shell command execution
    const cmdMatch = text.match(/(?:\ud83d\udd27\s*)?(?:Running|Executing)\s+(?:command:?\s*)?[`"']?(.{5,80})[`"']?/i)
    if (cmdMatch) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "command_run",
        status: "in_progress",
        title: `$ ${cmdMatch[1].trim().slice(0, 80)}`,
        raw: chunk,
      })
    }

    // Approval/confirmation prompts (Gemini asks for tool approval)
    if (/(?:Do you want to|Allow|Approve|Confirm|proceed\?|y\/n)/i.test(text) &&
        /(?:edit|write|run|execute|delete|create|install)/i.test(text)) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "decision_request",
        status: "waiting",
        title: "Approval requested",
        detail: text.trim().split("\n")[0].slice(0, 200),
        raw: chunk,
        decision: {
          options: [
            { label: "Yes", input: "y\n", style: "primary" },
            { label: "No", input: "n\n", style: "danger" },
          ],
        },
      })
    }

    // YOLO mode / sandbox indicators
    if (/yolo mode|auto-approve/i.test(text)) {
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "info",
        status: "completed",
        title: "YOLO mode active -- all actions auto-approved",
      })
    }

    // Error detection
    if (/(?:Error|Exception|Failed|FATAL):/i.test(text) && text.length > 20) {
      const firstLine = text.trim().split("\n")[0].slice(0, 150)
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "error",
        status: "failed",
        title: firstLine,
        raw: chunk,
      })
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const clean = stripAnsi(buffer)
    const lastLine = clean.split("\n").filter(Boolean).pop()?.trim() || ""
    // Gemini CLI prompt ends with > or similar
    return /[>\u276f$%]\s*$/.test(lastLine) || /^\s*gemini\s*>/i.test(lastLine)
  },
}
