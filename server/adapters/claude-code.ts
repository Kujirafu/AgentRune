// server/adapters/claude-code.ts
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../../shared/types.js"
import { makeEventId } from "./types.js"

/** Strip ANSI escape codes for pattern matching */
function stripAnsi(s: string): string {
  return s
    // Cursor positioning (e.g. \x1b[5;40H) → newline (preserves TUI layout)
    .replace(/\x1b\[\d+;\d+H/g, "\n")
    // Other CSI sequences (colors, clear, etc.) → remove
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
  lastMenuTime: number      // Debounce TUI menu detection
  resumeDetected: boolean   // Track if /resume was just selected
  resumeSummaryEmitted: boolean
  seenTools: Set<string>    // Dedup tool calls by signature
  seenToolsExpire: number   // Clear seen set periodically
  pendingEdit: {
    filePath: string
    lines: string[]
    startTime: number
    eventId: string
  } | null
}

function getState(ctx: ParseContext): AdapterState {
  if (!(ctx as any)._as) {
    (ctx as any)._as = {
      pending: "",
      lastThinkingTime: 0,
      lastResponseTime: 0,
      lastTokenTime: 0,
      lastMenuTime: 0,
      resumeDetected: false,
      resumeSummaryEmitted: false,
      seenTools: new Set<string>(),
      seenToolsExpire: Date.now() + 30000,
      pendingEdit: null,
    }
  }
  return (ctx as any)._as
}

function parseDiffLines(lines: string[]): { before: string; after: string } {
  const before: string[] = []
  const after: string[] = []
  for (const line of lines) {
    const m = line.match(/^\s*\d+\s*([-+ ])?\s*│(.*)$/)
    if (!m) continue
    const marker = m[1] || " "
    const content = m[2] ?? ""
    if (marker === "-") {
      before.push(content)
    } else if (marker === "+") {
      after.push(content)
    } else {
      before.push(content)
      after.push(content)
    }
  }
  return { before: before.join("\n"), after: after.join("\n") }
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

    // ─── Detect resumed session: parse restored conversation from buffer ───
    // After /resume completes, Claude Code restores the conversation history.
    // The buffer fills up with the previous session's output.
    // Detect this by looking for conversation restoration patterns in the buffer.
    if (!state.resumeSummaryEmitted) {
      const bufClean = stripAnsi(ctx.buffer)
      // Claude Code shows "Resuming session..." or the conversation appears with ● markers
      // Detect: buffer has multiple ● markers (restored conversation) and an idle prompt
      const bulletCount = (bufClean.match(/●/g) || []).length
      const hasPrompt = /[❯>$%]\s*$/.test(bufClean.split("\n").filter(Boolean).pop()?.trim() || "")
      if (bulletCount >= 3 && hasPrompt && bufClean.length > 500) {
        state.resumeSummaryEmitted = true
        // Extract conversation items from buffer
        const segments = bufClean.split(/●\s*/).filter(s => s.trim().length > 10)
        const summaryItems: string[] = []
        for (const seg of segments) {
          const firstLine = seg.split("\n")[0].trim()
            .replace(/[\x00-\x1f]/g, " ")
            .trim()
          if (firstLine.length > 5 && firstLine.length < 200) {
            // Skip tool-call signatures and noise
            if (/^(Read|Edit|Write|Bash|Glob|Grep|Agent)\(/.test(firstLine)) continue
            if (/tokens?\s*used|Thinking|whirring/i.test(firstLine)) continue
            summaryItems.push(firstLine.slice(0, 120))
          }
        }
        if (summaryItems.length > 0) {
          events.push({
            id: makeEventId(),
            timestamp: now,
            type: "session_summary",
            status: "completed",
            title: "Session resumed",
            detail: summaryItems.slice(-6).join("\n"),
            raw: chunk,
          })
        }
      }
    }
    // Reset resume state when new /resume is detected
    if (/Resume Session/.test(text)) {
      state.resumeSummaryEmitted = false
    }

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

          if (type === "file_edit" || type === "file_create") {
            // Finalize any previous pending edit first
            if (state.pendingEdit) {
              const { filePath: fp, lines, eventId: eid, startTime } = state.pendingEdit
              const d = parseDiffLines(lines)
              events.push({
                id: eid,
                timestamp: startTime,
                type: "file_edit",
                status: "completed",
                title: `Edited ${fp}`,
                diff: { filePath: fp, before: d.before, after: d.after },
                raw: chunk,
              })
              state.pendingEdit = null
            }
            // Start accumulating new edit
            const filePath = titleFn(m).replace(/^(Editing|Creating) /, "")
            state.pendingEdit = {
              filePath,
              lines: [],
              startTime: now,
              eventId: makeEventId(),
            }
          } else {
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
    }

    // Finalize pending edit on idle prompt or timeout
    if (state.pendingEdit) {
      const lastLine = text.split("\n").filter(Boolean).pop()?.trim() || ""
      const isIdle = /[$%>❯]\s*$/.test(lastLine)
      const timedOut = now - state.pendingEdit.startTime > 3000
      if (isIdle || timedOut) {
        const { filePath: fp, lines, eventId: eid, startTime } = state.pendingEdit
        const d = parseDiffLines(lines)
        events.push({
          id: eid,
          timestamp: startTime,
          type: "file_edit",
          status: "completed",
          title: `Edited ${fp}`,
          diff: { filePath: fp, before: d.before, after: d.after },
          raw: chunk,
        })
        state.pendingEdit = null
      }
    }

    // Accumulate diff lines when a pending edit is active
    if (state.pendingEdit) {
      const diffLines = clean.split("\n").filter(l => /^\s*\d+\s*[-+ ]?\s*│/.test(l))
      state.pendingEdit.lines.push(...diffLines)
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

    // ─── TUI menu detection (e.g. /resume, /model) ───
    // Use ctx.buffer (full accumulated output) since TUI renders in many small chunks
    // Debounce: only fire once per 2s to avoid spamming as the TUI redraws
    if (now - state.lastMenuTime > 1000) {
      const bufClean = stripAnsi(ctx.buffer)
      const menuHeaderMatch = bufClean.match(/Resume Session\s*\((\d+)\s+(?:of\s+\d+|total)\)/i)
      if (menuHeaderMatch) {
        state.lastMenuTime = now
        // Parse session entries using metadata as anchors (no newlines in TUI output)
        const metaRe = /(\d+\s+(?:minutes?|hours?|days?|seconds?)\s+ago)\s+[·•∙⋅]\s+(\S+)\s+[·•∙⋅]\s+(\d[\d.]*[KMGT]?B)/gi
        const metaMatches: { index: number; end: number; time: string; branch: string; size: string }[] = []
        let mm
        while ((mm = metaRe.exec(bufClean)) !== null) {
          metaMatches.push({ index: mm.index, end: mm.index + mm[0].length, time: mm[1], branch: mm[2], size: mm[3] })
        }
        const items: { label: string; index: number }[] = []
        for (let i = 0; i < metaMatches.length; i++) {
          const prevEnd = i === 0
            ? (bufClean.indexOf("Search...") >= 0 ? bufClean.indexOf("Search...") + 9 : 0)
            : metaMatches[i - 1].end
          let title = bufClean.slice(prevEnd, metaMatches[i].index).replace(/[\x00-\x1f]/g, " ").trim()
          title = title.replace(/^[❯>→\s·]+/, "").trim()
          title = title.replace(/^\d[\d.]*[KMGT]?B\s*/i, "").trim()
          if (/Resume Session|Search\.\.\.|Ctrl\+|Esc/i.test(title)) continue
          if (title.length > 3) {
            items.push({
              label: `${title.slice(0, 60)}\n${metaMatches[i].time} · ${metaMatches[i].branch} · ${metaMatches[i].size}`,
              index: items.length,
            })
          }
        }
        if (items.length > 0) {
          events.push({
            id: makeEventId(),
            timestamp: now,
            type: "decision_request",
            status: "waiting",
            title: `Resume Session (${menuHeaderMatch[1]} total)`,
            raw: chunk,
            decision: {
              options: items.slice(0, 8).map((item) => ({
                label: item.label,
                input: "\x1b[B".repeat(item.index) + "\r",
                style: "primary" as const,
              })),
            },
          })
        }
      }
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
