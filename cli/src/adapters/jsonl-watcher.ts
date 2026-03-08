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
 *  If existingFiles is set, skip files that already existed when the watcher started
 *  (to avoid picking up external sessions' JSONL files). */
function findActiveJsonl(projectDir: string, opts?: { excludeClaimed?: boolean; existingFiles?: Set<string>; currentPath?: string }): string | null {
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
      // Skip files that existed before this watcher started (prevents cross-contamination)
      if (opts?.existingFiles && opts.existingFiles.has(f.path) && f.path !== opts.currentPath) continue
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
  const content = line.message?.content || []
  const ts = line.timestamp ? new Date(line.timestamp).getTime() : Date.now()
  for (const block of content) {
    if (block.type === "text" && block.text) {
      const text = block.text.trim()
      if (text.length < 2) return []
      return [{
        id: `usr_jw_${ts}`, timestamp: ts,
        type: "info" as const, status: "completed" as const,
        title: text.length > 60 ? text.slice(0, 60) + "..." : text,
        detail: text.length > 60 ? text : undefined,
      }]
    }
  }
  return []
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
  private existingFiles: Set<string>  // files that existed before this watcher — skip them

  constructor(projectCwd: string, callback: JsonlEventCallback) {
    const claudeBase = join(homedir(), ".claude", "projects")
    this.projectDir = join(claudeBase, cwdToClaudeDir(projectCwd))
    this.callback = callback
    // Snapshot existing JSONL files so we don't pick up external sessions
    this.existingFiles = new Set<string>()
    try {
      for (const f of readdirSync(this.projectDir)) {
        if (f.endsWith(".jsonl") && !f.includes("subagent")) {
          this.existingFiles.add(join(this.projectDir, f))
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
    const active = findActiveJsonl(this.projectDir, {
      excludeClaimed: true,
      existingFiles: this.existingFiles,
      currentPath: this.jsonlPath || undefined,
    })
    if (!active) return

    if (active !== this.jsonlPath) {
      // Release old claim
      if (this.jsonlPath) claimedJsonlFiles.delete(this.jsonlPath)
      if (this.watcher) { this.watcher.close(); this.watcher = null }
      this.jsonlPath = active
      claimedJsonlFiles.add(active)  // Claim this file
      this.seenIds.clear()

      // Always replay recent events (both first attach and resume)
      this.offset = 0
      this.replayRecent(active)
      this.watchFile()
    }
  }

  /** Read last portion of file and emit recent events (for resume) */
  private replayRecent(filePath: string): void {
    try {
      const size = statSync(filePath).size
      // Read last 100KB to find recent events
      const readStart = Math.max(0, size - 100_000)
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
        }
      }

      // Emit last 50 events for rich history
      const recent = allEvents.slice(-50)
      if (recent.length > 0) {
        this.callback(recent)
      }
    } catch { /* ignore errors during replay */ }
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

      if (parsed.type === "assistant") {
        // Dedup by tool_use ID
        const content = parsed.message?.content || []
        const toolIds = content.filter(c => c.type === "tool_use" && c.id).map(c => c.id!)
        const isAllSeen = toolIds.length > 0 && toolIds.every(id => this.seenIds.has(id))
        if (isAllSeen) continue
        toolIds.forEach(id => this.seenIds.add(id))

        const events = assistantToEvents(parsed)
        allEvents.push(...events)
      } else if (parsed.type === "result") {
        allEvents.push(...resultToEvents(parsed))
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
    // Clear existingFiles filter — after /resume we need to find ANY active JSONL,
    // including files that existed before this watcher started
    this.existingFiles.clear()
    if (this.jsonlPath) { claimedJsonlFiles.delete(this.jsonlPath) }
    this.jsonlPath = null
    this.seenIds.clear()
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
