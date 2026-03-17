// adapters/codex.ts
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../shared/types.js"
import { makeEventId } from "./types.js"

function buildDecisionTitle(text: string): string {
  if (/(trust|trusted).*(workspace|folder)|workspace.*(trust|trusted)|folder.*(trust|trusted)/i.test(text)) {
    return "Trust workspace"
  }
  if (/(sandbox|permission)/i.test(text)) {
    return "Permission requested"
  }
  return "Approval requested"
}

function buildDecisionOptions(text: string): AgentEvent["decision"] {
  if (/\(y\/n\/a\)/i.test(text)) {
    return {
      options: [
        { label: "Allow Once", input: "y\n", style: "primary" },
        { label: "Always Allow", input: "a\n", style: "primary" },
        { label: "Deny", input: "n\n", style: "danger" },
      ],
    }
  }

  const approveLabel = /(trust|trusted).*(workspace|folder)|workspace.*(trust|trusted)|folder.*(trust|trusted)/i.test(text)
    ? "Trust"
    : "Approve"
  return {
    options: [
      { label: approveLabel, input: "y\n", style: "primary" },
      { label: "Deny", input: "n\n", style: "danger" },
    ],
  }
}

export const codexAdapter: AgentAdapter = {
  id: "codex",
  name: "Codex CLI",
  icon: ">_",
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

    // Approval / trust prompt. Codex often uses simple y/n/a prompts instead of arrow-key TUI menus.
    const promptText = (ctx.buffer || chunk).split("\n").slice(-8).join("\n").trim()
    const hasApprovalKeywords = /(approve|approval|allow|deny|permission|trust|trusted|workspace|folder|sandbox)/i.test(promptText)
    const hasPromptMarkers = /\[approve\]|\[deny\]|approve this|\(y\/n\/a\)|\[Y\/n\]|\[y\/N\]|\(y\/N\)|\(yes\/no\)|\[yes\/no\]/i.test(promptText)
    if (hasApprovalKeywords && hasPromptMarkers) {
      const lines = promptText.split("\n").map((line) => line.trim()).filter(Boolean)
      const detail = lines.slice(-3).join("\n").slice(0, 400)
      events.push({
        id: makeEventId(),
        timestamp: Date.now(),
        type: "decision_request",
        status: "waiting",
        title: buildDecisionTitle(promptText),
        detail,
        raw: promptText,
        decision: buildDecisionOptions(promptText),
      })
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const lastLine = buffer.split("\n").filter(Boolean).pop()?.trim() || ""
    return /[$%>]\s*$/.test(lastLine)
  },
}
