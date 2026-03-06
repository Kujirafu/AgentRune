// adapters/claude-code.ts
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../shared/types.js"
import { makeEventId } from "./types.js"
import { appendFileSync, readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
function dbg(msg: string) { try { appendFileSync("debug.log", `${new Date().toISOString()} ${msg}\n`) } catch {} }

/** Strip ANSI escape codes for pattern matching (cursor positioning -> newline) */
function stripAnsi(s: string): string {
  return s
    // Cursor positioning (e.g. \x1b[5;40H) -> newline (preserves TUI layout)
    .replace(/\x1b\[\d+;\d+H/g, "\n")
    // Cursor movement (e.g. \x1b[1C = forward, \x1b[1B = down) -> space
    // Without this, "Resume\x1b[1CSession" becomes "ResumeSession" instead of "Resume Session"
    .replace(/\x1b\[\d*[ABCD]/g, " ")
    // Other CSI sequences (colors, clear, etc.) -> remove
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\(B/g, "")
}

/** Strip ANSI for tool call detection -- keeps lines intact by removing cursor positioning
 *  instead of converting to newlines. This preserves "* Edit(file.tsx)" as one string. */
function stripAnsiFlat(s: string): string {
  return s
    .replace(/\x1b\[\d+;\d+H/g, "")   // cursor positioning -> remove (not newline!)
    .replace(/\x1b\[\d*[ABCD]/g, " ")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\(B/g, "")
}

/** Per-session adapter state (stored on context object) */
interface AdapterState {
  pending: string           // Text from previous chunk (for split bullet detection)
  lastThinkingTime: number
  lastResponseTime: number
  lastTokenTime: number
  lastMenuTime: number      // Debounce TUI menu detection
  resumeFirstSeen: number   // When Resume Session header was first seen (for render delay)
  resumeEmitted: boolean    // Whether we've emitted the Resume Session event for current TUI render
  resumeDetected: boolean   // Track if /resume was just selected
  resumeSummaryEmitted: boolean
  resumeBulletsFirstSeen: number  // When 3+ bullet markers first appeared (for time-based trigger)
  planConfirmEmitted: boolean  // Whether we've emitted the plan confirmation event
  responseAccum: string        // Accumulate Claude's response text across chunks
  responseAccumTime: number    // When accumulation started
  seenTools: Set<string>    // Dedup tool calls by signature
  seenToolsExpire: number   // Clear seen set periodically
  pendingEdit: {
    filePath: string
    lines: string[]
    beforeContent: string  // file content snapshot before edit
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
      resumeFirstSeen: 0,
      resumeEmitted: false,
      resumeDetected: false,
      resumeSummaryEmitted: false,
      resumeBulletsFirstSeen: 0,
      planConfirmEmitted: false,
      responseAccum: "",
      responseAccumTime: 0,
      seenTools: new Set<string>(),
      seenToolsExpire: Date.now() + 30000,
      pendingEdit: null,
      lastCompactTime: 0,
    }
  }
  return (ctx as any)._as
}

/** Safely read a file's content (for diff before/after snapshots) */
function readFileSafe(filePath: string, projectCwd?: string): string {
  try {
    const resolved = isAbsolute(filePath) ? filePath : join(projectCwd || ".", filePath)
    return readFileSync(resolved, "utf-8")
  } catch { return "" }
}

/** Clean file path from ANSI cursor artifacts (newlines, extra spaces) */
function cleanFilePath(raw: string): string {
  return raw.replace(/[\r\n]+/g, "").replace(/\s{2,}/g, " ").trim()
}

function parseDiffLines(lines: string[]): { before: string; after: string } {
  const before: string[] = []
  const after: string[] = []
  for (const line of lines) {
    const m = line.match(/^\s*\d+\s*([-+ ])?\s*\u2502(.*)$/)
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

    // --- Smart TUI detection ---
    // Claude Code's status bar uses cursor positioning (\x1b[row;colH) to render.
    // Normal response text is line-by-line output without cursor positioning.
    // If a chunk has heavy cursor positioning, it's TUI/status bar content.
    const cursorPosCount = (chunk.match(/\x1b\[\d+;\d+H/g) || []).length
    const isTuiChunk = cursorPosCount >= 5  // 5+ cursor positions = TUI rendering

    // Expire seen tools every 30s to prevent unbounded growth
    if (now > state.seenToolsExpire) {
      state.seenTools.clear()
      state.seenToolsExpire = now + 30000
    }

    // Strip ANSI, combine with pending text from previous chunk
    const clean = stripAnsi(chunk)
    const text = state.pending + clean
    state.pending = ""

    // Flat version for tool call detection (keeps bullet Edit(file) on one line)
    const flatClean = stripAnsiFlat(chunk)

    // --- Detect resumed session: parse restored conversation from buffer ---
    // Session summary after /resume is now handled by project-level event persistence
    // (server/index.ts loadProjectEvents) -- previous session's events are replayed automatically.
    // Reset resume state when new /resume is detected
    if (/Resume Session/.test(text)) {
      state.resumeSummaryEmitted = false
      state.resumeBulletsFirstSeen = 0
    }

    // --- Tool calls (checked independently, not exclusive) ---
    const toolPatterns: [RegExp, string, (m: RegExpMatchArray) => string, string?][] = [
      [/\u25cf Read\(([^)]+)\)/, "info", m => `Reading ${m[1]}`],
      [/\u25cf Edit\(([^)]+)\)/, "file_edit", m => `Editing ${m[1]}`],
      [/\u25cf Write\(([^)]+)\)/, "file_create", m => `Creating ${m[1]}`],
      [/\u25cf Bash\(([^)]*)\)/, "command_run", m => `Running command`, "bash"],
      [/\u25cf (Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit)\(([^)]*)\)/, "info", m => m[1]],
    ]

    let hasToolCall = false
    for (const [pattern, type, titleFn, extra] of toolPatterns) {
      const m = flatClean.match(pattern)
      if (m) {
        hasToolCall = true
        const sig = `${m[0].slice(0, 60)}`
        if (!state.seenTools.has(sig)) {
          state.seenTools.add(sig)

          if (type === "file_edit" || type === "file_create") {
            dbg(`[TOOL-MATCH] type=${type} m[0]="${m[0].slice(0,80)}" m[1]="${m[1]?.slice(0,80)}" m[2]="${m[2]?.slice(0,80)}"`)
            dbg(`[TOOL-MATCH] text around match: "${text.slice(Math.max(0, (m.index||0)-20), (m.index||0)+100)}"`)
            // Finalize any previous pending edit first
            if (state.pendingEdit) {
              const { filePath: fp, beforeContent, eventId: eid, startTime } = state.pendingEdit
              const afterContent = readFileSafe(fp, ctx.projectCwd)
              events.push({
                id: eid,
                timestamp: startTime,
                type: "file_edit",
                status: "completed",
                title: `Edited ${fp}`,
                diff: { filePath: fp, before: beforeContent, after: afterContent },
                raw: chunk,
              })
              state.pendingEdit = null
            }
            // Start accumulating new edit -- read file content BEFORE the edit
            const rawPath = titleFn(m).replace(/^(Editing|Creating) /, "")
            const filePath = cleanFilePath(rawPath)
            // Validate: must look like a real file path (contains / or \ or .)
            // Skip false positives like "path" or "filepath" from response text
            if (!filePath || (!filePath.includes("/") && !filePath.includes("\\") && !filePath.includes("."))) {
              dbg(`[TOOL-SKIP] Skipping fake Edit, filePath="${filePath}" doesn't look like a real path`)
              continue
            }
            const beforeContent = readFileSafe(filePath, ctx.projectCwd)
            state.pendingEdit = {
              filePath,
              lines: [],
              beforeContent,
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
      const isIdle = /[$%>\u276f]\s*$/.test(lastLine)
      const timedOut = now - state.pendingEdit.startTime > 3000
      if (isIdle || timedOut) {
        const { filePath: fp, beforeContent, eventId: eid, startTime } = state.pendingEdit
        const afterContent = readFileSafe(fp, ctx.projectCwd)
        events.push({
          id: eid,
          timestamp: startTime,
          type: "file_edit",
          status: "completed",
          title: `Edited ${fp}`,
          diff: { filePath: fp, before: beforeContent, after: afterContent },
          raw: chunk,
        })
        state.pendingEdit = null
      }
    }

    // Accumulate diff lines when a pending edit is active
    if (state.pendingEdit) {
      const diffLines = clean.split("\n").filter(l => /^\s*\d+\s*[-+ ]?\s*\u2502/.test(l))
      state.pendingEdit.lines.push(...diffLines)
    }

    // --- Permission prompt ---
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

    // --- Plan confirmation detection ---
    // Claude Code shows "Would you like to proceed?" with numbered options when a plan is ready
    {
      const bufClean = stripAnsi(ctx.buffer)
      const hasPlanConfirm = /written\s+(?:up\s+)?a\s+plan|Would\s+you\s+like\s+to\s+proceed/i.test(bufClean)
      if (hasPlanConfirm && !state.planConfirmEmitted) {
        state.planConfirmEmitted = true

        // Extract plan content from buffer -- look for Claude's response text
        // Plan text is typically between the last bullet marker and the confirmation prompt
        const confirmIdx = bufClean.search(/(?:written\s+(?:up\s+)?a\s+plan|Claude\s+has\s+written)/i)
        const beforeConfirm = confirmIdx > 0 ? bufClean.slice(0, confirmIdx) : ""

        // Find the last substantial response (after tool calls settle)
        // Look backwards for content after the last tool call marker
        const lastBulletIdx = beforeConfirm.lastIndexOf("\u25cf")
        const planStart = lastBulletIdx >= 0 ? lastBulletIdx + 1 : Math.max(0, beforeConfirm.length - 3000)
        let planContent = beforeConfirm.slice(planStart)
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ")
          .trim()
        // Clean up tool call noise from plan content
        planContent = planContent
          .replace(/^(?:Read|Edit|Write|Bash|Glob|Grep|Agent)\([^)]*\)\s*/gm, "")
          .replace(/^\s*(?:Read|Found)\s+\d+\s+lines?\s*$/gm, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim()

        // Emit plan content as a rich event with full markdown
        if (planContent.length > 50) {
          events.push({
            id: makeEventId(),
            timestamp: now,
            type: "info",
            status: "completed",
            title: "Plan ready",
            detail: planContent.slice(0, 5000),
            raw: chunk,
          })
        }

        // Emit decision request for plan confirmation
        // Shift+Tab (\x1b[Z) cycles through options, Enter selects
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: "decision_request",
          status: "waiting",
          title: "Execute plan?",
          detail: "Claude has written up a plan and is ready to execute.",
          raw: chunk,
          decision: {
            options: [
              { label: "Yes, clear context & auto-accept edits", input: "\r", style: "primary" },
              { label: "Yes, auto-accept edits", input: "\x1b[Z\r", style: "primary" },
              { label: "Yes, manually approve edits", input: "\x1b[Z\x1b[Z\r", style: "default" },
              { label: "Edit plan", input: "\x1b[Z\x1b[Z\x1b[Z\r", style: "default" },
            ],
          },
        })
      } else if (!hasPlanConfirm && state.planConfirmEmitted) {
        // Plan confirmation is gone (user chose an option), reset state
        state.planConfirmEmitted = false
      }
    }

    // --- Test results ---
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

    // --- Thinking indicator (throttle: 3s) ---
    // Only emit for non-TUI chunks with clean "Thinking" pattern
    if (!isTuiChunk && /[\u2726\u2731\u2217\u2234*]\s*Thinking/i.test(text) && now - state.lastThinkingTime > 3000) {
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

    // --- Context compaction (Coalescing) indicator (throttle: 30s) ---
    if (/Coalescing|compacting|auto-compac/i.test(text) && now - (state as any).lastCompactTime > 30000) {
      (state as any).lastCompactTime = now
      events.push({
        id: makeEventId(),
        timestamp: now,
        type: "info",
        status: "in_progress",
        title: "Compacting context -- please wait...",
        detail: "Claude Code is compressing conversation history. This may take 1-3 minutes.",
        raw: chunk,
      })
    }

    // --- Claude's response text (bullet + text, NOT a tool call) ---
    // Skip TUI chunks entirely -- they are status bar renders, not actual response text
    // Use flatClean for tool detection to avoid cursor-positioning breaking patterns
    const toolCallInText = /\u25cf (?:Read|Edit|Write|Bash|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit|Skill|TaskCreate|TaskUpdate)\(/.test(flatClean)
    const hasResponseMarker = !isTuiChunk && /\u25cf/.test(text) && !toolCallInText && !hasToolCall

    if (hasResponseMarker) {
      // Extract all text after bullet that isn't a tool call
      // Split on bullet and take the non-tool segments
      const lines = text.split("\n")
      const responseLines: string[] = []
      let capturing = false
      for (const line of lines) {
        const trimLine = line.trim()
        if (!trimLine) continue
        // Skip noise lines (strip ANSI before checking -- tree chars may be wrapped in color codes)
        const cleanLine = trimLine.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").trim()
        if (/(?:Thinking|Whirring|Tinkering|Cogitating|Infusing|Brewing|Sketching|Lollygagging|Frolicking|Schlepping|Pondering|Musing|Grooving|Brewed|Thought|Philosophising|Philosophizing)/i.test(cleanLine) && /[*\u2731\u2217\u2234\u2726]/.test(cleanLine)) continue
        // Repeated animation verbs (status bar render artifacts)
        if (/(?:Thinking|Philosophising|Philosophizing|Pondering|Musing|Brewing|Whirring)/i.test(cleanLine) && (cleanLine.match(/(?:Thinking|Philosophising|Philosophizing|Pondering|Musing|Brewing|Whirring)/gi) || []).length >= 2) continue
        if (/^\(\d+\.?\d*s\s*[\u00b7\u2022]/.test(cleanLine)) continue
        if (/^[\u23bf\u251c\u2514\u2502\u250c\u2510\u2518\u2524\u252c\u2534\u253c\u256d\u256e\u2570\u256f]/.test(cleanLine)) continue
        if (/^[$%>\u276f]\s*$/.test(cleanLine)) continue
        // Status bar settings/info lines
        if (/bypass\s+permissions|shift\+tab|auto-compact|Context\s+left|current:\s*\d|latest:\s*\d|permissions\s+on\s*\(/i.test(cleanLine)) continue
        if (/esc\s*\u2026|plan\s+mode/i.test(cleanLine)) continue
        // Garbled status bar: multiple star/diamond symbols = animation frames
        if ((cleanLine.match(/[\u2726\u2731\u2217\u2234]/g) || []).length >= 2) continue
        // Short garbled fragments (ANSI cursor artifacts)
        if (cleanLine.length < 20 && /\d\s+[\u2726\u2731\u2217\u2234]\s+\d/.test(cleanLine)) continue
        // Garbled cursor-positioning artifacts: "thinking" mixed with random chars/digits
        if (/thinking/i.test(cleanLine) && (cleanLine.match(/thinking/gi) || []).length >= 3) continue

        if (/\u25cf\s*(?!Read|Write|Edit|Bash|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit|Skill|TaskCreate|TaskUpdate)\S/.test(trimLine)) {
          // bullet + non-tool text: start capturing
          capturing = true
          responseLines.push(trimLine.replace(/^\u25cf\s*/, ""))
        } else if (capturing && !/\u25cf/.test(trimLine)) {
          // Continuation line -- but stop if it looks like noise
          if (/[\u2726\u2731\u2217\u2234]/.test(trimLine) || /\d+\s*tokens/i.test(cleanLine)) {
            capturing = false
            continue
          }
          responseLines.push(trimLine)
        }
      }

      const responseText = responseLines.join("\n").replace(/[\x00-\x1f]/g, " ").trim()
      if (responseText.length >= 5) {
        if (now - state.responseAccumTime > 15000) {
          // New response block -- flush old if exists
          if (state.responseAccum.length > 10 && now - state.lastResponseTime > 2000) {
            state.lastResponseTime = now
            events.push({
              id: makeEventId(),
              timestamp: state.responseAccumTime,
              type: "info",
              status: "completed",
              title: state.responseAccum.length > 300 ? "Claude responded (detailed)" : "Claude responded",
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
    } else if (!isTuiChunk && /\u25cf/.test(text) && !toolCallInText && !hasToolCall) {
      // bullet found but no usable text yet -- save for next chunk
      state.pending = text
    } else if (!isTuiChunk && state.responseAccum.length > 0 && !hasToolCall && !toolCallInText) {
      // Continuation chunk -- no bullet but active response accumulation in progress
      // Append non-noise text to the ongoing response
      const contLines: string[] = []
      for (const line of text.split("\n")) {
        const tl = line.trim()
        const cl = tl.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").trim()
        if (!cl || cl.length <= 2) continue
        if (/[*\u2731\u2217\u2234\u2726]\s*\d*\s*(?:Thinking|Whirring|Tinkering|Cogitating|Infusing|Brewing|Sketching|Lollygagging|Frolicking|Schlepping|Pondering|Musing|Grooving|Brewed|Thought|Philosophising|Philosophizing)/i.test(cl)) continue
        if (/(?:Thinking|Philosophising|Philosophizing|Pondering|Musing|Brewing|Whirring)/i.test(cl) && (cl.match(/(?:Thinking|Philosophising|Philosophizing|Pondering|Musing|Brewing|Whirring)/gi) || []).length >= 2) continue
        if (/^\(\d+\.?\d*s\s*[\u00b7\u2022]/.test(cl)) continue
        if (/^[\u23bf\u251c\u2514\u2502\u250c\u2510\u2518\u2524\u252c\u2534\u253c\u256d\u256e\u2570\u256f]/.test(cl)) continue
        if (/^[$%>\u276f]\s*$/.test(cl)) continue
        if (/^PS\s+[A-Z]:/i.test(tl)) continue
        if (/^[A-Z]:\\[^\u25cf]*>/i.test(tl)) continue
        if (/bypass\s+permissions|shift\+tab|auto-compact|Context\s+left|current:\s*\d|latest:\s*\d|permissions\s+on\s*\(|esc\s*\u2026|plan\s+mode/i.test(cl)) continue
        if ((cl.match(/[\u2726\u2731\u2217\u2234]/g) || []).length >= 2) continue
        if (/\d+\s*tokens/i.test(cl)) continue
        if (/\u25cf/.test(tl)) continue // New bullet marker -- don't mix in
        contLines.push(tl)
      }
      if (contLines.length > 0) {
        state.responseAccum += "\n" + contLines.join("\n")
      }
    }

    // Flush accumulated response on tool call or idle (response ended)
    if (state.responseAccum.length > 10 && (hasToolCall || ctx.isIdle) && now - state.lastResponseTime > 2000) {
      state.lastResponseTime = now
      events.push({
        id: makeEventId(),
        timestamp: state.responseAccumTime,
        type: "info",
        status: "completed",
        title: state.responseAccum.length > 300 ? "Claude responded (detailed)" : "Claude responded",
        detail: state.responseAccum.slice(0, 3000),
        raw: chunk,
      })
      state.responseAccum = ""
      state.responseAccumTime = 0
    }

    // --- TUI menu detection (e.g. /resume) ---
    // TUI uses cursor positioning -- use stripAnsiFlat for cleaner text extraction.
    // Parse visible sessions from buffer + always append navigation buttons.
    {
      const rawBuf = ctx.buffer
      const bufFlat = stripAnsiFlat(rawBuf)
      const bufClean = stripAnsi(rawBuf)
      const hasHeader = /Resume\s+Session\s*\((\d+)\s+(?:of\s+(\d+)|total)\)/i.test(bufClean)

      if (hasHeader) {
        state.resumeFirstSeen = state.resumeFirstSeen || now
        const isTimerFeed = chunk === ""
        const hasAutoScroll = (ctx.resumeCursorOffset || 0) > 0
        const isStale = !hasAutoScroll && now - state.resumeFirstSeen >= 4500
        // When auto-scroll is active, only emit on timer re-feed (after scroll completes)
        if ((isTimerFeed || isStale) && !state.resumeEmitted) {
          const allHeaderMatches = [...bufClean.matchAll(/Resume\s+Session\s*\((\d+)\s+(?:of\s+(\d+)|total)\)/gi)]
          const menuHeaderMatch = allHeaderMatches[allHeaderMatches.length - 1]
          const totalCount = menuHeaderMatch[2] || menuHeaderMatch[1]

          // Try to parse session entries from the flat-stripped buffer
          const headerEnd = (menuHeaderMatch.index || 0) + menuHeaderMatch[0].length
          // Use both flat and newline-stripped versions for different parts
          const searchBuf = bufFlat.slice(headerEnd)

          // Match metadata: "5 minutes ago . main . 1.2KB" or "in 5 sec. . main . 1KB"
          const metaRe = /(?:(\d+\s*(?:minutes?|hours?|days?|seconds?|min\.?|sec\.?|hrs?\.?)\s*ago)|(?:in\s*(\d+)\s*(?:minutes?|hours?|days?|seconds?|min\.?|sec\.?|hrs?\.?)))\s*[\u00b7\u2022\u2219\u22c5]\s*(\S+)\s*[\u00b7\u2022\u2219\u22c5]\s*(\d[\d.]*[KMGT]?B)/gi
          const metaMatches: { index: number; end: number; time: string; branch: string; size: string }[] = []
          let mm
          while ((mm = metaRe.exec(searchBuf)) !== null) {
            const time = mm[1] || `in ${mm[2]} sec.`
            metaMatches.push({ index: mm.index, end: mm.index + mm[0].length, time, branch: mm[3], size: mm[4] })
          }

          const items: { label: string; index: number }[] = []
          if (metaMatches.length > 0) {
            for (let i = 0; i < metaMatches.length; i++) {
              const prevEnd = i === 0 ? 0 : metaMatches[i - 1].end
              let title = searchBuf.slice(prevEnd, metaMatches[i].index).replace(/[\x00-\x1f]/g, " ").trim()
              title = title.replace(/[\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c\u256d\u256e\u2570\u256f\u2574\u2575\u2576\u2577\u2501\u2503\u250f\u2513\u2517\u251b\u2523\u252b\u2533\u253b\u254b\u2580\u2584\u2588\u258c\u2590\u2591\u2592\u2593\u25a0\u25a1\u25aa\u25ab\u25cf\u25cb\u25c6\u25c7\u25c8\u25b2\u25b3\u25b6\u25b7\u25c0\u25c1\u2217\u2726\u2731\u2234\u276f\u2192\u2190\u2191\u2193\u2194\u2195\u23ce\u23af]/g, " ")
              title = title.replace(/(\s+\d\s+)+/g, " ")
              title = title.replace(/^[\s\d\u00b7>]+/, "").trim()
              title = title.replace(/^\d[\d.]*[KMGT]?B\s*/i, "").trim()
              if (/Resume\s+Session|Search[\.\u2026]|\u2315|Ctrl\+|Esc|enter to|navigate|PowerShell|Copyright|\u8457\u4f5c\u6b0a|Microsoft|\u4fdd\u7559\u64c1\u6709|\u5b89\u88dd\u6700\u65b0/i.test(title)) title = ""
              title = title.replace(/\/?remote[- ]?control\s*(is\s+)?active\.?\s*(Code\s+in\s+CLI\s+or\s+at\s+)?/gi, "").trim()
              title = title.replace(/https?:\/\/\S+/g, "").trim()
              if (!title || title.length <= 3) title = ""
              const meta = `${metaMatches[i].time} \u00b7 ${metaMatches[i].branch} \u00b7 ${metaMatches[i].size}`
              const label = title ? `${title.slice(0, 60)}\n${meta}` : meta
              items.push({ label, index: items.length })
            }
          }

          dbg(`[RESUME-DEBUG] EMIT items=${items.length}, buffer=${rawBuf.length}, trigger=${isTimerFeed ? "timer" : "stale"}, labels=${JSON.stringify(items.map(i => i.label.slice(0, 50)))}`)
          state.resumeEmitted = true

          // Build options: parsed sessions (click = arrow keys relative to cursor + Enter)
          // Server auto-scroll moves cursor to `resumeCursorOffset` position.
          // Each item.index is its position in the parsed list (0-based from top of buffer).
          // We need to move from current cursor position to item's position.
          const cursorPos = ctx.resumeCursorOffset || 0
          dbg(`[RESUME-DEBUG] cursorPos=${cursorPos}, items=${items.map(i => i.index)}`)
          const sessionOptions = items.slice(0, 8).map((item) => {
            const moves = item.index - cursorPos
            let keys = ""
            if (moves > 0) keys = "\x1b[B".repeat(moves)
            else if (moves < 0) keys = "\x1b[A".repeat(-moves)
            return {
              label: item.label,
              input: keys + "\r",
              style: "primary" as const,
            }
          })
          if (sessionOptions.length > 0) {
            events.push({
              id: makeEventId(),
              timestamp: now,
              type: "decision_request",
              status: "waiting",
              title: `Resume Session (${totalCount} total)`,
              decision: { options: sessionOptions },
            })
          }
        }
      } else if (state.resumeFirstSeen > 0) {
        state.resumeFirstSeen = 0
        state.resumeEmitted = false
      }
    }

    // --- Token usage (throttle: 5s) ---
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
    return /[$%>\u276f]\s*$/.test(lastLine) || /^>\s*$/.test(lastLine)
  },
}
