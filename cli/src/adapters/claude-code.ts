// adapters/claude-code.ts
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../shared/types.js"
import { makeEventId } from "./types.js"
import { readFileSync } from "node:fs"
import { appendFile } from "node:fs/promises"
import { join, isAbsolute } from "node:path"
import { homedir } from "node:os"
const DBG_ENABLED = process.env.AGENTRUNE_DEBUG === "1"
const DBG_PATH = join(homedir(), ".agentrune", "debug.log")
function dbg(msg: string) { if (!DBG_ENABLED) return; appendFile(DBG_PATH, `${new Date().toISOString()} ${msg}\n`).catch(() => {}) }

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

/**
 * Detect if accumulated response text contains user-facing options (A/B/C or numbered).
 * Returns parsed options array or null if no options found.
 */
function detectOptions(text: string): { label: string; input: string; style: "primary" | "default" }[] | null {
  // Match lettered options: "A." "A:" "A、" "A )" or "**A.**" etc.
  const letterRe = /(?:^|\n)\s*\*{0,2}([A-Z])[.:\u3001)]\*{0,2}\s*(.+)/g
  const letterMatches: { key: string; label: string }[] = []
  let m: RegExpExecArray | null
  while ((m = letterRe.exec(text)) !== null) {
    const label = m[2].replace(/\*{1,2}/g, "").trim()
    if (label.length >= 2) letterMatches.push({ key: m[1], label })
  }
  if (letterMatches.length >= 2 && letterMatches.length <= 8) {
    return letterMatches.map((o, i) => ({
      label: `${o.key}. ${o.label.slice(0, 100)}`,
      input: o.key,
      style: i === 0 ? "primary" as const : "default" as const,
    }))
  }

  // Match numbered options: "1." "1:" "1)" etc.
  const numRe = /(?:^|\n)\s*\*{0,2}(\d+)[.:)]\*{0,2}\s*(.+)/g
  const numMatches: { key: string; label: string }[] = []
  while ((m = numRe.exec(text)) !== null) {
    const label = m[2].replace(/\*{1,2}/g, "").trim()
    if (label.length >= 2) numMatches.push({ key: m[1], label })
  }
  // Only treat as options if there are 2-8 numbered items AND text contains a real question
  // (not just stray "?" in URLs, filenames, or Unicode substitution characters)
  const hasRealQuestion = /(?:^|[\n.!])\s*[^\n]*[?\uff1f]\s*$/m.test(text) || /choose|select|which.*(?:option|would|do)|pick|\u9078|\u54ea\u500b/i.test(text)
  if (numMatches.length >= 2 && numMatches.length <= 8 && hasRealQuestion) {
    return numMatches.map((o, i) => ({
      label: `${o.key}. ${o.label.slice(0, 100)}`,
      input: o.key,
      style: i === 0 ? "primary" as const : "default" as const,
    }))
  }

  return null
}

/**
 * Flush responseAccum into an AgentEvent (decision_request or info).
 * When TUI interactive menu detected ("Enter to select"), overrides input
 * to use arrow-key navigation and adds footer options.
 */
function flushResponseAccum(state: AdapterState, ctx: ParseContext, chunk: string): AgentEvent | null {
  dbg(`[FLUSH] accumLen=${state.responseAccum.length} accum="${state.responseAccum.slice(0,120).replace(/\n/g, "\\n")}"`)
  const opts = detectOptions(state.responseAccum)
  dbg(`[FLUSH] opts=${opts ? opts.length : "null"}`)
  let event: AgentEvent

  if (opts) {
    // Check if this is a TUI interactive menu (arrow-key navigation)
    // Only consider it a TUI menu if the marker appeared recently (< 5s) — old buffer content doesn't count
    const bufCheck = stripAnsi(ctx.buffer.slice(-2000))
    const hasTuiMarker = /Enter to select|to navigate.*Esc/i.test(bufCheck)
    const isTuiMenu = hasTuiMarker && (Date.now() - state.lastMenuTime < 5000)

    if (isTuiMenu) {
      // Override input: TUI uses arrow down + Enter, not number keys
      for (let i = 0; i < opts.length; i++) {
        opts[i].input = "\x1b[B".repeat(i) + "\r"
      }
      // Add TUI footer options that appear below numbered items
      const footerCandidates = [
        "Type something",
        "Chat about this",
        "Skip interview and plan immediately",
        "Skip and use defaults",
      ]
      let footerIdx = opts.length
      for (const label of footerCandidates) {
        // Check if buffer contains first 2+ words of the label
        const words = label.split(" ").slice(0, 2).join(" ")
        if (bufCheck.includes(words)) {
          opts.push({ label, input: "\x1b[B".repeat(footerIdx) + "\r", style: "default" as const })
          footerIdx++
        }
      }
      // Only TUI menus become decision_request — conversational A/B/C options stay as info
      event = {
        id: makeEventId(),
        timestamp: state.responseAccumTime,
        type: "decision_request",
        status: "waiting",
        title: state.responseAccum.split("\n")[0].slice(0, 200),
        detail: state.responseAccum,
        raw: chunk,
        decision: { options: opts },
      }
    } else {
      // Conversational options (agent asking a question) — show as info, not interactive menu
      event = {
        id: makeEventId(),
        timestamp: state.responseAccumTime,
        type: "info",
        status: "completed",
        title: state.responseAccum.split("\n")[0].slice(0, 200),
        detail: state.responseAccum,
        raw: chunk,
      }
    }
  } else {
    event = {
      id: makeEventId(),
      timestamp: state.responseAccumTime,
      type: "info",
      status: "completed",
      title: state.responseAccum.length > 300 ? "Claude responded (detailed)" : "Claude responded",
      detail: state.responseAccum,
      raw: chunk,
    }
  }

  state.responseAccum = ""
  state.responseAccumTime = 0
  return event
}

