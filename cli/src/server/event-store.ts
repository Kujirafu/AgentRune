// server/event-store.ts
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { AgentEvent } from "../shared/types.js"
import { readEncryptedFile, writeEncryptedFile } from "./crypto.js"

interface SessionRecord {
  id: string
  projectId: string
  agentId: string
  startedAt: number
  endedAt?: number
  status: "active" | "completed" | "killed"
  events: AgentEvent[]
  summary?: {
    filesModified: number
    filesCreated: number
    linesAdded: number
    linesRemoved: number
    testsRun?: number
    testsPassed?: number
    decisionsAsked: number
    duration: number
  }
}

export class EventStore {
  private baseDir: string
  private sessions = new Map<string, SessionRecord>()

  constructor(baseDir: string = join(process.cwd(), ".agentrune", "sessions")) {
    this.baseDir = baseDir
    mkdirSync(this.baseDir, { recursive: true })
    this.loadIndex()
  }

  private indexPath(): string {
    return join(this.baseDir, "index.json")
  }

  private sessionPath(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.json`)
  }

  private loadIndex(): void {
    if (existsSync(this.indexPath())) {
      try {
        const data = JSON.parse(readFileSync(this.indexPath(), "utf-8"))
        for (const rec of data) {
          // Index records don't have events (stripped by saveIndex), initialize as empty array
          if (!rec.events) rec.events = []
          this.sessions.set(rec.id, rec)
        }
      } catch {}
    }
  }

  private saveIndex(): void {
    const records = Array.from(this.sessions.values()).map(({ events, ...rest }) => rest)
    writeFileSync(this.indexPath(), JSON.stringify(records, null, 2))
  }

  startSession(projectId: string, agentId: string): string {
    const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const record: SessionRecord = {
      id,
      projectId,
      agentId,
      startedAt: Date.now(),
      status: "active",
      events: [],
    }
    this.sessions.set(id, record)
    this.saveIndex()
    return id
  }

  addEvent(sessionId: string, event: AgentEvent): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.events.push(event)
    // Persist every 10 events or on decision_request
    if (session.events.length % 10 === 0 || event.type === "decision_request") {
      this.persistSession(sessionId)
    }
  }

  endSession(sessionId: string, status: "completed" | "killed" = "completed"): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.endedAt = Date.now()
    session.status = status
    session.summary = this.computeSummary(session)
    this.persistSession(sessionId)
    this.saveIndex()
  }

  private computeSummary(session: SessionRecord): SessionRecord["summary"] {
    const events = session.events
    return {
      filesModified: events.filter(e => e.type === "file_edit").length,
      filesCreated: events.filter(e => e.type === "file_create").length,
      linesAdded: 0,
      linesRemoved: 0,
      testsRun: events.filter(e => e.type === "test_result").length || undefined,
      testsPassed: events.filter(e => e.type === "test_result" && e.status === "completed").length || undefined,
      decisionsAsked: events.filter(e => e.type === "decision_request").length,
      duration: (session.endedAt || Date.now()) - session.startedAt,
    }
  }

  private persistSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    writeEncryptedFile(this.sessionPath(sessionId), JSON.stringify(session, null, 2))
  }

  getSession(sessionId: string): Omit<SessionRecord, "events"> | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    const { events, ...rest } = session
    return rest
  }

  getSessionsByProject(projectId: string): Omit<SessionRecord, "events">[] {
    return Array.from(this.sessions.values())
      .filter(s => s.projectId === projectId)
      .map(({ events, ...rest }) => rest)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  getSessionEvents(sessionId: string): AgentEvent[] {
    const session = this.sessions.get(sessionId)
    if (session) return session.events

    // Try loading from disk (handles both encrypted and legacy plaintext files)
    const path = this.sessionPath(sessionId)
    if (existsSync(path)) {
      try {
        const raw = readEncryptedFile(path)
        if (raw) {
          const data = JSON.parse(raw)
          return data.events || []
        }
      } catch {}
    }
    return []
  }
}
