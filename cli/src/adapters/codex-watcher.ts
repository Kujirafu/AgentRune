// adapters/codex-watcher.ts
// Watch Codex CLI's session JSONL files for structured events.
// Codex stores sessions at: ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl
// Session index at: ~/.codex/session_index.jsonl

import { watch, statSync, openSync, readSync, closeSync, readdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { AgentEvent } from "../shared/types.js"

let idCounter = 0
const makeId = () => `cxw_${Date.now()}_${++idCounter}`

/** Find most recently modified rollout .jsonl across all date dirs */
function findActiveCodexSession(): string | null {
  const sessionsDir = join(homedir(), ".codex", "sessions")
  try {
    // Walk YYYY/MM/DD structure, find most recent file
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
                    candidates.push({ path: full, mtime: statSync(full).mtimeMs })
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
  }
}

/** Convert Codex JSONL events to AgentEvents */
function codexLineToEvents(line: CodexLine): AgentEvent[] {
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
    }
  }

  if (line.type === "event_msg" && line.payload) {
    const p = line.payload

    if (p.type === "agent_message" && p.message) {
      const text = p.message.trim()
      if (text.length < 20) return events
      // Skip commentary phase (thinking out loud)
      if (p.phase === "commentary") return events
      events.push({
        id: makeId(),
        timestamp: now,
        type: "info",
        status: "completed",
        title: text.length > 80 ? text.slice(0, 80) + "..." : text,
        detail: text.length > 80 ? text : undefined,
      })
    }
  }

  return events
}

export type CodexEventCallback = (events: AgentEvent[]) => void

export class CodexWatcher {
  private jsonlPath: string | null = null
  private offset = 0
  private watcher: ReturnType<typeof watch> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private callback: CodexEventCallback
  private lastCheck = 0
  private seenPayloadIds = new Set<string>()

  constructor(callback: CodexEventCallback) {
    this.callback = callback
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
    const active = findActiveCodexSession()
    if (!active) return

    if (active !== this.jsonlPath) {
      if (this.watcher) { this.watcher.close(); this.watcher = null }
      this.jsonlPath = active
      this.seenPayloadIds.clear()
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
      allEvents.push(...events)
    }

    // Cap dedup set
    if (this.seenPayloadIds.size > 500) {
      const arr = [...this.seenPayloadIds]
      this.seenPayloadIds = new Set(arr.slice(-200))
    }

    if (allEvents.length > 0) {
      this.callback(allEvents)
    }
  }

  rescan(): void {
    this.jsonlPath = null
    this.seenPayloadIds.clear()
    this.findAndWatch()
  }
}
