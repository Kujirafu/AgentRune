// adapters/gemini-watcher.ts
// Watch Gemini CLI's session JSON files for structured events.
// Gemini stores sessions at: ~/.gemini/tmp/<project>/chats/session-*.json
// Format: single JSON object with { sessionId, messages: [...], kind, ... }
// Messages have type: "user" | "gemini" | "info"

import { watch, statSync, openSync, readSync, closeSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { AgentEvent } from "../shared/types.js"

let idCounter = 0
const makeId = () => `gw_${Date.now()}_${++idCounter}`

interface GeminiMessage {
  id: string
  timestamp: string
  type: "user" | "gemini" | "info"
  content: string | Array<{ text: string }>
  thoughts?: Array<{ subject: string; description: string; timestamp: string }>
  tokens?: { input: number; output: number; cached: number; thoughts: number; tool: number; total: number }
  model?: string
  toolCalls?: Array<{ name: string; args: Record<string, any> }>
}

interface GeminiSession {
  sessionId: string
  messages: GeminiMessage[]
  kind?: string
  startTime?: string
  lastUpdated?: string
}

/** Find the project name for a given CWD from projects.json */
function findGeminiProject(cwd: string): string | null {
  const projectsFile = join(homedir(), ".gemini", "projects.json")
  try {
    const data = JSON.parse(readFileSync(projectsFile, "utf-8"))
    // projects.json maps path -> name
    for (const [path, name] of Object.entries(data)) {
      const normalizedPath = path.replace(/\\/g, "/").toLowerCase()
      const normalizedCwd = cwd.replace(/\\/g, "/").toLowerCase()
      if (normalizedCwd === normalizedPath || normalizedCwd.startsWith(normalizedPath + "/")) {
        return name as string
      }
    }
  } catch {}
  return null
}

/** Find all possible chat dirs for a project */
function findGeminiChatDirs(): string[] {
  const tmpDir = join(homedir(), ".gemini", "tmp")
  const dirs: string[] = []
  try {
    for (const project of readdirSync(tmpDir)) {
      const chatDir = join(tmpDir, project, "chats")
      try {
        statSync(chatDir)
        dirs.push(chatDir)
      } catch {}
    }
  } catch {}
  return dirs
}

/** Find the most recently modified session JSON across all projects */
function findActiveGeminiSession(projectName?: string): string | null {
  const tmpDir = join(homedir(), ".gemini", "tmp")
  const candidates: { path: string; mtime: number }[] = []

  const projectDirs = projectName ? [projectName] : (() => {
    try { return readdirSync(tmpDir) } catch { return [] }
  })()

  for (const project of projectDirs) {
    const chatDir = join(tmpDir, project, "chats")
    try {
      for (const file of readdirSync(chatDir).filter(f => f.startsWith("session-") && f.endsWith(".json"))) {
        const full = join(chatDir, file)
        try {
          candidates.push({ path: full, mtime: statSync(full).mtimeMs })
        } catch {}
      }
    } catch {}
  }

  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0]?.path || null
}

