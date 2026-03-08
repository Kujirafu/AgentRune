// adapters/cursor.ts
// Cursor Agent CLI adapter -- parses output from `agent` terminal sessions.
// Cursor CLI supports:
//   1. Interactive mode (default) -- rich terminal UI
//   2. JSON output (--output-format json) -- structured output
// Modes: agent (default), plan, ask
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../shared/types.js"
import { makeEventId } from "./types.js"

interface CursorState {
  lastToolTime: number
  lastErrorTime: number
  lastThinkingTime: number
  lastResponseTime: number
  responseAccum: string
  responseAccumTime: number
  seenTools: Set<string>
  seenToolsExpire: number
}

function getState(ctx: ParseContext): CursorState {
  if (!(ctx as any)._cursorState) {
    (ctx as any)._cursorState = {
      lastToolTime: 0,
      lastErrorTime: 0,
      lastThinkingTime: 0,
      lastResponseTime: 0,
      responseAccum: "",
      responseAccumTime: 0,
      seenTools: new Set<string>(),
      seenToolsExpire: Date.now() + 30000,
    }
  }
  return (ctx as any)._cursorState
}

/** Strip ANSI escape codes */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[\d+;\d+H/g, "\n")
    .replace(/\x1b\[\d*[ABCD]/g, " ")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\(B/g, "")
}

