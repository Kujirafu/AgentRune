// server/pty-manager.ts
// Ported from AirTerm/server/sessions.ts
import * as pty from "node-pty"
import { EventEmitter } from "node:events"
import type { Project } from "../shared/types.js"

export interface ManagedSession {
  id: string
  project: Project
  agentId: string
  pty: pty.IPty
  scrollback: string[]
  createdAt: number
  lastActivity: number
}

const MAX_SCROLLBACK = 20000

export class PtyManager extends EventEmitter {
  private sessions = new Map<string, ManagedSession>()

  getAll(): { id: string; projectId: string; projectName: string; agentId: string; cwd: string; lastActivity: number }[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      projectId: s.project.id,
      projectName: s.project.name,
      agentId: s.agentId,
      cwd: s.project.cwd,
      lastActivity: s.lastActivity,
    }))
  }

  get(id: string): ManagedSession | undefined {
    return this.sessions.get(id)
  }

  getByProject(projectId: string): ManagedSession[] {
    return [...this.sessions.values()].filter((s) => s.project.id === projectId)
  }

  create(project: Project, agentId: string = "terminal", sessionId?: string): ManagedSession {
    // If a specific sessionId is given, try to resume it
    if (sessionId) {
      const existing = this.sessions.get(sessionId)
      if (existing) return existing
    }

    const id = sessionId || `${project.id}_${Date.now()}`
    const shell = project.shell || (process.platform === "win32" ? "powershell.exe" : "bash")
    const term = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: project.cwd,
      env: (() => { const e = { ...process.env }; delete (e as any).CLAUDECODE; return e })() as Record<string, string>,
    })

    const session: ManagedSession = {
      id,
      project,
      agentId,
      pty: term,
      scrollback: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    }

    term.onData((data: string) => {
      session.scrollback.push(data)
      if (session.scrollback.length > MAX_SCROLLBACK) {
        session.scrollback.splice(0, session.scrollback.length - MAX_SCROLLBACK)
      }
      session.lastActivity = Date.now()
      this.emit("data", session.id, data)
    })

    term.onExit(() => {
      this.sessions.delete(session.id)
      this.emit("exit", session.id)
    })

    this.sessions.set(session.id, session)
    return session
  }

  write(id: string, data: string) {
    const session = this.sessions.get(id)
    if (session) {
      session.pty.write(data)
      session.lastActivity = Date.now()
    }
  }

  resize(id: string, cols: number, rows: number) {
    const session = this.sessions.get(id)
    if (session) {
      session.pty.resize(cols, rows)
    }
  }

  kill(id: string) {
    const session = this.sessions.get(id)
    if (session) {
      session.pty.kill()
      this.sessions.delete(id)
    }
  }

  getScrollback(id: string): string {
    const session = this.sessions.get(id)
    if (!session) return ""
    return session.scrollback.join("")
  }

  /** Get only the most recent scrollback, capped by byte size */
  getRecentScrollback(id: string, maxBytes: number = 80_000): string {
    const session = this.sessions.get(id)
    if (!session || session.scrollback.length === 0) return ""

    // Walk backwards collecting chunks until we hit the byte limit
    let totalLen = 0
    let startIdx = session.scrollback.length
    for (let i = session.scrollback.length - 1; i >= 0; i--) {
      const chunkLen = session.scrollback[i].length
      if (totalLen + chunkLen > maxBytes) break
      totalLen += chunkLen
      startIdx = i
    }
    return session.scrollback.slice(startIdx).join("")
  }
}
