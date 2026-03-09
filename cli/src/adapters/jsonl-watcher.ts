// adapters/jsonl-watcher.ts
// Watch Claude Code's session JSONL files for structured events.
// Replaces fragile ANSI parse engine with reliable JSON source.

import { watch, statSync, openSync, readSync, closeSync, readdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { AgentEvent } from "../shared/types.js"

let idCounter = 0
const makeId = () => `jw_${Date.now()}_${++idCounter}`

// Global set: tracks which .jsonl files are already claimed by a watcher instance.
// Prevents multiple watchers (from multiple PTY sessions) from reading the same file.
const claimedJsonlFiles = new Set<string>()

/** Convert project CWD to Claude's project directory name */
function cwdToClaudeDir(cwd: string): string {
  // Claude Code encodes path: C:\Users\agres\Documents\Test\AgentWiki
  // → C--Users-agres-Documents-Test-AgentWiki
  // Steps: normalize to forward slash, replace "X:" with "X-", then "/" with "-"
  const normalized = cwd.replace(/\\/g, "/")
  return normalized.replace(/^([A-Za-z]):/, "$1-").replace(/\//g, "-")
}

/** Find the most recently modified .jsonl in a Claude project dir.
 *  If excludeClaimed is true, skip files already claimed by another watcher.
 *  If existingFileMtimes is set, skip files that existed AND haven't been modified since watcher start. */
function findActiveJsonl(projectDir: string, opts?: { excludeClaimed?: boolean; existingFileMtimes?: Map<string, number>; currentPath?: string }): string | null {
  try {
    const files = readdirSync(projectDir)
      .filter(f => f.endsWith(".jsonl") && !f.includes("subagent"))
      .map(f => {
        try {
          const full = join(projectDir, f)
          return { path: full, mtime: statSync(full).mtimeMs }
        } catch { return null }
      })
      .filter(Boolean) as { path: string; mtime: number }[]

    files.sort((a, b) => b.mtime - a.mtime)

    for (const f of files) {
      // Skip files claimed by another watcher (but allow re-selecting our own current file)
      if (opts?.excludeClaimed && claimedJsonlFiles.has(f.path) && f.path !== opts.currentPath) continue
      // For new sessions: NEVER select a file that existed before this watcher started.
      // Other sessions may still be writing to their JSONL files (bumping mtime),
      // but those are NOT this session's file. Only select truly NEW files.
      if (opts?.existingFileMtimes && opts.existingFileMtimes.has(f.path) && f.path !== opts.currentPath) {
        continue
      }
      return f.path
    }
    return null
  } catch {
    return null
  }
}

interface JsonlLine {
  type: string
  subtype?: string
  message?: {
    content: Array<{
      type: string
      text?: string
      name?: string
      id?: string
      input?: Record<string, any>
    }>
  }
  content?: string
  data?: Record<string, any>
  timestamp?: string
  sessionId?: string
}

/** Convert a JSONL assistant message to AgentEvents */
function assistantToEvents(line: JsonlLine): AgentEvent[] {
  const events: AgentEvent[] = []
  const content = line.message?.content || []
  const ts = line.timestamp ? new Date(line.timestamp).getTime() : Date.now()

  for (const block of content) {
    if (block.type === "tool_use" && block.name) {
      const name = block.name
      const input = block.input || {}

      if (name === "Edit") {
        const filePath = input.file_path || "unknown"
        events.push({
          id: makeId(),
          timestamp: ts,
          type: "file_edit",
          status: "in_progress",
          title: `Editing ${filePath}`,
          detail: input.old_string ? `Replacing ${input.old_string.split("\n").length} lines` : undefined,
          diff: input.old_string && input.new_string ? {
            filePath,
            before: input.old_string,
            after: input.new_string,
          } : undefined,
        })
      } else if (name === "Write") {
        const filePath = input.file_path || "unknown"
        const content = input.content || ""
        events.push({
          id: makeId(),
          timestamp: ts,
          type: "file_create",
          status: "in_progress",
          title: `Creating ${filePath}`,
          diff: content ? {
            filePath,
            before: "",
            after: content.length > 5000 ? content.slice(0, 5000) + "\n... (truncated)" : content,
          } : undefined,
        })
      } else if (name === "Bash") {
        const cmd = (input.command || "").slice(0, 200)
        // Filter diagnostic noise
        if (/^(node\s+-e|cat\b|echo\b|head\b|tail\b|wc\b|pwd\b)/i.test(cmd)) continue
        events.push({
          id: makeId(),
          timestamp: ts,
          type: "command_run",
          status: "in_progress",
          title: `Running command`,
          detail: cmd.slice(0, 120),
        })
      } else if (name === "Read") {
        const filePath = input.file_path || "unknown"
        events.push({
          id: makeId(),
          timestamp: ts,
          type: "info",
          status: "completed",
          title: `Reading ${filePath.split(/[/\\]/).pop()}`,
          detail: filePath,
        })
      } else if (name === "Glob") {
        events.push({
          id: makeId(),
          timestamp: ts,
          type: "info",
          status: "completed",
          title: `Searching files: ${input.pattern || ""}`,
        })
      } else if (name === "Grep") {
        events.push({
          id: makeId(),
          timestamp: ts,
          type: "info",
          status: "completed",
          title: `Searching content: ${(input.pattern || "").slice(0, 60)}`,
        })
      } else if (name === "Agent") {
        events.push({
          id: makeId(),
          timestamp: ts,
          type: "info",
          status: "in_progress",
          title: `Subagent: ${(input.prompt || "").slice(0, 80)}`,
        })
      } else if (name === "WebFetch" || name === "WebSearch") {
        events.push({
          id: makeId(),
          timestamp: ts,
          type: "info",
          status: "in_progress",
          title: `${name}: ${(input.url || input.query || "").slice(0, 80)}`,
        })
      } else {
        events.push({
          id: makeId(),
          timestamp: ts,
          type: "info",
          status: "in_progress",
          title: name,
          detail: JSON.stringify(input).slice(0, 120),
        })
      }
    }

    // Text blocks — Claude's responses
    if (block.type === "text" && block.text) {
      const text = block.text.trim()
      if (text.length < 5) continue
      // Short text: title only. Long text: first line as title, full text as detail
      const firstLine = text.split("\n")[0].slice(0, 200)
      const isLong = text.length > 200 || text.includes("\n")
      events.push({
        id: makeId(),
        timestamp: ts,
        type: "response",
        status: "completed",
        title: isLong ? (firstLine.length < text.split("\n")[0].length ? firstLine + "..." : firstLine) : text,
        detail: isLong ? text : undefined,
      })
    }
  }

  return events
}

/** Convert a JSONL tool result to completion events */
function resultToEvents(line: JsonlLine): AgentEvent[] {
  const events: AgentEvent[] = []
  const content = line.message?.content || []
  const ts = line.timestamp ? new Date(line.timestamp).getTime() : Date.now()

  for (const block of content) {
    if (block.type === "tool_result" && block.text) {
      const text = block.text.trim()
      if (text.length < 10) continue
      // Show test results and errors from tool outputs
      if (/error|fail|exception|FAIL|ERROR/i.test(text) && text.length < 2000) {
        events.push({
          id: makeId(), timestamp: ts,
          type: "error", status: "failed",
          title: text.split("\n")[0].slice(0, 80),
          detail: text.length > 80 ? text.slice(0, 1000) : undefined,
        })
      }
      // Show test pass/fail summaries
      if (/\d+\s+(?:tests?\s+)?pass/i.test(text) || /\d+\s+passing/i.test(text)) {
        const passMatch = text.match(/(\d+)\s+(?:tests?\s+)?pass/i)
        const failMatch = text.match(/(\d+)\s+(?:tests?\s+)?fail/i)
        events.push({
          id: makeId(), timestamp: ts,
          type: "test_result",
          status: failMatch ? "failed" : "completed",
          title: "Test results",
          detail: `${passMatch?.[1] || "?"} passed${failMatch ? `, ${failMatch[1]} failed` : ""}`,
        })
      }
    }
  }
  return events
}

/** Convert a JSONL user message to event */
function userToEvents(line: JsonlLine): AgentEvent[] {
  const rawContent = line.message?.content
  const ts = line.timestamp ? new Date(line.timestamp).getTime() : Date.now()

  // content can be a plain string (user typed text) or an array of blocks
  let text = ""
  if (typeof rawContent === "string") {
    text = rawContent.trim()
  } else if (Array.isArray(rawContent)) {
    // Extract text blocks (skip tool_result blocks — those are Claude's tool outputs, not user input)
    const textBlocks = rawContent.filter((b: any) => b.type === "text" && b.text)
    text = textBlocks.map((b: any) => b.text).join("\n").trim()
  }

  if (text.length < 2) return []

  // Filter out non-user content:
  // 1. AgentRune injected prompts (rules instruction, install checks)
  if (/請先讀取\s*\.agentrune\/(rules\.md|agentlore\.md)/.test(text)) return []
  if (/Get-Command.*ErrorAction.*SilentlyContinue/.test(text)) return []
  if (/command -v .* >\/dev\/null 2>&1 \|\|/.test(text)) return []
  // 2. Claude Code system/internal XML tags (system-reminder, command-name, local-command-*, etc.)
  if (/^<[a-z][\w-]*>/.test(text)) return []

  return [{
    id: `usr_jw_${ts}`, timestamp: ts,
    type: "user_message" as const, status: "completed" as const,
    title: text.length > 100 ? text.slice(0, 100) + "..." : text,
    detail: text.length > 100 ? text : undefined,
  }]
}

export type JsonlEventCallback = (events: AgentEvent[]) => void

export class JsonlWatcher {
  private projectDir: string
  private jsonlPath: string | null = null
  private offset = 0
  private watcher: ReturnType<typeof watch> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private callback: JsonlEventCallback
  private lastCheck = 0
  private seenIds = new Set<string>()  // dedup tool_use IDs
  private pendingEventIds: string[] = []  // in_progress event IDs waiting for completion
  private existingFileMtimes: Map<string, number>  // files + their mtime at watcher start
  private startTime: number  // when this watcher was created
  private targetSessionId: string | undefined  // specific Claude Code session UUID to watch

  constructor(projectCwd: string, callback: JsonlEventCallback, targetSessionId?: string) {
    const claudeBase = join(homedir(), ".claude", "projects")
    this.projectDir = join(claudeBase, cwdToClaudeDir(projectCwd))
    this.callback = callback
    this.startTime = Date.now()
    this.targetSessionId = targetSessionId

    // If targeting a specific session, skip existingFileMtimes — go straight to that file
    if (targetSessionId) {
      this.existingFileMtimes = new Map()
      return
    }

    // Snapshot existing JSONL files + their mtimes so we can detect resumed ones
    this.existingFileMtimes = new Map<string, number>()
    try {
      for (const f of readdirSync(this.projectDir)) {
        if (f.endsWith(".jsonl") && !f.includes("subagent")) {
          const full = join(this.projectDir, f)
          try {
            this.existingFileMtimes.set(full, statSync(full).mtimeMs)
          } catch {}
        }
      }
    } catch { /* dir may not exist yet */ }
  }

  start(): void {
    // Find initial file
    this.findAndWatch()

    // Poll for new files every 5s (handles session changes, /resume)
    this.pollTimer = setInterval(() => this.findAndWatch(), 5000)
  }

  stop(): void {
    if (this.jsonlPath) { claimedJsonlFiles.delete(this.jsonlPath) }
    if (this.watcher) { this.watcher.close(); this.watcher = null }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
  }

  private findAndWatch(): void {
    // Once we've locked onto a file, STOP searching.
    // This prevents cross-session contamination when multiple sessions run
    // on the same project (each writing to different JSONL files).
    // The poll only exists to find our file initially (before Claude creates it).
    if (this.jsonlPath) {
      // Already watching a file — stop polling, we're done searching
      if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
      return
    }

    let active: string | null = null

    // If targeting a specific Claude session, look for that exact file
    if (this.targetSessionId) {
      const targetPath = join(this.projectDir, `${this.targetSessionId}.jsonl`)
      try {
        statSync(targetPath)
        active = targetPath
      } catch {
        // Target file not found yet — keep polling
      }
    }

    if (!active) {
      active = findActiveJsonl(this.projectDir, {
        excludeClaimed: true,
        existingFileMtimes: this.existingFileMtimes,
        currentPath: undefined,
      })
    }
    if (!active) return

    // Found our file — claim it and stop polling
    this.jsonlPath = active
    claimedJsonlFiles.add(active)
    this.seenIds.clear()
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }

    // Replay for resumed sessions, skip to end for new sessions with pre-existing files
    const isPreExisting = !this.targetSessionId && this.existingFileMtimes.has(active)
    if (isPreExisting) {
      try { this.offset = statSync(active).size } catch { this.offset = 0 }
      console.log(`[JsonlWatcher] Skipping replay for pre-existing file: ${active}`)
    } else {
      this.offset = 0
      this.replayRecent(active)
    }
    this.watchFile()
    console.log(`[JsonlWatcher] Locked onto: ${active}`)
  }

  /** Read last portion of file and emit recent events (for resume) */
  private replayRecent(filePath: string): void {
    try {
      const size = statSync(filePath).size
      // Read up to 1MB for full history (especially for resumed sessions)
      const readStart = Math.max(0, size - 1_000_000)
      const bytesToRead = size - readStart
      const buf = Buffer.alloc(bytesToRead)
      const fd = openSync(filePath, "r")
      readSync(fd, buf, 0, bytesToRead, readStart)
      closeSync(fd)
      this.offset = size

      const text = buf.toString("utf-8")
      const lines = text.split("\n").filter(Boolean)
      const allEvents: AgentEvent[] = []

      for (const raw of lines) {
        let parsed: JsonlLine
        try { parsed = JSON.parse(raw) } catch { continue }

        if (parsed.type === "assistant") {
          const content = parsed.message?.content || []
          const toolIds = content.filter(c => c.type === "tool_use" && c.id).map(c => c.id!)
          toolIds.forEach(id => this.seenIds.add(id))
          const events = assistantToEvents(parsed)
          allEvents.push(...events)
        } else if (parsed.type === "result") {
          allEvents.push(...resultToEvents(parsed))
        } else if (parsed.type === "user") {
          allEvents.push(...userToEvents(parsed))
        }
      }

      // Mark all in_progress events as completed (replay = already finished)
      for (const ev of allEvents) {
        if (ev.status === "in_progress") {
          ev.status = "completed"
        }
      }

      // Emit last 200 events for full history
      const recent = allEvents.slice(-200)
      const typeCounts: Record<string, number> = {}
      for (const e of recent) typeCounts[e.type] = (typeCounts[e.type] || 0) + 1
      console.log(`[JsonlWatcher] replayRecent: ${lines.length} lines → ${allEvents.length} total events → emitting ${recent.length} (types: ${JSON.stringify(typeCounts)})`)
      if (recent.length > 0) {
        this.callback(recent)
      }
    } catch (err) {
      console.log(`[JsonlWatcher] replayRecent ERROR: ${err instanceof Error ? err.message : err}`)
    }
  }

  private watchFile(): void {
    if (!this.jsonlPath) return
    try {
      this.watcher = watch(this.jsonlPath, () => {
        this.readNewLines()
      })
    } catch {
      // Fallback: poll every 2s
      if (this.pollTimer) clearInterval(this.pollTimer)
      this.pollTimer = setInterval(() => this.readNewLines(), 2000)
    }
  }

  private readNewLines(): void {
    if (!this.jsonlPath) return
    // Throttle: max once per 200ms
    const now = Date.now()
    if (now - this.lastCheck < 200) return
    this.lastCheck = now

    let size: number
    try { size = statSync(this.jsonlPath).size } catch { return }
    if (size <= this.offset) return

    // Read new bytes
    const bytesToRead = size - this.offset
    const buf = Buffer.alloc(bytesToRead)
    let fd: number
    try {
      fd = openSync(this.jsonlPath, "r")
      readSync(fd, buf, 0, bytesToRead, this.offset)
      closeSync(fd)
    } catch { return }
    this.offset = size

    // Parse lines
    const text = buf.toString("utf-8")
    const lines = text.split("\n").filter(Boolean)
    const allEvents: AgentEvent[] = []

    for (const raw of lines) {
      let parsed: JsonlLine
      try { parsed = JSON.parse(raw) } catch { continue }

      // When any new message arrives, complete all pending in_progress events
      // (the previous tools must have finished for a new message to appear)
      if (this.pendingEventIds.length > 0 && (parsed.type === "assistant" || parsed.type === "user" || parsed.type === "result")) {
        const ts = parsed.timestamp ? new Date(parsed.timestamp).getTime() : Date.now()
        for (const pendingId of this.pendingEventIds) {
          allEvents.push({
            id: pendingId,
            timestamp: ts,
            type: "info",
            status: "completed",
            title: "",  // empty title = update only, don't change display
          })
        }
        this.pendingEventIds = []
      }

      if (parsed.type === "assistant") {
        // Dedup by tool_use ID
        const content = parsed.message?.content || []
        const toolIds = content.filter(c => c.type === "tool_use" && c.id).map(c => c.id!)
        const isAllSeen = toolIds.length > 0 && toolIds.every(id => this.seenIds.has(id))
        if (isAllSeen) continue
        toolIds.forEach(id => this.seenIds.add(id))

        const events = assistantToEvents(parsed)
        // Track in_progress events for later completion
        for (const ev of events) {
          if (ev.status === "in_progress") {
            this.pendingEventIds.push(ev.id)
          }
        }
        allEvents.push(...events)
      } else if (parsed.type === "result") {
        allEvents.push(...resultToEvents(parsed))
      } else if (parsed.type === "user") {
        allEvents.push(...userToEvents(parsed))
      }
    }

    // Cap dedup set
    if (this.seenIds.size > 500) {
      const arr = [...this.seenIds]
      this.seenIds = new Set(arr.slice(-200))
    }

    if (allEvents.length > 0) {
      this.callback(allEvents)
    }
  }

  /** Force re-scan (e.g. after /resume selects a new session) */
  rescan(): void {
    // Clear lock and filters — after /resume we need to find ANY active JSONL
    this.existingFileMtimes.clear()
    if (this.jsonlPath) { claimedJsonlFiles.delete(this.jsonlPath) }
    if (this.watcher) { this.watcher.close(); this.watcher = null }
    this.jsonlPath = null
    this.seenIds.clear()
    // Restart polling since we cleared the lock
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => this.findAndWatch(), 5000)
    }
    this.findAndWatch()
  }

  getSessionId(): string | null {
    if (!this.jsonlPath) return null
    // Extract UUID from filename: abc-def-123.jsonl
    const match = this.jsonlPath.match(/([0-9a-f-]{36})\.jsonl$/i)
    return match?.[1] || null
  }

  /** Build resume session options directly from JSONL files on disk.
   *  No TUI parsing needed — reads file metadata + first user message. */
  buildResumeOptions(): AgentEvent | null {
    try {
      const files = readdirSync(this.projectDir)
        .filter(f => f.endsWith(".jsonl") && !f.includes("subagent"))
        .map(f => {
          const full = join(this.projectDir, f)
          try {
            const stat = statSync(full)
            return { name: f, path: full, mtime: stat.mtimeMs, size: stat.size }
          } catch { return null }
        })
        .filter(Boolean) as { name: string; path: string; mtime: number; size: number }[]

      files.sort((a, b) => b.mtime - a.mtime)
      // Exclude: (1) the currently active session, (2) tiny sessions (<2KB = basically empty)
      const currentPath = this.jsonlPath
      const sessions = files.filter(f => f.path !== currentPath && f.size >= 2048).slice(0, 20)
      if (sessions.length === 0) return null

      const options = sessions.map((s, index) => {
        const age = Date.now() - s.mtime
        const ageStr = age < 3600000
          ? Math.round(age / 60000) + " minutes ago"
          : age < 86400000
          ? Math.round(age / 3600000) + " hours ago"
          : Math.round(age / 86400000) + " days ago"
        const sizeStr = s.size > 1024 * 1024
          ? (s.size / 1024 / 1024).toFixed(1) + "MB"
          : Math.round(s.size / 1024) + "KB"

        // Read first user message as label
        let label = ""
        let branch = "main"
        try {
          const readSize = Math.min(s.size, 10000)
          const buf = Buffer.alloc(readSize)
          const fd = openSync(s.path, "r")
          readSync(fd, buf, 0, readSize, 0)
          closeSync(fd)
          const lines = buf.toString("utf-8").split("\n").filter(Boolean)
          for (const l of lines) {
            try {
              const o = JSON.parse(l)
              if (!branch && o.gitBranch) branch = o.gitBranch
              if (o.type === "user" && o.message?.content) {
                const t = (o.message.content as any[]).find((c: any) => c.type === "text")
                if (t?.text) {
                  label = t.text.replace(/\n/g, " ").trim().slice(0, 60)
                  break
                }
              }
            } catch {}
          }
        } catch {}

        const displayLabel = label
          ? `${label}\n${ageStr} · ${branch} · ${sizeStr}`
          : `${ageStr} · ${branch} · ${sizeStr}`

        // Claude Code /resume TUI: cursor starts at first item
        // Item 0 = just Enter, Item N = N arrow-downs then Enter
        const arrows = "\x1b[B".repeat(index)
        const input = arrows + "\r"

        return {
          label: displayLabel,
          input,
          style: "primary" as const,
        }
      })

      return {
        id: makeId(),
        timestamp: Date.now(),
        type: "decision_request",
        status: "waiting",
        title: `Resume Session (${sessions.length} total)`,
        decision: { options },
      }
    } catch {
      return null
    }
  }
}
