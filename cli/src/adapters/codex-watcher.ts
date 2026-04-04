// adapters/codex-watcher.ts
// Watch Codex CLI session JSONL files for structured events.
// Codex stores sessions at: ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl

import { watch, statSync, openSync, readSync, closeSync, readdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { AgentEvent } from "../shared/types.js"

let idCounter = 0
const makeId = () => `cxw_${Date.now()}_${++idCounter}`

function normalizeComparablePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase()
}

export function codexSessionCwdMatchesProject(sessionCwd: string | null, projectCwd: string): boolean {
  if (!sessionCwd) return false

  const normalizedSession = normalizeComparablePath(sessionCwd)
  const normalizedProject = normalizeComparablePath(projectCwd)
  if (!normalizedSession || !normalizedProject) return false

  return normalizedSession === normalizedProject
    || normalizedSession.startsWith(`${normalizedProject}/`)
    || normalizedProject.startsWith(`${normalizedSession}/`)
}

export function codexSessionCwdEqualsProject(sessionCwd: string | null, projectCwd: string): boolean {
  if (!sessionCwd) return false
  return normalizeComparablePath(sessionCwd) === normalizeComparablePath(projectCwd)
}

export function readCodexSessionCwd(sessionPath: string): string | null {
  let fd: number | null = null
  try {
    fd = openSync(sessionPath, "r")
    const buf = Buffer.alloc(16_384)
    const bytesRead = readSync(fd, buf, 0, buf.length, 0)
    const text = buf.subarray(0, bytesRead).toString("utf-8")
    const lines = text.split("\n")

    for (const raw of lines) {
      if (!raw.trim()) continue
      try {
        const parsed = JSON.parse(raw) as { type?: string; payload?: { cwd?: string } }
        if (parsed.type === "session_meta" && typeof parsed.payload?.cwd === "string") {
          return parsed.payload.cwd
        }
      } catch {
        // Ignore partial or malformed first-chunk lines.
      }
    }
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try { closeSync(fd) } catch {}
    }
  }

  return null
}

interface ResolveCodexSessionOptions {
  sessionsDir?: string
  preferredPath?: string | null
  minMtimeMs?: number
}

/** Find the most recently modified rollout .jsonl for the exact session cwd. */
export function findActiveCodexSession(projectCwd: string, options: ResolveCodexSessionOptions = {}): string | null {
  const sessionsDir = options.sessionsDir || join(homedir(), ".codex", "sessions")
  try {
    const preferredPath = options.preferredPath || null
    if (preferredPath) {
      try {
        statSync(preferredPath)
        if (codexSessionCwdEqualsProject(readCodexSessionCwd(preferredPath), projectCwd)) {
          return preferredPath
        }
      } catch {
        // Fall through to a fresh scan if the preferred path disappeared.
      }
    }

    const candidates: { path: string; mtime: number }[] = []
    for (const year of readdirSync(sessionsDir).filter(f => /^\d{4}$/.test(f))) {
      const yearDir = join(sessionsDir, year)
      try {
        for (const month of readdirSync(yearDir).filter(f => /^\d{2}$/.test(f))) {
          const monthDir = join(yearDir, month)
          try {
            for (const day of readdirSync(monthDir).filter(f => /^\d{2}$/.test(f))) {
              const dayDir = join(monthDir, day)
              try {
                for (const file of readdirSync(dayDir).filter(f => f.startsWith("rollout-") && f.endsWith(".jsonl"))) {
                  const full = join(dayDir, file)
                  try {
                    const stat = statSync(full)
                    if (typeof options.minMtimeMs === "number" && stat.mtimeMs < options.minMtimeMs) continue
                    if (!codexSessionCwdEqualsProject(readCodexSessionCwd(full), projectCwd)) continue
                    candidates.push({ path: full, mtime: stat.mtimeMs })
                  } catch {}
                }
              } catch {}
            }
          } catch {}
        }
      } catch {}
    }
    candidates.sort((a, b) => b.mtime - a.mtime)
    return candidates[0]?.path || null
  } catch {
    return null
  }
}

interface CodexLine {
  type: string
  payload?: {
    type?: string
    name?: string
    arguments?: string
    message?: string
    phase?: string
    id?: string
    cwd?: string
    cli_version?: string
    model_provider?: string
    role?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }
}