function stripAnsiFlat(s: string): string {
  return s
    .replace(/\x1b\[\d+;\d+H/g, "")
    .replace(/\x1b\[\d*[ABCD]/g, " ")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\(B/g, "")
}

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  name: "Cursor Agent",
  icon: ">_",
  capabilities: ["file_edit", "file_create", "command_run", "test_result", "decision_request", "error"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []
    const now = Date.now()
    const state = getState(ctx)

    // Expire seen tools every 30s
    if (now > state.seenToolsExpire) {
      state.seenTools.clear()
      state.seenToolsExpire = now + 30000
    }

    const clean = stripAnsi(chunk)
    const flatClean = stripAnsiFlat(chunk)

    // --- Tool call patterns ---
    // Cursor Agent uses similar tool patterns: Edit, Read, Write, Bash, etc.
    const toolPatterns: [RegExp, string, (m: RegExpMatchArray) => string][] = [
      [/\u25cf?\s*Read\(([^)]+)\)/i, "info", m => `Reading ${m[1]}`],
      [/\u25cf?\s*Edit\(([^)]+)\)/i, "file_edit", m => `Editing ${m[1]}`],
      [/\u25cf?\s*Write\(([^)]+)\)/i, "file_create", m => `Creating ${m[1]}`],
      [/\u25cf?\s*(?:Bash|Terminal|Shell)\(([^)]*)\)/i, "command_run", m => `Running command`],
      [/\u25cf?\s*(?:Glob|Grep|Search|ListFiles)\(([^)]*)\)/i, "info", m => `Searching`],
      // Cursor-specific tool patterns
      [/(?:editing|writing to|creating)\s+(?:file:?\s*)?([^\s]+\.\w+)/i, "file_edit", m => `Editing ${m[1]}`],
      [/(?:running|executing)\s+(?:command:?\s*)?[`']?([^`'\n]+)/i, "command_run", m => `Running: ${m[1].slice(0, 60)}`],
      [/(?:reading|searching|listing)\s+(?:file:?\s*)?([^\s]+)/i, "info", m => `Reading ${m[1]}`],
    ]

    let hasToolCall = false
    for (const [pattern, type, titleFn] of toolPatterns) {
      const m = flatClean.match(pattern)
      if (m) {
        hasToolCall = true
        const sig = `${m[0].slice(0, 60)}`
        if (!state.seenTools.has(sig)) {
          state.seenTools.add(sig)
          events.push({
            id: makeEventId(),
            timestamp: now,
            type: type as AgentEvent["type"],
            status: "in_progress",
            title: titleFn(m),
            detail: (m[1] || "").slice(0, 200),
            raw: chunk,
          })
        }
      }
    }

    // --- Permission / approval prompt ---
    if (/\(y\/n\)/.test(clean) || /\(y\/n\/a\)/.test(clean) || /(?:allow|approve|confirm)\?/i.test(clean)) {
      const detail = clean.replace(/[\r\n]+/g, " ").trim().slice(0, 200)
      events.push({
        id: makeEventId(),
        timestamp: now,
        type: "decision_request",
        status: "waiting",
        title: "Permission requested",
        detail,
        raw: chunk,
        decision: {
          options: [
            { label: "Allow", input: "y", style: "primary" },
            { label: "Deny", input: "n", style: "danger" },
          ],
        },
      })
    }

    // --- Test results ---
    if (/tests?\s+passed/i.test(clean) || /\d+\s+passing/i.test(clean)) {
      const passMatch = clean.match(/(\d+)\s+(?:tests?\s+)?pass/i)
      const failMatch = clean.match(/(\d+)\s+(?:tests?\s+)?fail/i)
      events.push({
        id: makeEventId(),
        timestamp: now,
        type: "test_result",
        status: failMatch ? "failed" : "completed",
        title: "Test results",
        detail: `${passMatch?.[1] || "?"} passed${failMatch ? `, ${failMatch[1]} failed` : ""}`,
        raw: chunk,
      })
    }

    // --- Thinking indicator (throttle: 3s) ---
    if (/thinking|reasoning|planning/i.test(clean) && now - state.lastThinkingTime > 3000) {
      // Skip if it's a tool call or response text
      if (!hasToolCall && !/(?:editing|writing|running|reading)/i.test(clean)) {
        state.lastThinkingTime = now
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "info",
          status: "in_progress",
          title: "Thinking...",
          raw: chunk,
        })
      }
    }

    // --- Error detection ---
    if (/^(?:Error|FAILED|Exception|error:)/im.test(clean) && !/test/i.test(clean)) {
      if (now - state.lastErrorTime > 5000) {
        state.lastErrorTime = now
        const errorLine = clean.split("\n").find(l => /^(?:Error|FAILED|Exception|error:)/i.test(l.trim()))
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "error",
          status: "failed",
          title: (errorLine || clean).trim().slice(0, 80),
          raw: chunk,
        })
      }
    }

    // --- Response text accumulation ---
    if (!hasToolCall) {
      const lines = clean.split("\n")
      const responseLines: string[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.length < 3) continue
        // Skip noise
        if (/^[$%>\u276f]\s*$/.test(trimmed)) continue
        if (/thinking|reasoning/i.test(trimmed) && trimmed.length < 30) continue
        if (/Cursor Agent|agent>/i.test(trimmed) && trimmed.length < 40) continue
        responseLines.push(trimmed)
      }
      const responseText = responseLines.join("\n").trim()
      if (responseText.length >= 10) {
        if (now - state.responseAccumTime > 15000) {
          // Flush old response
          if (state.responseAccum.length > 10 && now - state.lastResponseTime > 2000) {
            state.lastResponseTime = now
            events.push({
              id: makeEventId(),
              timestamp: state.responseAccumTime,
              type: "info",
              status: "completed",
              title: state.responseAccum.length > 300 ? "Cursor responded (detailed)" : "Cursor responded",
              detail: state.responseAccum.slice(0, 3000),
              raw: chunk,
            })
          }
          state.responseAccum = responseText
          state.responseAccumTime = now
        } else {
          state.responseAccum += "\n" + responseText
        }
      }
    }

    // Flush accumulated response on tool call or idle
    if (state.responseAccum.length > 10 && (hasToolCall || ctx.isIdle) && now - state.lastResponseTime > 2000) {
      state.lastResponseTime = now
      events.push({
        id: makeEventId(),
        timestamp: state.responseAccumTime,
        type: "info",
        status: "completed",
        title: state.responseAccum.length > 300 ? "Cursor responded (detailed)" : "Cursor responded",
        detail: state.responseAccum.slice(0, 3000),
        raw: chunk,
      })
      state.responseAccum = ""
      state.responseAccumTime = 0
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const clean = stripAnsi(buffer)
    const lastLine = clean.split("\n").filter(Boolean).pop()?.trim() || ""
    return /[$%>\u276f]\s*$/.test(lastLine) || /^>\s*$/.test(lastLine) || /^agent>\s*$/i.test(lastLine)
  },
}
