// server/ws-server.ts
// Main WebSocket + HTTP server — ported from AirTerm/server/index.ts
import express from "express"
import { createServer as createHttpServer } from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, appendFile } from "node:fs"
import { join, basename, dirname } from "node:path"
import { homedir, hostname, networkInterfaces } from "node:os"
import { execSync } from "node:child_process"
import { PtyManager } from "./pty-manager.js"
import { EventStore } from "./event-store.js"
import { createSessionToken, validateSessionToken } from "./auth.js"
import { readClipboard, writeClipboard } from "./clipboard.js"
import { ParseEngine } from "../adapters/parse-engine.js"
import { loadConfig, getConfigDir } from "../shared/config.js"
import { log } from "../shared/logger.js"
import type { AgentEvent, TaskStore, Project } from "../shared/types.js"

// --- Utility ---

function getLocalIp(): string {
  const nets = Object.values(networkInterfaces()).flat().filter(
    (n) => n && n.family === "IPv4" && !n.internal
  ) as { address: string }[]
  const wifi = nets.find((n) => /^192\.168\./.test(n.address))
  if (wifi) return wifi.address
  const ten = nets.find((n) => /^10\./.test(n.address))
  if (ten) return ten.address
  const priv = nets.find((n) => /^172\.(1[6-9]|2\d|3[01])\./.test(n.address))
  if (priv) return priv.address
  return nets[0]?.address ?? "127.0.0.1"
}

// --- Projects ---

function getProjectsPath(): string {
  return join(getConfigDir(), "projects.json")
}

function loadProjects(): Project[] {
  const configPath = getProjectsPath()
  if (!existsSync(configPath)) {
    return [{
      id: "default",
      name: "Home",
      cwd: process.env.HOME || process.env.USERPROFILE || ".",
    }]
  }
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"))
  } catch {
    return [{
      id: "default",
      name: "Home",
      cwd: process.env.HOME || process.env.USERPROFILE || ".",
    }]
  }
}

// --- Events persistence ---

function getEventsDir(): string {
  const dir = join(homedir(), ".agentrune", "events")
  mkdirSync(dir, { recursive: true })
  return dir
}

function persistEvents(sessionId: string, events: AgentEvent[]) {
  try {
    const capped = events.slice(-200)
    const path = join(getEventsDir(), `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`)
    writeFileSync(path, JSON.stringify(capped))
  } catch { /* ignore */ }
}

function loadPersistedEvents(sessionId: string): AgentEvent[] {
  try {
    const path = join(getEventsDir(), `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`)
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"))
    }
  } catch { /* ignore */ }
  return []
}

function loadProjectEvents(projectId: string): AgentEvent[] {
  try {
    const eventsDir = getEventsDir()
    const prefix = projectId.replace(/[^a-zA-Z0-9_-]/g, "_") + "_"
    const files = readdirSync(eventsDir)
      .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
      .sort()
    if (files.length === 0) return []
    const latest = files[files.length - 1]
    return JSON.parse(readFileSync(join(eventsDir, latest), "utf-8")) as AgentEvent[]
  } catch { /* ignore */ }
  return []
}

// --- AgentLore heartbeat ---

async function agentloreHeartbeat(token: string, deviceId: string, port: number, cloudToken?: string) {
  try {
    await fetch("https://agentlore.vercel.app/api/agentrune/register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId,
        localIp: getLocalIp(),
        port,
        platform: process.platform,
        protocol: "http",
        cloudSessionToken: cloudToken || undefined,
      }),
    })
  } catch {
    // Heartbeat failure is non-fatal
  }
}

// --- Create server ---