function buildAssistantResponseEvent(text: string, now: number): AgentEvent | null {
  const clean = text.trim()
  if (clean.length < 5) return null

  const firstLine = clean.split("\n")[0].slice(0, 200)
  const isLong = clean.length > 200 || clean.includes("\n")
  return {
    id: makeId(),
    timestamp: now,
    type: "response",
    status: "completed",
    title: isLong ? (firstLine.length < clean.split("\n")[0].length ? firstLine + "..." : firstLine) : clean,
    detail: isLong ? clean : undefined,
  }
}

/** Convert Codex JSONL events to AgentEvents */
export function codexLineToEvents(line: CodexLine): AgentEvent[] {
  const events: AgentEvent[] = []
  const now = Date.now()

  if (line.type === "response_item" && line.payload) {
    const p = line.payload

    // function_call — tool execution
    if (p.type === "function_call" && p.name) {
      let args: Record<string, any> = {}
      try { args = JSON.parse(p.arguments || "{}") } catch {}

      if (p.name === "shell_command" || p.name === "shell") {
        const cmd = (args.command || args.cmd || "").slice(0, 200)
        // Filter diagnostic noise
        if (/^(cat\b|echo\b|head\b|tail\b|wc\b|pwd\b|ls\b)/i.test(cmd)) return events
        events.push({
          id: makeId(),
          timestamp: now,
          type: "command_run",
          status: "in_progress",
          title: "Running command",
          detail: cmd.slice(0, 120),
        })
      } else if (/write|create|edit|patch/i.test(p.name)) {
        const file = args.path || args.file_path || args.filename || "unknown"
        events.push({
          id: makeId(),
          timestamp: now,
          type: "file_edit",
          status: "in_progress",
          title: `Editing ${file}`,
          detail: p.name,
        })
      } else if (/read_file|list_dir|search/i.test(p.name)) {
        // Skip — too noisy
      } else {
        events.push({
          id: makeId(),
          timestamp: now,
          type: "info",
          status: "in_progress",
          title: p.name,
          detail: (p.arguments || "").slice(0, 120),
        })
      }
    } else if (p.type === "message" && p.role === "assistant" && Array.isArray(p.content)) {
      const text = p.content
        .filter(block => block?.type === "output_text" && typeof block.text === "string")
        .map(block => block.text!.trim())
        .filter(Boolean)
        .join("\n\n")
      const event = buildAssistantResponseEvent(text, now)
      if (event) events.push(event)
    }
  }

  if (line.type === "event_msg" && line.payload) {
    const p = line.payload

    if (p.type === "agent_message" && p.message) {
      if (p.phase === "commentary") return events
      const event = buildAssistantResponseEvent(p.message, now)
      if (event) events.push(event)
    }
  }

  return events
}

export type CodexEventCallback = (events: AgentEvent[]) => void

interface CodexWatcherOptions {
  preferredPath?: string | null
  minMtimeMs?: number
}

export class CodexWatcher {
  private projectCwd: string
  private jsonlPath: string | null = null
  private offset = 0
  private watcher: ReturnType<typeof watch> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private callback: CodexEventCallback
  private lastCheck = 0
  private seenPayloadIds = new Set<string>()
  private seenResponseKeys = new Set<string>()
  private preferredPath: string | null
  private minMtimeMs?: number

  constructor(projectCwd: string, callback: CodexEventCallback, options: CodexWatcherOptions = {}) {
    this.projectCwd = projectCwd
    this.callback = callback
    this.preferredPath = options.preferredPath || null
    this.minMtimeMs = options.minMtimeMs
  }

  start(): void {
    this.findAndWatch()
    // Poll for new session files every 5s
    this.pollTimer = setInterval(() => this.findAndWatch(), 5000)
  }

  stop(): void {
    if (this.watcher) { this.watcher.close(); this.watcher = null }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
  }