/** Convert Gemini messages to AgentEvents (only new ones since lastMessageCount) */
function geminiMessagesToEvents(messages: GeminiMessage[], startIndex: number): AgentEvent[] {
  const events: AgentEvent[] = []

  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i]
    const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now()

    if (msg.type === "gemini") {
      const text = typeof msg.content === "string" ? msg.content : ""
      if (!text || text.length < 10) continue

      // Check for tool call indicators in the response text
      const editMatch = text.match(/(?:editing|modifying|updating|writing to)\s+[`"']?([^\s`"'\n,]+)/i)
      if (editMatch) {
        events.push({
          id: makeId(), timestamp: ts,
          type: "file_edit", status: "in_progress",
          title: `Editing ${editMatch[1]}`,
        })
      }

      const createMatch = text.match(/(?:creating|writing new file)\s+[`"']?([^\s`"'\n,]+)/i)
      if (createMatch) {
        events.push({
          id: makeId(), timestamp: ts,
          type: "file_create", status: "in_progress",
          title: `Creating ${createMatch[1]}`,
        })
      }

      const cmdMatch = text.match(/(?:running|executing)\s+[`"']?(.{5,80})[`"']?/i)
      if (cmdMatch) {
        events.push({
          id: makeId(), timestamp: ts,
          type: "command_run", status: "in_progress",
          title: `$ ${cmdMatch[1].trim().slice(0, 80)}`,
        })
      }

      // If toolCalls field exists (may be available in newer versions)
      if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
        for (const tc of msg.toolCalls) {
          if (/write|edit|create|patch/i.test(tc.name)) {
            const file = tc.args?.path || tc.args?.file_path || "unknown"
            events.push({
              id: makeId(), timestamp: ts,
              type: "file_edit", status: "in_progress",
              title: `${tc.name}: ${file}`,
            })
          } else if (/exec|command|shell|run/i.test(tc.name)) {
            events.push({
              id: makeId(), timestamp: ts,
              type: "command_run", status: "in_progress",
              title: `Running: ${(tc.args?.command || "").slice(0, 60)}`,
            })
          }
        }
      }

      // General info event for substantial responses (skip if tool events already emitted)
      if (events.length === 0 || !editMatch && !createMatch && !cmdMatch) {
        // Only emit for non-trivial content
        if (text.length > 30) {
          events.push({
            id: makeId(), timestamp: ts,
            type: "info", status: "completed",
            title: text.length > 80 ? text.slice(0, 80) + "..." : text,
            detail: text.length > 80 ? text.slice(0, 300) : undefined,
          })
        }
      }

      // Token usage as info
      if (msg.tokens && msg.tokens.total > 0) {
        events.push({
          id: makeId(), timestamp: ts,
          type: "info", status: "completed",
          title: `Tokens: ${msg.tokens.total} (in: ${msg.tokens.input}, out: ${msg.tokens.output})`,
        })
      }
    }
  }

  return events
}

export type GeminiEventCallback = (events: AgentEvent[]) => void

export class GeminiWatcher {
  private sessionPath: string | null = null
  private lastMtime = 0
  private lastMessageCount = 0
  private watcher: ReturnType<typeof watch> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private callback: GeminiEventCallback
  private projectName: string | undefined

  constructor(projectCwd: string, callback: GeminiEventCallback) {
    this.projectName = findGeminiProject(projectCwd) || undefined
    this.callback = callback
  }

  start(): void {
    this.findAndWatch()
    this.pollTimer = setInterval(() => this.findAndWatch(), 5000)
  }

  stop(): void {
    if (this.watcher) { this.watcher.close(); this.watcher = null }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
  }

  private findAndWatch(): void {
    const active = findActiveGeminiSession(this.projectName)
    if (!active) return

    if (active !== this.sessionPath) {
      if (this.watcher) { this.watcher.close(); this.watcher = null }
      this.sessionPath = active
      this.lastMessageCount = 0
      // Read current state to get baseline message count (don't replay history)
      try {
        const data = JSON.parse(readFileSync(active, "utf-8")) as GeminiSession
        this.lastMessageCount = data.messages?.length || 0
      } catch {
        this.lastMessageCount = 0
      }
      this.lastMtime = Date.now()
      this.watchFile()
    } else {
      // Check if file was modified
      this.checkForUpdates()
    }
  }

  private watchFile(): void {
    if (!this.sessionPath) return
    try {
      this.watcher = watch(this.sessionPath, () => this.checkForUpdates())
    } catch {
      // Fallback: poll handled by findAndWatch interval
    }
  }

  private checkForUpdates(): void {
    if (!this.sessionPath) return
    let mtime: number
    try { mtime = statSync(this.sessionPath).mtimeMs } catch { return }
    if (mtime <= this.lastMtime) return
    this.lastMtime = mtime

    try {
      const data = JSON.parse(readFileSync(this.sessionPath, "utf-8")) as GeminiSession
      const messages = data.messages || []
      if (messages.length <= this.lastMessageCount) return

      const events = geminiMessagesToEvents(messages, this.lastMessageCount)
      this.lastMessageCount = messages.length

      if (events.length > 0) {
        this.callback(events)
      }
    } catch { /* JSON parse error during write — will retry on next change */ }
  }

  rescan(): void {
    this.sessionPath = null
    this.lastMessageCount = 0
    this.findAndWatch()
  }
}
