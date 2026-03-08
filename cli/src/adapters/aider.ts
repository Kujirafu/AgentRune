// adapters/aider.ts
// Aider CLI adapter -- parses PTY output from `aider` terminal sessions.
// Real output patterns from aider.chat docs + transcripts:
//   "Added README.md to the chat"
//   "Applied edit to README.md"
//   "Commit 024f45e aider: Updated command line arguments..."
//   "Tokens: 1.2k sent, 245 received. Cost: $0.0023..."
//   Prompt: "aider> " or "> " (continuation)
//   Errors: Python tracebacks, "ERROR:", "Can't find file"
//   Diffs: SEARCH/REPLACE blocks with <<<<<<< / >>>>>>> markers
//   Commands: /add, /drop, /run, /diff, /undo, /commit, /help, etc.
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../shared/types.js"
import { makeEventId } from "./types.js"

interface AiderState {
  lastEditTime: number
  lastCommitTime: number
  lastCostTime: number
  lastErrorTime: number
  pendingFile: string
}

function getState(ctx: ParseContext): AiderState {
  if (!(ctx as any)._aiderState) {
    (ctx as any)._aiderState = {
      lastEditTime: 0,
      lastCommitTime: 0,
      lastCostTime: 0,
      lastErrorTime: 0,
      pendingFile: "",
    }
  }
  return (ctx as any)._aiderState
}

export const aiderAdapter: AgentAdapter = {
  id: "aider",
  name: "Aider",
  icon: ">_",
  capabilities: ["file_edit", "file_create", "command_run", "info", "error"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []
    const now = Date.now()
    const state = getState(ctx)
    const lines = chunk.split("\n")

    for (const line of lines) {
      const trimmed = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim()
      if (!trimmed) continue

      // "Applied edit to <file>" -- confirmed edit
      const appliedMatch = trimmed.match(/^Applied edit to\s+(.+)/i)
      if (appliedMatch && now - state.lastEditTime > 2000) {
        state.lastEditTime = now
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "file_edit",
          status: "completed",
          title: `Edited ${appliedMatch[1]}`,
          detail: appliedMatch[1],
        })
        continue
      }

      // "Added <file> to the chat" -- file added to context
      const addedMatch = trimmed.match(/^Added\s+(.+?)\s+to the chat/i)
      if (addedMatch) {
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "info",
          status: "completed",
          title: `Added ${addedMatch[1]}`,
        })
        continue
      }

      // "Commit <hash> <message>" -- git commit
      const commitMatch = trimmed.match(/^Commit\s+([a-f0-9]{6,})\s+(.+)/i)
      if (commitMatch && now - state.lastCommitTime > 3000) {
        state.lastCommitTime = now
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "info",
          status: "completed",
          title: `Committed: ${commitMatch[2].slice(0, 60)}`,
          detail: `${commitMatch[1].slice(0, 7)} ${commitMatch[2]}`,
        })
        continue
      }

      // "Tokens: ... Cost: $X.XX" -- usage tracking
      const costMatch = trimmed.match(/Tokens:\s*([\d,.]+k?)\s*sent.*?Cost:\s*\$?([\d.]+)/i)
      if (costMatch && now - state.lastCostTime > 10000) {
        state.lastCostTime = now
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "info",
          status: "completed",
          title: `Tokens: ${costMatch[1]} sent \u00b7 Cost: $${costMatch[2]}`,
        })
        continue
      }

      // "/run <command>" -- user ran a shell command via aider
      const runMatch = trimmed.match(/^>\s*\/run\s+(.+)/i)
      if (runMatch) {
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "command_run",
          status: "in_progress",
          title: runMatch[1].slice(0, 60),
          detail: runMatch[1],
        })
        continue
      }

      // "Creating <file>" -- new file
      const createMatch = trimmed.match(/^(?:Creating|Writing)\s+(?:new\s+)?file\s+(.+)/i)
      if (createMatch) {
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "file_create",
          status: "in_progress",
          title: `Creating ${createMatch[1]}`,
          detail: createMatch[1],
        })
        continue
      }

      // Error patterns: Python tracebacks, explicit errors
      if (now - state.lastErrorTime > 5000) {
        const isError = /^(Traceback|Error|ERROR|FAILED|Can't find)/i.test(trimmed) ||
          /^aider:\s*error/i.test(trimmed)
        if (isError && !/test/i.test(trimmed)) {
          state.lastErrorTime = now
          events.push({
            id: makeEventId(),
            timestamp: now,
            type: "error",
            status: "failed",
            title: trimmed.slice(0, 80),
            raw: trimmed,
          })
          continue
        }
      }

      // Test results
      if (/(\d+)\s+(?:tests?\s+)?pass/i.test(trimmed)) {
        const passMatch = trimmed.match(/(\d+)\s+(?:tests?\s+)?pass/i)
        const failMatch = trimmed.match(/(\d+)\s+(?:tests?\s+)?fail/i)
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "test_result",
          status: failMatch ? "failed" : "completed",
          title: failMatch
            ? `Tests: ${passMatch?.[1] || "?"} passed, ${failMatch[1]} failed`
            : `Tests: ${passMatch?.[1] || "?"} passed`,
        })
        continue
      }
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const lines = buffer.split("\n").filter(l => l.trim())
    const last = lines[lines.length - 1]?.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim() || ""
    // Aider prompts: "aider> ", "> " (continuation), or just ">" after session start
    return /^(aider\s*)?>\s*$/.test(last) || /^[>$%]\s*$/.test(last)
  },
}