/** Per-session adapter state (stored on context object) */
interface AdapterState {
  pending: string           // Text from previous chunk (for split bullet detection)
  recentWindow: string      // Sliding window of recent clean text (for permission detection)
  lastPermHash: string      // Hash of last emitted permission options (prevent re-fire on TUI repaints)
  lastThinkingTime: number
  lastResponseTime: number
  lastTokenTime: number
  lastMenuTime: number      // Debounce TUI menu detection
  resumeFirstSeen: number   // When Resume Session header was first seen (for render delay)
  resumeEmitted: boolean    // Whether we've emitted the Resume Session event for current TUI render
  resumeDetected: boolean   // Track if /resume was just selected
  resumeInProgress: boolean // Suppress events during TUI rendering
  resumeDecisionTime: number // When resume decision was last emitted
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
      recentWindow: "",
      lastPermHash: "",
      lastThinkingTime: 0,
      lastResponseTime: 0,
      lastTokenTime: 0,
      lastMenuTime: 0,
      resumeFirstSeen: 0,
      resumeEmitted: false,
      resumeDetected: false,
      resumeInProgress: false,
      resumeDecisionTime: 0,
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
    // Heartbeat: log every 50th call to confirm parse() is being invoked
    if (!((ctx as any)._parseCount)) (ctx as any)._parseCount = 0
    ;(ctx as any)._parseCount++
    if ((ctx as any)._parseCount % 50 === 1) dbg(`[PARSE-HEARTBEAT] call #${(ctx as any)._parseCount} chunkLen=${chunk.length}`)

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
    if (/\/resume\b/.test(text)) {
      state.resumeSummaryEmitted = false
      state.resumeBulletsFirstSeen = 0
      state.resumeInProgress = true
      // Flush any accumulated response to prevent garbage leaking
      state.responseAccum = ""
      state.responseAccumTime = 0
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
        // Tool call detected = agent moved on, clear permission detection window
        state.recentWindow = ""
        if (state.resumeInProgress) {
          state.resumeInProgress = false
          state.resumeFirstSeen = 0
          state.resumeEmitted = false
          state.resumeDecisionTime = 0
          state.responseAccum = ""
          state.responseAccumTime = 0
        }
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
            // Filter out diagnostic/noise Bash commands
            if (extra === "bash") {
              const cmd = (m[1] || "").trim()
              // Skip inline evaluations, system commands, script runs
              if (/^(node\s+-e|cat\b|ls\b|head\b|tail\b|echo\b|wc\b|stat\b|file\b|which\b|type\b|pwd\b|cd\b|netstat\b|taskkill\b|tasklist\b|findstr\b)/i.test(cmd)) continue
              if (/^node\s+[^\s]+\.(mjs|js|ts)\b/i.test(cmd)) continue
            }
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

    // --- Interactive menu detection (agent-agnostic, robust) ---
    // Detects TWO kinds of menus from buffer tail:
    // 1. Permission prompts: "requires approval" / "Do you want to proceed" / "(y/n/a)"
    // 2. Agent questions: numbered options + question mark or "Enter to select" hint
    //
    // TUI cursor positioning corrupts text, so we DON'T parse option labels for permissions.
    // For agent questions, we attempt to parse labels from buffer lines.
    // Dedup: hash on detail context, cleared on tool call (user answered)
    {
      const bufTail = stripAnsi(ctx.buffer.slice(-2000))
      const hasPermission = /requires?\s+approval|Do you want to proceed|allow.*permission/i.test(bufTail)
      const hasLegacy = /\(y\/n\/a\)/i.test(text)
      const hasInteractiveMenu = /Enter to select|to navigate.*Esc/i.test(bufTail)
      // Update lastMenuTime when TUI markers are actively present
      if (hasInteractiveMenu) state.lastMenuTime = Date.now()

      // Count numbered items in buffer tail
      const numMatches = [...bufTail.matchAll(/(?:^|\n)\s*(?:\u276f\s*)?(\d+)\.\s/gm)]
      const maxNum = numMatches.reduce((max, m) => Math.max(max, parseInt(m[1])), 0)

      const isPermission = hasPermission || hasLegacy

      // Only detect permission prompts here.
      // Generic numbered menus are handled by responseAccum + detectOptions (better labels).
      if (isPermission) {
        const title = "Permission requested"
        const options: { label: string; input: string; style: "primary" | "danger" | "default" }[] = []
        // Try multiple patterns to extract what the agent wants to do
        const detailMatch = bufTail.match(/(?:Bash|Edit|Write|Read|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit)\s*\([^\n]{1,150}/i)
          || bufTail.match(/(?:Bash\s+(?:command)?|execute|create|delete|modify|Tool\s+call)[:\s][^\n]{3,150}/i)
          || bufTail.match(/(?:requires?\s+(?:manual\s+)?approval)[^\n]{0,150}/i)
        // Also try flat version (no cursor->newline conversion) for tool signatures
        const flatBufTail = stripAnsiFlat(ctx.buffer.slice(-2000))
        const flatMatch = !detailMatch ? flatBufTail.match(/(?:Bash|Edit|Write|Read)\s*\([^\n)]{1,150}\)/i) : null
        const rawDetail = detailMatch?.[0] || flatMatch?.[0]
        const detail = rawDetail
          ? rawDetail.replace(/\s+/g, " ").trim().slice(0, 200)
          : "Agent is requesting permission"
        dbg(`[PERM-DETAIL] detail="${detail.slice(0,80)}" bufTail(last200)="${bufTail.slice(-200).replace(/\n/g, "\\n")}"`)

        // Auto-generate purpose/scope from tool call (adapter-only, i18n via ctx.locale)
        const zh = !ctx.locale || ctx.locale.startsWith("zh")
        const d = (detail || "").toLowerCase()
        const toolMatch = (detail || "").match(/^(Bash|Edit|Write|Read|Glob|Grep|Agent)\s*[\s(]/i)
        const tool = toolMatch?.[1]?.toLowerCase() || ""
        let purpose: string
        if (tool === "bash" || /bash\s+command/i.test(detail || "")) {
          if (/\b(head|cat|tail|less)\b/.test(d)) purpose = zh ? "查看檔案內容" : "View file contents"
          else if (/\b(find|ls|dir)\b/.test(d)) purpose = zh ? "搜尋或列出檔案" : "Search or list files"
          else if (/\bgrep\b/.test(d)) purpose = zh ? "搜尋文字內容" : "Search text content"
          else if (/\bnpm\b/.test(d)) purpose = zh ? "執行 npm 指令" : "Run npm command"
          else if (/\bgit\b/.test(d)) purpose = zh ? "執行 git 操作" : "Run git operation"
          else if (/\brm\b/.test(d)) purpose = zh ? "刪除檔案" : "Delete files"
          else if (/\bmkdir\b/.test(d)) purpose = zh ? "建立目錄" : "Create directory"
          else if (/\b(node|npx|tsx|python)\b/.test(d)) purpose = zh ? "執行程式" : "Run program"
          else if (/\b(curl|wget|fetch)\b/.test(d)) purpose = zh ? "發送網路請求" : "Send network request"
          else purpose = zh ? "執行 shell 指令" : "Run shell command"
        } else if (tool === "read") purpose = zh ? "讀取檔案" : "Read file"
        else if (tool === "edit") purpose = zh ? "修改檔案" : "Modify file"
        else if (tool === "write") purpose = zh ? "建立或覆寫檔案" : "Create/overwrite file"
        else if (tool === "glob") purpose = zh ? "搜尋檔案" : "Search files"
        else if (tool === "grep") purpose = zh ? "搜尋文字內容" : "Search text"
        else if (tool === "agent") purpose = zh ? "啟動子任務" : "Launch subtask"
        else purpose = zh ? "需要你的許可才能繼續" : "Needs your permission to continue"
        // Impact scope: risk + functional area
        const pathStr = (detail || "").replace(/\\/g, "/")
        const isReadOnly = /\b(head|cat|tail|less|read|glob|grep|find|ls|dir|wc)\b/.test(d)
        const isDelete = /\brm\b/.test(d)
        const isInstall = /\b(npm|yarn|pip|apt)\s+(install|add|update|upgrade)\b/.test(d)
        const isGitPush = /\bgit\s+(push|reset|rebase|force)\b/.test(d)
        let area = ""
        if (/app\/src\/components|\.tsx/.test(pathStr)) area = zh ? "前端 UI" : "Frontend UI"
        else if (/app\/src\/lib|app\/src\/hooks/.test(pathStr)) area = zh ? "前端邏輯" : "Frontend logic"
        else if (/cli\/src\/server/.test(pathStr)) area = zh ? "後端 Server" : "Backend server"
        else if (/cli\/src\/adapters/.test(pathStr)) area = zh ? "Agent 連接層" : "Agent adapter layer"
        else if (/desktop\//.test(pathStr)) area = zh ? "桌面版" : "Desktop app"
        else if (/\.test\.|\.spec\./.test(pathStr)) area = zh ? "測試" : "Tests"
        else if (/package\.json|package-lock/.test(pathStr)) area = zh ? "專案依賴" : "Project dependencies"
        else if (/\.config|tsconfig|vite\.config/.test(pathStr)) area = zh ? "建置設定" : "Build config"
        else if (/\.md$/.test(pathStr)) area = zh ? "文件" : "Documentation"
        let scope: string
        if (isReadOnly) scope = zh ? "唯讀，無風險" : "Read-only, no risk"
        else if (isDelete) scope = area ? (zh ? `高風險 — 刪除${area}相關檔案` : `High risk — deleting ${area} files`) : (zh ? "高風險 — 刪除操作" : "High risk — delete operation")
        else if (isGitPush) scope = zh ? "高風險 — 影響 git 歷史" : "High risk — affects git history"
        else if (isInstall) scope = zh ? "中風險 — 修改依賴，可能影響所有功能" : "Medium risk — modifies dependencies"
        else if (tool === "edit" || tool === "write") scope = area ? (zh ? `會修改${area}` : `Modifies ${area}`) : (zh ? "會修改檔案" : "Modifies files")
        else if (tool === "bash") scope = area ? (zh ? `可能影響${area}` : `May affect ${area}`) : (zh ? "執行 shell 指令" : "Runs shell command")
        else scope = area || (zh ? "一般操作" : "General operation")
        dbg(`[PERM-CONTEXT] purpose="${purpose?.slice(0,60) || "none"}" scope="${scope?.slice(0,60) || "none"}"`)

        if (maxNum >= 2 && !hasLegacy) {
          const labels = maxNum >= 3
            ? ["Allow", "Allow always", "Deny"]
            : ["Allow", "Deny"]
          for (let i = 0; i < Math.min(maxNum, labels.length); i++) {
            const isDeny = /deny/i.test(labels[i])
            // Claude Code v2.1+ uses number keys (1/2/3) for TUI selection, not arrow keys
            options.push({ label: labels[i], input: `${i + 1}\r`, style: isDeny ? "danger" as const : "primary" as const })
          }
        } else {
          options.push(
            { label: "Allow", input: "y", style: "primary" as const },
            { label: "Allow always", input: "a", style: "primary" as const },
            { label: "Deny", input: "n", style: "danger" as const },
          )
        }

        // Dedup by detail content — different prompts have different details
        const menuHash = title + "|" + detail
        if (menuHash !== state.lastPermHash) {
          state.lastPermHash = menuHash
          events.push({
            id: makeEventId(), timestamp: now,
            type: "decision_request", status: "waiting",
            title, detail, raw: chunk,
            decision: { options, purpose, scope },
          })
          dbg(`[MENU-EMIT] title=${title} detail=${detail.slice(0,60)} opts=${options.length} maxNum=${maxNum} purpose=${purpose?.slice(0,40) || "none"}`)
        }
      }

      // Clear hash when tool call detected (user answered, agent moved on)
      if (hasToolCall) state.lastPermHash = ""
    }

    // Generic TUI menu detection removed — scrollback parsing is inherently unreliable
    // (status bar content, token counts, version strings get misidentified as menu items).
    // Specific menus (permission, resume, plan) are handled above with targeted patterns.

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
            detail: planContent,
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
    // Thinking marker = Claude is working, clear resumeInProgress if set
    if (!isTuiChunk && /[\u2726\u2731\u2217\u2234*]\s*Thinking/i.test(text)) {
      if (state.resumeInProgress) {
        state.resumeInProgress = false
        state.resumeFirstSeen = 0
        state.resumeEmitted = false
        state.resumeDecisionTime = 0
        state.responseAccum = ""
        state.responseAccumTime = 0
      }
    }
    if (!isTuiChunk && !state.resumeInProgress && /[\u2726\u2731\u2217\u2234*]\s*Thinking/i.test(text) && now - state.lastThinkingTime > 3000) {
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
    const hasResponseMarker = !isTuiChunk && !state.resumeInProgress && /\u25cf/.test(text) && !toolCallInText && !hasToolCall

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
        // Claude Code banner/startup text
        if (/Claude Code v\d/i.test(cleanLine)) continue
        if (/Opus \d|Sonnet \d|Haiku \d|Claude Max|Claude Pro/i.test(cleanLine)) continue
        if (/^~\/|^[A-Z]:\\|^\/[a-z]/i.test(cleanLine) && cleanLine.length < 80 && !/\u25cf/.test(cleanLine)) continue
        // /resume, /doctor, /model etc. menu text
        if (/^\/resume\b|^\/doctor\b|^\/model\b|^\/fast\b|Resume a previous/i.test(cleanLine)) continue
        if (/Found \d+ settings issue|0 tokens/i.test(cleanLine)) continue
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

      const responseText = responseLines.join("\n").replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, " ").trim()
      if (responseText.length >= 5) {
        if (now - state.responseAccumTime > 15000) {
          // New response block -- flush old if exists
          if (state.responseAccum.length > 10 && now - state.lastResponseTime > 2000) {
            state.lastResponseTime = now
            const flushEvent = flushResponseAccum(state, ctx, chunk)
            if (flushEvent) events.push(flushEvent)
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
    } else if (!isTuiChunk && !state.resumeInProgress && state.responseAccum.length > 0 && !hasToolCall && !toolCallInText) {
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
        if (/Claude Code v\d|Opus \d|Sonnet \d|Haiku \d|Claude Max|Claude Pro/i.test(cl)) continue
        if (/^\/resume\b|^\/doctor\b|Resume a previous|Found \d+ settings issue|0 tokens/i.test(cl)) continue
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
      const flushEvent = flushResponseAccum(state, ctx, chunk)
      if (flushEvent) events.push(flushEvent)
    }

    // --- Safety: clear resumeInProgress after decision was emitted + timeout ---
    if (state.resumeInProgress && state.resumeDecisionTime > 0 && now - state.resumeDecisionTime > 3000) {
      state.resumeInProgress = false
      state.resumeFirstSeen = 0
      state.resumeEmitted = false
      state.resumeDecisionTime = 0
      state.responseAccum = ""
      state.responseAccumTime = 0
      state.seenTools.clear()
    }

    // --- TUI menu detection (e.g. /resume) ---
    // Parse engine is SIGNAL ONLY — it sets ctx.resumeTuiActive for ws-server to consume.
    // It does NOT emit decision_request events. buildResumeOptions (jsonl-watcher) is the
    // single source of truth for resume session options.
    {
      const rawBuf = ctx.buffer
      const recentClean = stripAnsi(rawBuf.slice(-2000))
      const hasHeader = /Resume\s+Session\s*\((\d+)\s+(?:of\s+(\d+)|total)\)/i.test(recentClean)

      if (hasHeader && !hasToolCall && !/[\u2726\u2731\u2217\u2234*]\s*Thinking/i.test(text)) {
        state.resumeInProgress = true
        state.resumeFirstSeen = state.resumeFirstSeen || now
        // Signal to ws-server: resume TUI is on screen
        ctx.resumeTuiActive = true
        dbg(`[RESUME-SIGNAL] TUI detected, signaling ws-server`)
      } else if (state.resumeFirstSeen > 0) {
        // Resume TUI disappeared — session was selected or user cancelled
        ctx.resumeTuiActive = false
        state.resumeFirstSeen = 0
        state.resumeEmitted = false
        state.resumeInProgress = false
        state.resumeDecisionTime = 0
        state.responseAccum = ""
        state.responseAccumTime = 0
        state.seenTools.clear()
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
          type: "token_usage",
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