export function createServer(portOverride?: number) {
  const config = loadConfig()
  const PORT = portOverride || config.port || 3456

  const app = express()
  app.use(express.json({ limit: "10mb" }))

  // Session tokens for WS auth
  const sessionTokens = new Set<string>()

  function issueSessionToken(): string {
    const token = createSessionToken("local")
    sessionTokens.add(token)
    return token
  }

  const server = createHttpServer(app)
  const wss = new WebSocketServer({ server })

  // Heartbeat: ping clients every 20s
  const wsAlive = new WeakMap<WebSocket, boolean>()
  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (wsAlive.get(ws) === false) {
        ws.terminate()
        continue
      }
      wsAlive.set(ws, false)
      ws.ping()
    }
  }, 20_000)
  wss.on("close", () => clearInterval(heartbeatInterval))

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log.warn(`AgentRune is already running on port ${PORT}`)
      process.exit(0)
    }
    throw err
  })

  const sessions = new PtyManager()
  const eventStore = new EventStore()
  const projects = loadProjects()

  // --- CORS ---
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
    if (_req.method === "OPTIONS") {
      return res.sendStatus(200)
    }
    next()
  })

  // --- Auth endpoints ---

  app.get("/api/auth/check", (req, res) => {
    const deviceId = req.query.deviceId as string | undefined
    res.json({
      mode: "token",
      deviceKnown: !!deviceId,
      hasPairedDevices: true,
    })
  })

  app.post("/api/auth/device", (req, res) => {
    const { deviceId, token } = req.body
    if (!deviceId || !token) {
      return res.status(400).json({ error: "Missing deviceId or token" })
    }
    // Validate against config's agentlore token or session tokens
    if (sessionTokens.has(token) || validateSessionToken(token)) {
      const sessionToken = issueSessionToken()
      return res.json({ authenticated: true, sessionToken })
    }
    res.status(401).json({ authenticated: false })
  })

  // --- REST API ---

  app.get("/api/projects", (_req, res) => {
    res.json(projects)
  })

  app.post("/api/projects", (req, res) => {
    const { name, cwd } = req.body
    if (!name || !cwd) return res.status(400).json({ error: "Missing name or cwd" })

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    if (projects.find((p) => p.id === id)) return res.status(409).json({ error: "Project exists" })

    const project = { id, name, cwd }
    projects.push(project)

    writeFileSync(getProjectsPath(), JSON.stringify(projects, null, 2))
    res.json(project)
  })

  app.get("/api/sessions", (_req, res) => {
    res.json(sessions.getAll())
  })

  app.post("/api/sessions/:id/kill", (req, res) => {
    sessions.kill(req.params.id)
    res.json({ ok: true })
  })

  // --- Clipboard ---

  app.get("/api/clipboard", (_req, res) => {
    const text = readClipboard()
    res.json({ text })
  })

  app.post("/api/clipboard", (req, res) => {
    const { text } = req.body
    if (typeof text !== "string") return res.status(400).json({ error: "Missing text" })
    const ok = writeClipboard(text)
    res.json({ ok })
  })

  // --- File browser ---

  app.get("/api/browse", (req, res) => {
    const dirPath = (req.query.path as string) || process.env.HOME || process.env.USERPROFILE || "."

    if (!existsSync(dirPath)) {
      return res.status(404).json({ error: "Path not found" })
    }

    try {
      const stat = statSync(dirPath)
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: "Not a directory" })
      }

      const entries = readdirSync(dirPath, { withFileTypes: true })
        .filter((e) => !e.name.startsWith("."))
        .map((e) => ({
          name: e.name,
          path: join(dirPath, e.name),
          isDir: e.isDirectory(),
        }))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })

      res.json({
        path: dirPath,
        parent: dirname(dirPath),
        entries,
      })
    } catch {
      res.status(500).json({ error: "Cannot read directory" })
    }
  })

  // --- File preview ---

  app.get("/api/file", (req, res) => {
    const filePath = req.query.path as string
    if (!filePath) return res.status(400).json({ error: "Missing path" })
    if (!existsSync(filePath)) return res.status(404).json({ error: "File not found" })

    try {
      const stat = statSync(filePath)
      if (stat.isDirectory()) return res.status(400).json({ error: "Is a directory" })
      if (stat.size > 100 * 1024) {
        const content = readFileSync(filePath, "utf-8").slice(0, 100 * 1024)
        const lines = content.split("\n")
        const truncated = lines.length > 500
        return res.json({ content: lines.slice(0, 500).join("\n"), size: stat.size, truncated })
      }
      const content = readFileSync(filePath, "utf-8")
      const lines = content.split("\n")
      const truncated = lines.length > 500
      res.json({
        content: truncated ? lines.slice(0, 500).join("\n") : content,
        size: stat.size,
        truncated,
      })
    } catch {
      res.status(500).json({ error: "Cannot read file" })
    }
  })

  // --- Git endpoints ---

  app.get("/api/git/status", (req, res) => {
    const projectId = req.query.project as string
    const project = projects.find((p) => p.id === projectId)
    if (!project) return res.status(404).json({ error: "Project not found" })

    try {
      const raw = execSync("git status --porcelain -b", { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
      const lines = raw.split("\n").filter(Boolean)
      let branch = "unknown"
      const branchLine = lines.find((l) => l.startsWith("## "))
      if (branchLine) {
        branch = branchLine.replace("## ", "").split("...")[0]
      }
      const files = lines
        .filter((l) => !l.startsWith("## "))
        .map((l) => {
          const xy = l.slice(0, 2)
          const path = l.slice(3).trim()
          let status = "modified"
          if (xy.includes("?")) status = "untracked"
          else if (xy.includes("A")) status = "added"
          else if (xy.includes("D")) status = "deleted"
          else if (xy.includes("R")) status = "renamed"
          const staged = xy[0] !== " " && xy[0] !== "?"
          return { path, status, staged, xy }
        })
      res.json({ branch, files })
    } catch {
      res.json({ branch: "unknown", files: [], error: "Not a git repository" })
    }
  })

  app.get("/api/git/diff", (req, res) => {
    const projectId = req.query.project as string
    const file = req.query.file as string
    const project = projects.find((p) => p.id === projectId)
    if (!project || !file) return res.status(400).json({ error: "Missing project or file" })

    try {
      let before = ""
      let after = ""
      try {
        before = execSync(`git show HEAD:${JSON.stringify(file)}`, { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
      } catch { /* new file, no HEAD version */ }
      const fullPath = join(project.cwd, file)
      if (existsSync(fullPath)) {
        after = readFileSync(fullPath, "utf-8")
      }
      if (before.length > 50000) before = before.slice(0, 50000) + "\n... (truncated)"
      if (after.length > 50000) after = after.slice(0, 50000) + "\n... (truncated)"
      res.json({ before, after })
    } catch {
      res.status(500).json({ error: "Cannot get diff" })
    }
  })

  app.post("/api/git/commit", (req, res) => {
    const { project: projectId, message, files } = req.body
    const project = projects.find((p) => p.id === projectId)
    if (!project || !message) return res.status(400).json({ error: "Missing project or message" })

    try {
      if (files && Array.isArray(files) && files.length > 0) {
        for (const f of files) {
          execSync(`git add ${JSON.stringify(f)}`, { cwd: project.cwd, timeout: 5000 })
        }
      } else {
        execSync("git add -A", { cwd: project.cwd, timeout: 5000 })
      }
      const result = execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: project.cwd, encoding: "utf-8", timeout: 10000 })
      const hashMatch = result.match(/\[[\w/-]+ ([a-f0-9]+)\]/)
      res.json({ hash: hashMatch?.[1] || "unknown", message })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Commit failed"
      res.status(500).json({ error: msg })
    }
  })

  // --- Tasks endpoints ---

  const TASKS_DIR = join(homedir(), ".agentrune", "tasks")
  try { mkdirSync(TASKS_DIR, { recursive: true }) } catch { /* ok */ }

  app.get("/api/tasks/:projectId", (req, res) => {
    const path = join(TASKS_DIR, `${req.params.projectId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`)
    if (!existsSync(path)) return res.json(null)
    try {
      res.json(JSON.parse(readFileSync(path, "utf-8")))
    } catch {
      res.json(null)
    }
  })

  app.post("/api/tasks/:projectId", (req, res) => {
    const { requirement, tasks } = req.body
    const store: TaskStore = {
      projectId: req.params.projectId,
      requirement: requirement || "",
      tasks: tasks || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const path = join(TASKS_DIR, `${req.params.projectId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`)
    writeFileSync(path, JSON.stringify(store, null, 2))
    res.json(store)
  })

  app.patch("/api/tasks/:projectId/:taskId", (req, res) => {
    const path = join(TASKS_DIR, `${req.params.projectId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`)
    if (!existsSync(path)) return res.status(404).json({ error: "No tasks" })
    try {
      const store: TaskStore = JSON.parse(readFileSync(path, "utf-8"))
      const taskId = parseInt(req.params.taskId)
      const task = store.tasks.find((t) => t.id === taskId)
      if (!task) return res.status(404).json({ error: "Task not found" })
      if (req.body.status) task.status = req.body.status
      store.updatedAt = Date.now()
      writeFileSync(path, JSON.stringify(store, null, 2))
      res.json(task)
    } catch {
      res.status(500).json({ error: "Cannot update task" })
    }
  })

  // --- Session history ---

  app.get("/api/history/:projectId", (req, res) => {
    res.json(eventStore.getSessionsByProject(req.params.projectId))
  })

  app.get("/api/history/:projectId/:sessionId", (req, res) => {
    const events = eventStore.getSessionEvents(req.params.sessionId)
    res.json(events)
  })

  // --- WebSocket ---

  const clientSessions = new Map<WebSocket, string>()
  const clientEngines = new Map<WebSocket, ParseEngine>()
  const clientEventSessions = new Map<WebSocket, string>()

  // Per-PTY-session state (survives WS reconnects)
  const sessionEngines = new Map<string, ParseEngine>()
  const sessionRecentEvents = new Map<string, AgentEvent[]>()

  // Per-session timer for delayed Resume Session detection
  const resumeTimers = new Map<string, NodeJS.Timeout>()
  const resumeCursorOffset = new Map<string, number>()

  wss.on("connection", (ws, req) => {
    wsAlive.set(ws, true)
    ws.on("pong", () => wsAlive.set(ws, true))

    // Auth check for WebSocket
    const url = new URL(req.url || "/", "http://localhost")
    const token = url.searchParams.get("token") || ""
    if (token && !sessionTokens.has(token)) {
      ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }))
      ws.close()
      return
    }

    ws.on("message", (raw) => {
      let msg: { type: string; [key: string]: unknown }
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      switch (msg.type) {
        case "attach": {
          const projectId = msg.projectId as string
          const project = projects.find((p) => p.id === projectId)
          if (!project) {
            ws.send(JSON.stringify({ type: "error", message: "Project not found" }))
            return
          }

          const agentId = (msg.agentId as string) || "terminal"
          const requestedSessionId = msg.sessionId as string | undefined

          const alreadyExisted = requestedSessionId ? sessions.get(requestedSessionId) !== undefined : false
          const session = sessions.create(project, agentId, requestedSessionId)
          clientSessions.set(ws, session.id)

          // Reuse ParseEngine per PTY session (survives WS reconnects)
          let engine = sessionEngines.get(session.id)
          if (!engine) {
            engine = new ParseEngine(agentId, projectId, project.cwd)
            sessionEngines.set(session.id, engine)
            sessionRecentEvents.set(session.id, [])
          }
          clientEngines.set(ws, engine)

          // Reuse event store session or create new one
          if (!clientEventSessions.has(ws)) {
            const eventSessionId = eventStore.startSession(projectId, agentId)
            clientEventSessions.set(ws, eventSessionId)
          }

          // Send capped scrollback (~80KB) instead of full history
          const scrollback = sessions.getRecentScrollback(session.id)
          if (scrollback) {
            ws.send(JSON.stringify({ type: "scrollback", data: scrollback }))
          }

          // Replay stored events
          let storedEvents = sessionRecentEvents.get(session.id) || []
          if (storedEvents.length === 0) {
            storedEvents = loadPersistedEvents(session.id)
            if (storedEvents.length > 0) {
              sessionRecentEvents.set(session.id, storedEvents)
            }
          }
          if (storedEvents.length === 0) {
            storedEvents = loadProjectEvents(projectId)
            if (storedEvents.length > 0) {
              sessionRecentEvents.set(session.id, [...storedEvents])
            }
          }
          if (storedEvents.length > 0) {
            ws.send(JSON.stringify({ type: "events_replay", events: storedEvents }))
          }

          ws.send(JSON.stringify({ type: "attached", sessionId: session.id, projectName: project.name, agentId, resumed: alreadyExisted }))
          break
        }

        case "input": {
          const sessionId = clientSessions.get(ws)
          if (sessionId) {
            sessions.write(sessionId, msg.data as string)
          }
          break
        }

        case "resize": {
          const sid = clientSessions.get(ws)
          if (sid) sessions.resize(sid, msg.cols as number, msg.rows as number)
          break
        }

        case "scrollback_request": {
          const sid = clientSessions.get(ws)
          if (sid) {
            const reparseLimit = msg.reparse ? 500_000 : 80_000
            const scrollback = sessions.getRecentScrollback(sid, reparseLimit)
            if (scrollback) {
              ws.send(JSON.stringify({ type: "scrollback", data: scrollback }))
            }
            // After resume: scan scrollback for tool calls and create individual events.
            if (scrollback && msg.reparse) {
              const stripped = scrollback
                .replace(/\x1b\[\d+;\d+H/g, "\n")
                .replace(/\x1b\[\d*[ABCD]/g, " ")
                .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
                .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
                .replace(/\x1b\(B/g, "")
              const allEvents: AgentEvent[] = []
              const makeId = () => `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
              const baseTime = Date.now() - 120000

              const toolRe = /\b(Edit|Write|Bash)\(([^)]*)\)/g
              const seen = new Set<string>()
              let tm
              let idx = 0
              while ((tm = toolRe.exec(stripped)) !== null) {
                const tool = tm[1]
                const rawArg = tm[2].replace(/[\r\n]+/g, "").replace(/\s{2,}/g, " ").trim()
                const arg = rawArg.replace(/\s{2,}/g, " ").trim().slice(0, 200)
                if (!arg) continue
                if (tool === "Bash") {
                  if (/^(ls|cat|head|tail|echo|cd|pwd|cp|mv|rm|mkdir|touch|chmod|stat|wc|diff|find|which|type)\b/i.test(arg)) continue
                }
                const sig = `${tool}:${arg.slice(0, 60)}`
                if (seen.has(sig)) continue
                seen.add(sig)
                const typeMap: Record<string, string> = { Edit: "file_edit", Write: "file_create", Bash: "info" }
                const titleMap: Record<string, (a: string) => string> = {
                  Edit: a => `Edited ${a}`,
                  Write: a => `Created ${a}`,
                  Bash: a => `$ ${a.slice(0, 120)}`,
                }
                allEvents.push({
                  id: makeId(),
                  timestamp: baseTime + idx * 2000,
                  type: (typeMap[tool] || "info") as any,
                  status: "completed",
                  title: titleMap[tool](arg),
                  detail: tool === "Bash" ? arg.slice(0, 150) : undefined,
                })
                idx++
              }

              if (allEvents.length > 0) {
                const list = sessionRecentEvents.get(sid)
                if (list) {
                  list.push(...allEvents)
                  if (list.length > 200) list.splice(0, list.length - 200)
                  persistEvents(sid, list)
                }
                for (const event of allEvents) {
                  ws.send(JSON.stringify({ type: "event", event }))
                }
              }
            }
          }
          break
        }

        case "detach": {
          clientSessions.delete(ws)
          break
        }
      }
    })

    ws.on("close", () => {
      const esId = clientEventSessions.get(ws)
      if (esId) eventStore.endSession(esId)
      clientEventSessions.delete(ws)
      clientSessions.delete(ws)
      clientEngines.delete(ws)
    })
  })

  // PTY data -> parse engine -> events -> clients
  sessions.on("data", (sessionId: string, data: string) => {
    const engine = sessionEngines.get(sessionId)
    if (engine) {
      const scrollback = sessions.getRecentScrollback(sessionId, 40_000)
      if (scrollback) engine.setScrollback(scrollback)
      engine.setResumeCursorOffset(resumeCursorOffset.get(sessionId) || 0)
    }
    let events = engine ? engine.feed(data) : []

    // Resume Session TUI detection
    const strippedCheck = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    if (/Resume\s*Session/i.test(strippedCheck) || /Loading\s*conversations/i.test(strippedCheck)) {
      const hasResumeHeader = /Resume\s*Session\s*\(\d+/i.test(strippedCheck)
      if (hasResumeHeader && !resumeTimers.has(sessionId + "_scrolled")) {
        resumeTimers.set(sessionId + "_scrolled", true as any)
        if (!resumeCursorOffset.has(sessionId)) resumeCursorOffset.set(sessionId, 0)
        const scrollDelay = 800
        const downCount = 5
        const keyInterval = 300
        let cancelled = false
        for (let i = 0; i < downCount; i++) {
          setTimeout(() => {
            if (cancelled || !resumeTimers.has(sessionId + "_scrolled")) { cancelled = true; return }
            sessions.write(sessionId, "\x1b[B")
            resumeCursorOffset.set(sessionId, (resumeCursorOffset.get(sessionId) || 0) + 1)
          }, scrollDelay + i * keyInterval)
        }
        const upStart = scrollDelay + downCount * keyInterval + 400
        for (let i = 0; i < downCount - 1; i++) {
          setTimeout(() => {
            if (cancelled || !resumeTimers.has(sessionId + "_scrolled")) { cancelled = true; return }
            sessions.write(sessionId, "\x1b[A")
            resumeCursorOffset.set(sessionId, (resumeCursorOffset.get(sessionId) || 0) - 1)
          }, upStart + i * keyInterval)
        }
      }
      const existing = resumeTimers.get(sessionId)
      if (existing && typeof existing !== "boolean") clearTimeout(existing)
      resumeTimers.set(sessionId, setTimeout(() => {
        resumeTimers.delete(sessionId)
        if (!engine) return
        engine.resetResumeState()
        const scrollback = sessions.getRecentScrollback(sessionId, 40_000)
        if (scrollback) engine.setScrollback(scrollback)
        const finalOffset = resumeCursorOffset.get(sessionId) || 0
        engine.setResumeCursorOffset(finalOffset)
        const delayedEvents = engine.feed("")
        if (delayedEvents.length > 0) {
          const list = sessionRecentEvents.get(sessionId)
          if (list) {
            list.push(...delayedEvents)
            if (list.length > 200) list.splice(0, list.length - 200)
            persistEvents(sessionId, list)
          }
          for (const [client, sid] of clientSessions) {
            if (sid === sessionId && client.readyState === WebSocket.OPEN) {
              for (const event of delayedEvents) {
                client.send(JSON.stringify({ type: "event", event }))
              }
            }
          }
        }
      }, 5000))
    }

    // Store events + persist to disk
    if (events.length > 0) {
      const list = sessionRecentEvents.get(sessionId)
      if (list) {
        list.push(...events)
        if (list.length > 200) list.splice(0, list.length - 200)
        persistEvents(sessionId, list)
      }
    }

    // Send to connected clients
    for (const [client, sid] of clientSessions) {
      if (sid === sessionId && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "output", data }))
        for (const event of events) {
          client.send(JSON.stringify({ type: "event", event }))
        }
        const eventSessionId = clientEventSessions.get(client)
        if (eventSessionId) {
          for (const event of events) {
            eventStore.addEvent(eventSessionId, event)
          }
        }
      }
    }

    // Broadcast session_activity to ALL clients
    if (events.length > 0) {
      const lastEvent = events[events.length - 1]
      const activityMsg = JSON.stringify({
        type: "session_activity",
        sessionId,
        eventTitle: lastEvent.title,
        agentStatus: lastEvent.status === "waiting" ? "waiting" : "working",
      })
      for (const [client] of clientSessions) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(activityMsg)
        }
      }
    }
  })

  sessions.on("exit", (sessionId: string) => {
    sessionEngines.delete(sessionId)
    sessionRecentEvents.delete(sessionId)
    const timer = resumeTimers.get(sessionId)
    if (timer && typeof timer !== "boolean") clearTimeout(timer)
    resumeTimers.delete(sessionId)
    resumeTimers.delete(sessionId + "_scrolled")
    resumeCursorOffset.delete(sessionId)

    for (const [client, sid] of clientSessions) {
      if (sid === sessionId && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "exit", sessionId }))
      }
    }
  })

  // --- Start listening ---

  server.listen(PORT, "0.0.0.0", async () => {
    log.success(`AgentRune running at http://localhost:${PORT}`)
    const localIp = getLocalIp()
    if (localIp !== "127.0.0.1") {
      log.info(`LAN: http://${localIp}:${PORT}`)
    }

    // AgentLore heartbeat
    const agentloreConfig = config.agentlore
    if (agentloreConfig) {
      const cloudTokenPath = join(getConfigDir(), "cloud-token")
      let cloudToken: string
      if (existsSync(cloudTokenPath)) {
        cloudToken = readFileSync(cloudTokenPath, "utf-8").trim()
        sessionTokens.add(cloudToken)
      } else {
        cloudToken = issueSessionToken()
        writeFileSync(cloudTokenPath, cloudToken)
      }
      await agentloreHeartbeat(agentloreConfig.token, agentloreConfig.deviceId, PORT, cloudToken)
      setInterval(() => agentloreHeartbeat(agentloreConfig.token, agentloreConfig.deviceId, PORT, cloudToken), 2 * 60 * 1000)
    }
  })

  return server
}
