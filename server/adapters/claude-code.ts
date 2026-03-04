// server/adapters/claude-code.ts
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../../shared/types.js"
import { makeEventId } from "./types.js"

/** Strip ANSI escape codes for pattern matching */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\(B/g, "")
}

/** Per-session adapter state (stored on context object) */
interface AdapterState {
  pending: string           // Text from previous chunk (for split ● detection)
  lastThinkingTime: number
  lastResponseTime: number
  lastTokenTime: number
  seenTools: Set<string>    // Dedup tool calls by signature
  seenToolsExpire: number   // Clear seen set periodically
}

function getState(ctx: ParseContext): AdapterState {
  if (!(ctx as any)._as) {
    (ctx as any)._as = {
      pending: "",
      lastThinkingTime: 0,
      lastResponseTime: 0,
      lastTokenTime: 0,
      seenTools: new Set<string>(),
      seenToolsExpire: Date.now() + 30000,
    }
  }
  return (ctx as any)._as
}

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude",
  name: "Claude Code",
  icon: ">_",
  capabilities: ["file_edit", "file_create", "command_run", "test_result", "decision_request"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []
    const now = Date.now()
    const state = getState(ctx)

    // Expire seen tools every 30s to prevent unbounded growth
    if (now > state.seenToolsExpire) {
      state.seenTools.clear()
      state.seenToolsExpire = now + 30000
    }

    // Strip ANSI, combine with pending text from previous chunk
    const clean = stripAnsi(chunk)
    const text = state.pending + clean
    state.pending = ""

    // ─── Tool calls (checked independently, not exclusive) ───
    const toolPatterns: [RegExp, string, (m: RegExpMatchArray) => string, string?][] = [
      [/● Read\(([^)]+)\)/, "info", m => `Reading ${m[1]}`],
      [/● Edit\(([^)]+)\)/, "file_edit", m => `Editing ${m[1]}`],
      [/● Write\(([^)]+)\)/, "file_create", m => `Creating ${m[1]}`],
      [/● Bash\(([^)]*)\)/, "command_run", m => `Running command`, "bash"],
      [/● (Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit)\(([^)]*)\)/, "info", m => m[1]],
    ]

    let hasToolCall = false
    for (const [pattern, type, titleFn, extra] of toolPatterns) {
      const m = text.match(pattern)
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
            detail: extra === "bash" ? (m[1] || "").slice(0, 100) : (m[2] || "").slice(0, 100) || undefined,
            raw: chunk,
          })
        }
      }
    }

    // ─── Permission prompt ───
    if (/\(y\/n\/a\)/.test(text) || (/allow/i.test(text) && /\(y\/n\)/.test(text))) {
      const detail = text.replace(/[\r\n]+/g, " ").trim().slice(0, 200)
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
            { label: "Allow once", input: "y", style: "primary" },
            { label: "Always allow", input: "a", style: "primary" },
            { label: "Deny", input: "n", style: "danger" },
          ],
        },
      })
    }

    // ─── Test results ───
    if (/tests?\s+passed/i.test(text) || /\d+\s+passing/i.test(text)) {
      const passMatch = text.match(/(\d+)\s+(?:tests?\s+)?pass/i)
      const failMatch = text.match(/(\d+)\s+(?:tests?\s+)?fail/i)
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

    // ─── Thinking indicator (throttle: 3s) ───
    if (/Thinking/.test(text) && now - state.lastThinkingTime > 3000) {
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

    // ─── Claude's response text (● + text, NOT a tool call) ───
    // Check for ● followed by substantial text that isn't a tool call pattern
    const toolCallInText = /● (?:Read|Edit|Write|Bash|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit|Skill|TaskCreate|TaskUpdate)\(/.test(text)
    const responseMatch = text.match(/●\s*([^●\n\r]{5,})/)
    if (responseMatch && !toolCallInText && !hasToolCall && now - state.lastResponseTime > 2000) {
      // Extract clean response text
      const responseText = responseMatch[1]
        .replace(/[\x00-\x1f]/g, " ")
        .trim()
      if (responseText.length >= 5) {
        state.lastResponseTime = now
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "info",
          status: "completed",
          title: "Claude responded",
          detail: responseText.slice(0, 200),
          raw: chunk,
        })
      }
    } else if (/●/.test(text) && !toolCallInText && !hasToolCall && !responseMatch) {
      // ● found but not enough text after it yet — save for next chunk
      state.pending = text
    }

    // ─── Token usage (throttle: 5s) ───
    const tokenMatch = text.match(/(\d[\d,]+)\s*tokens?/i)
    if (tokenMatch && !/Thinking/.test(text) && now - state.lastTokenTime > 5000) {
      const tokens = parseInt(tokenMatch[1].replace(/,/g, ""))
      if (tokens > 100) {
        state.lastTokenTime = now
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "info",
          status: "completed",
          title: `${tokenMatch[1]} tokens used`,
          raw: chunk,
        })
      }
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const clean = stripAnsi(buffer)
    const lastLine = clean.split("\n").filter(Boolean).pop()?.trim() || ""
    return /[$%>❯]\s*$/.test(lastLine) || /^>\s*$/.test(lastLine)
  },
}