  private findAndWatch(): void {
    const active = findActiveCodexSession(this.projectCwd, {
      preferredPath: this.preferredPath,
      minMtimeMs: this.minMtimeMs,
    })
    if (!active) return

    if (active !== this.jsonlPath) {
      if (this.watcher) { this.watcher.close(); this.watcher = null }
      this.jsonlPath = active
      this.preferredPath = active
      this.minMtimeMs = undefined
      this.seenPayloadIds.clear()
      this.seenResponseKeys.clear()
      // Start from end (don't replay history)
      try { this.offset = statSync(active).size } catch { this.offset = 0 }
      this.watchFile()
    }
  }

  private watchFile(): void {
    if (!this.jsonlPath) return
    try {
      this.watcher = watch(this.jsonlPath, () => this.readNewLines())
    } catch {
      if (this.pollTimer) clearInterval(this.pollTimer)
      this.pollTimer = setInterval(() => this.readNewLines(), 2000)
    }
  }

  private readNewLines(): void {
    if (!this.jsonlPath) return
    const now = Date.now()
    if (now - this.lastCheck < 200) return
    this.lastCheck = now

    let size: number
    try { size = statSync(this.jsonlPath).size } catch { return }
    if (size <= this.offset) return

    const bytesToRead = size - this.offset
    const buf = Buffer.alloc(bytesToRead)
    try {
      const fd = openSync(this.jsonlPath, "r")
      readSync(fd, buf, 0, bytesToRead, this.offset)
      closeSync(fd)
    } catch { return }
    this.offset = size

    const text = buf.toString("utf-8")
    const lines = text.split("\n").filter(Boolean)
    const allEvents: AgentEvent[] = []

    for (const raw of lines) {
      let parsed: CodexLine
      try { parsed = JSON.parse(raw) } catch { continue }

      // Dedup by payload ID if available
      const pid = parsed.payload?.id
      if (pid) {
        if (this.seenPayloadIds.has(pid)) continue
        this.seenPayloadIds.add(pid)
      }

      const events = codexLineToEvents(parsed)
      for (const event of events) {
        if (event.type === "response") {
          const key = `${event.title}\n${event.detail || ""}`
          if (this.seenResponseKeys.has(key)) continue
          this.seenResponseKeys.add(key)
        }
        allEvents.push(event)
      }
    }

    // Cap dedup set
    if (this.seenPayloadIds.size > 500) {
      const arr = [...this.seenPayloadIds]
      this.seenPayloadIds = new Set(arr.slice(-200))
    }
    if (this.seenResponseKeys.size > 500) {
      const arr = [...this.seenResponseKeys]
      this.seenResponseKeys = new Set(arr.slice(-200))
    }

    if (allEvents.length > 0) {
      this.callback(allEvents)
    }
  }

  rescan(): void {
    this.jsonlPath = null
    this.seenPayloadIds.clear()
    this.seenResponseKeys.clear()
    this.findAndWatch()
  }

  /** Replay recent events from the JSONL file (used when persisted events are empty) */
  forceReplay(): void {
    if (!this.jsonlPath) {
      console.log(`[CodexWatcher] forceReplay: no jsonlPath yet, skipping`)
      return
    }
    try {
      const size = statSync(this.jsonlPath).size
      const readStart = Math.max(0, size - 500_000)
      const bytesToRead = size - readStart
      const buf = Buffer.alloc(bytesToRead)
      const fd = openSync(this.jsonlPath, "r")
      readSync(fd, buf, 0, bytesToRead, readStart)
      closeSync(fd)
      this.offset = size

      const text = buf.toString("utf-8")
      const lines = text.split("\n").filter(Boolean)
      const allEvents: AgentEvent[] = []

      for (const raw of lines) {
        let parsed: CodexLine
        try { parsed = JSON.parse(raw) } catch { continue }
        const events = codexLineToEvents(parsed)
        allEvents.push(...events)
      }

      // Mark all replay events as completed (historical)
      for (const ev of allEvents) {
        if (ev.status === "in_progress" || ev.status === "waiting") {
          ev.status = "completed"
        }
      }

      const recent = allEvents.slice(-200)
      console.log(`[CodexWatcher] forceReplay: ${lines.length} lines → ${allEvents.length} events → emitting ${recent.length}`)
      if (recent.length > 0) {
        this.callback(recent)
      }
    } catch (err) {
      console.log(`[CodexWatcher] forceReplay ERROR: ${err instanceof Error ? err.message : err}`)
    }
  }
}
