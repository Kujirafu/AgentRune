// server/ws-server.ts
// Main WebSocket + HTTP server — ported from AirTerm/server/index.ts
import express from "express"
import { createServer as createHttpServer } from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, appendFile } from "node:fs"
import { join, basename, dirname, isAbsolute } from "node:path"
import { homedir, hostname, networkInterfaces } from "node:os"
import { execSync, spawn as childSpawn } from "node:child_process"
import * as childProcess from "node:child_process"
import { fileURLToPath } from "node:url"
import { PtyManager } from "./pty-manager.js"
import { EventStore } from "./event-store.js"
import { createSessionToken, validateSessionToken, validateDeviceToken, registerDevice, hasPairedDevices } from "./auth.js"
import { readClipboard, writeClipboard } from "./clipboard.js"
import { ParseEngine } from "../adapters/parse-engine.js"
import { JsonlWatcher } from "../adapters/jsonl-watcher.js"
import { CodexWatcher } from "../adapters/codex-watcher.js"
import { GeminiWatcher } from "../adapters/gemini-watcher.js"
import { loadConfig, getConfigDir } from "../shared/config.js"
import { VaultSync } from "./vault-sync.js"
import { ProgressInterceptor } from "./progress-interceptor.js"
import { WorktreeManager } from "./worktree-manager.js"
import { getBehaviorRules, getCommandPrompt } from "./behavior-rules.js"
import { log } from "../shared/logger.js"
import type { AgentEvent, TaskStore, Project } from "../shared/types.js"

// --- Terminal Web UI (desktop sync) ---
function getTerminalHtml(): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>AgentRune Terminal</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a1a2e; height: 100vh; display: flex; flex-direction: column; }
  #header { background: #16213e; color: #e2e8f0; padding: 8px 16px; font: 14px Inter, system-ui, sans-serif;
    display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #2a2a4a; }
  #header .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
  #header .title { font-weight: 600; }
  #header .info { color: #94a3b8; font-size: 12px; margin-left: auto; }
  #terminal { flex: 1; }
  #input-bar { background: #16213e; border-top: 1px solid #2a2a4a; padding: 8px 16px; display: flex; gap: 8px; }
  #input-bar input { flex: 1; background: #1e293b; border: 1px solid #334155; color: #e2e8f0;
    padding: 6px 12px; border-radius: 6px; font: 14px monospace; outline: none; }
  #input-bar input:focus { border-color: #3b82f6; }
  #input-bar button { background: #3b82f6; color: white; border: none; padding: 6px 16px;
    border-radius: 6px; cursor: pointer; font-size: 13px; }
  #input-bar button:hover { background: #2563eb; }
</style>
</head><body>
<div id="header">
  <span class="dot" id="status-dot"></span>
  <span class="title">AgentRune</span>
  <span id="session-info">Connecting...</span>
  <span class="info" id="agent-info"></span>
</div>
<div id="terminal"></div>
<div id="input-bar">
  <input id="cmd" placeholder="Type command or message..." autofocus>
  <button onclick="sendCmd()">Send</button>
</div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script>
const term = new Terminal({ theme: { background: '#1a1a2e', foreground: '#e2e8f0' }, fontSize: 14, cursorBlink: true });
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('terminal'));
fit.fit();
window.addEventListener('resize', () => fit.fit());

// Auto-detect project and agent from existing sessions
let ws, sessionId;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Desktop terminal uses local token — no auth needed for localhost
  ws = new WebSocket(proto + '//' + location.host + '?local=1');
  ws.onopen = () => {
    document.getElementById('status-dot').style.background = '#22c55e';
    document.getElementById('session-info').textContent = 'Connected — select project below';
    // Fetch projects and auto-attach to first one
    fetch('/api/projects').then(r => r.json()).then(projects => {
      if (projects.length > 0) {
        const p = projects[0];
        ws.send(JSON.stringify({ type: 'attach', projectId: p.id, agentId: 'claude' }));
        document.getElementById('session-info').textContent = p.name;
      }
    });
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'attached') {
      sessionId = msg.sessionId;
      document.getElementById('agent-info').textContent = 'Session: ' + sessionId.slice(0, 20) + '...';
    } else if (msg.type === 'output') {
      term.write(msg.data);
    } else if (msg.type === 'scrollback') {
      term.write(msg.data);
    }
  };
  ws.onclose = () => {
    document.getElementById('status-dot').style.background = '#ef4444';
    document.getElementById('session-info').textContent = 'Disconnected — reconnecting...';
    setTimeout(connect, 3000);
  };
}

function sendCmd() {
  const input = document.getElementById('cmd');
  const text = input.value;
  if (!text || !ws) return;
  ws.send(JSON.stringify({ type: 'input', data: text + '\\r' }));
  input.value = '';
}
document.getElementById('cmd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCmd();
});

// Also forward raw keyboard to PTY for interactive use
term.onData((data) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data }));
});

connect();
</script>
</body></html>`
}

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
    // Cap diff data to avoid huge JSON (50KB per field)
    const MAX_DIFF = 50000
    const safeCapped = capped.map(e => {
      if (!e.diff) return e
      const d = e.diff as { filePath: string; before: string; after: string }
      if ((d.before?.length || 0) <= MAX_DIFF && (d.after?.length || 0) <= MAX_DIFF) return e
      return {
        ...e,
        diff: {
          filePath: d.filePath,
          before: d.before?.length > MAX_DIFF ? d.before.slice(0, MAX_DIFF) + "\n... (truncated)" : d.before,
          after: d.after?.length > MAX_DIFF ? d.after.slice(0, MAX_DIFF) + "\n... (truncated)" : d.after,
        },
      }
    })
    const path = join(getEventsDir(), `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`)
    writeFileSync(path, JSON.stringify(safeCapped))
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
    const res = await fetch("https://agentlore.vercel.app/api/agentrune/register", {
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
    if (res.ok) {
      log.info("AgentLore heartbeat OK (port " + port + ")")
    } else {
      const body = await res.text().catch(() => "")
      log.warn("AgentLore heartbeat failed: " + res.status + " " + body.substring(0, 100))
    }
  } catch (err: any) {
    log.warn("AgentLore heartbeat error: " + (err?.message || err))
  }
}

// --- Create server ---

export function createServer(portOverride?: number) {
  const config = loadConfig()
  const PORT = portOverride || config.port || 3456

  const app = express()
  app.use(express.json({ limit: "10mb" }))

  // Serve terminal web UI at root — enables desktop sync terminal
  app.get("/", (_req, res) => {
    res.type("html").send(getTerminalHtml())
  })

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

  // Periodic idle check — inject report_progress prompts for idle agents
  const idleCheckInterval = setInterval(() => {
    for (const [, sid] of clientSessions) {
      const engine = sessionEngines.get(sid)
      const isIdle = engine?.isIdle() ?? false
      const prompt = progressInterceptor.checkInjection(sid, isIdle)
      if (prompt) {
        sessions.write(sid, prompt + "\n")
        log.info(`Injected report_progress prompt for session ${sid}`)
      }
    }
  }, 10_000)
  wss.on("close", () => clearInterval(idleCheckInterval))

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log.warn(`AgentRune is already running on port ${PORT}`)
      process.exit(0)
    }
    throw err
  })

  const sessions = new PtyManager()
  const eventStore = new EventStore()
  const progressInterceptor = new ProgressInterceptor()
  const worktreeManagers = new Map<string, WorktreeManager>()
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

  // --- First-launch pairing code (6 digits, shown in CLI) ---
  let pairingCode: string | null = null
  let pairingCodeExpiry = 0

  function generatePairingCode(): string {
    pairingCode = String(Math.floor(100000 + Math.random() * 900000))
    pairingCodeExpiry = Date.now() + 5 * 60 * 1000 // 5 min expiry
    log.info(`\n  Pairing code: ${pairingCode}\n  (expires in 5 minutes)\n`)
    return pairingCode
  }

  // Generate first pairing code on startup if no devices paired yet
  if (!hasPairedDevices()) {
    generatePairingCode()
  }

  app.get("/api/auth/check", (req, res) => {
    const deviceId = req.query.deviceId as string | undefined
    const isKnown = deviceId ? validateDeviceToken(deviceId, "") === false && hasPairedDevices() : false
    res.json({
      mode: hasPairedDevices() ? "token" : "pairing",
      deviceKnown: !!deviceId,
      hasPairedDevices: hasPairedDevices(),
    })
  })

  // Pair a new device with the 6-digit code shown in CLI
  app.post("/api/auth/pair", (req, res) => {
    const { code, deviceName } = req.body
    if (!code || !deviceName) {
      return res.status(400).json({ error: "Missing code or deviceName" })
    }
    if (!pairingCode || Date.now() > pairingCodeExpiry || code !== pairingCode) {
      return res.status(401).json({ error: "Invalid or expired code" })
    }
    // Code is valid — register device and issue tokens
    const device = registerDevice(deviceName)
    const sessionToken = issueSessionToken()
    pairingCode = null // Invalidate used code
    res.json({
      authenticated: true,
      deviceId: device.deviceId,
      deviceToken: device.token,
      sessionToken,
    })
  })

  // Re-authenticate a previously paired device
  app.post("/api/auth/device", (req, res) => {
    const { deviceId, token } = req.body
    if (!deviceId || !token) {
      return res.status(400).json({ error: "Missing deviceId or token" })
    }
    // Validate persisted device token (survives daemon restart)
    if (validateDeviceToken(deviceId, token)) {
      const sessionToken = issueSessionToken()
      return res.json({ authenticated: true, sessionToken })
    }
    res.status(401).json({ authenticated: false })
  })

  // Generate a new pairing code (for adding more devices)
  app.post("/api/auth/new-code", (_req, res) => {
    const code = generatePairingCode()
    res.json({ code, expiresIn: 300 })
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
    progressInterceptor.untrackSession(req.params.id)
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

  // --- Progress Report (MCP Gate Keeper → APP broadcast) ---

  app.post("/api/progress", express.json(), (req, res) => {
    const report = req.body
    if (!report || !report.title || !report.status) {
      res.status(400).json({ error: "Missing required fields: title, status" })
      return
    }

    const event: AgentEvent = {
      id: `progress_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: "progress_report",
      status: report.status === "done" ? "completed" : report.status === "blocked" ? "failed" : "in_progress",
      title: report.title,
      detail: report.details,
      progress: {
        title: report.title,
        status: report.status,
        summary: report.summary || "",
        nextSteps: report.nextSteps || [],
        details: report.details,
      },
    }

    // Broadcast to ALL connected clients
    for (const [client] of clientSessions) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "event", event }))
      }
    }

    // Write to Obsidian vault if configured
    const cfg = loadConfig()
    if (cfg.vaultPath && event.progress) {
      try {
        // Find the project name from the first connected session's project
        let projectName = "unknown"
        for (const [, sid] of clientSessions) {
          const s = sessions.get(sid)
          if (s) { projectName = s.project.name; break }
        }
        const vault = new VaultSync({ vaultPath: cfg.vaultPath, projectName })
        vault.writeProgress(event.progress)
      } catch { /* vault write failure is non-fatal */ }
    }

    // Mark progress reported for all tracked sessions
    for (const [, sid] of clientSessions) {
      progressInterceptor.onProgressReport(sid)
    }

    res.json({ ok: true })
  })

  // --- Vault Knowledge Endpoints ---

  app.post("/api/vault/prerequisite", express.json(), (req, res) => {
    const { title, content } = req.body
    if (!title || !content) { res.status(400).json({ error: "Missing title or content" }); return }

    const cfg = loadConfig()
    if (!cfg.vaultPath) { res.json({ ok: true, skipped: true }); return }

    try {
      const projectName = resolveProjectName()
      const vault = new VaultSync({ vaultPath: cfg.vaultPath, projectName })
      vault.writePrerequisite(title, content)
    } catch { /* non-fatal */ }

    res.json({ ok: true })
  })

  app.post("/api/vault/decision", express.json(), (req, res) => {
    const { title, decision, alternatives, rationale } = req.body
    if (!title || !decision) { res.status(400).json({ error: "Missing title or decision" }); return }

    const cfg = loadConfig()
    if (!cfg.vaultPath) { res.json({ ok: true, skipped: true }); return }

    try {
      const projectName = resolveProjectName()
      const vault = new VaultSync({ vaultPath: cfg.vaultPath, projectName })
      vault.writeDecision(title, decision, alternatives, rationale)
    } catch { /* non-fatal */ }

    res.json({ ok: true })
  })

  app.get("/api/vault/context", (_req, res) => {
    const cfg = loadConfig()
    if (!cfg.vaultPath) { res.json({ context: "No vault configured. Set vaultPath in ~/.agentrune/config.json" }); return }

    try {
      const projectName = resolveProjectName()
      const vault = new VaultSync({ vaultPath: cfg.vaultPath, projectName })
      res.json({ context: vault.readContext() })
    } catch (err) {
      res.json({ context: `Error reading vault: ${err instanceof Error ? err.message : "unknown"}` })
    }
  })

  // --- Worktree endpoints ---

  app.get("/api/worktrees/:projectId", (req, res) => {
    const wtm = worktreeManagers.get(req.params.projectId)
    if (!wtm) { res.json([]); return }
    res.json(wtm.list())
  })

  /** Resolve current project name from first connected session */
  function resolveProjectName(): string {
    for (const [, sid] of clientSessions) {
      const s = sessions.get(sid)
      if (s) return s.project.name
    }
    return "unknown"
  }

  // --- WebSocket ---

  const clientSessions = new Map<WebSocket, string>()
  const clientEngines = new Map<WebSocket, ParseEngine>()
  const clientEventSessions = new Map<WebSocket, string>()

  // Per-PTY-session state (survives WS reconnects)
  const sessionEngines = new Map<string, ParseEngine>()
  const sessionRecentEvents = new Map<string, AgentEvent[]>()
  const sessionJsonlWatchers = new Map<string, { stop(): void; rescan?(): void; buildResumeOptions?(): AgentEvent | null }>()

  // Per-session timer for delayed Resume Session detection
  const resumeTimers = new Map<string, NodeJS.Timeout>()
  const resumeCursorOffset = new Map<string, number>()
  const resumeDecisionDone = new Set<string>() // Sessions where user already chose a resume option

  wss.on("connection", (ws, req) => {
    wsAlive.set(ws, true)
    ws.on("pong", () => wsAlive.set(ws, true))
    log.info(`WS connection from ${req.socket.remoteAddress} token=${(new URL(req.url || "/", "http://localhost").searchParams.get("token") || "").substring(0, 16)}...`)

    // Auth check for WebSocket
    // Session tokens are persisted to disk, so they survive daemon restarts.
    // If a token is truly expired (>24h), issue a fresh one instead of
    // rejecting — this prevents reconnect loops while keeping auth valid.
    const url = new URL(req.url || "/", "http://localhost")
    const token = url.searchParams.get("token") || ""
    const isLocal = url.searchParams.get("local") === "1" &&
      (req.socket.remoteAddress === "127.0.0.1" || req.socket.remoteAddress === "::1" || req.socket.remoteAddress === "::ffff:127.0.0.1")
    if (!isLocal) {
      if (token && token !== "__open__" && !sessionTokens.has(token) && !validateSessionToken(token)) {
        // Expired/unknown token — issue a fresh one to maintain session
        const freshToken = issueSessionToken()
        sessionTokens.add(freshToken)
        ws.send(JSON.stringify({ type: "token_refresh", sessionToken: freshToken }))
      }
      // Reject connections with no token at all (unauthenticated)
      if (!token) {
        ws.send(JSON.stringify({ type: "error", message: "Authentication required" }))
        ws.close()
        return
      }
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

          // Worktree isolation: if requested, create isolated workspace
          let sessionProject = project
          if (msg.isolated && !requestedSessionId) {
            let wtm = worktreeManagers.get(project.id)
            if (!wtm) {
              wtm = new WorktreeManager(project.cwd)
              worktreeManagers.set(project.id, wtm)
            }
            const tempId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            const wt = wtm.create(tempId, msg.taskSlug as string)
            sessionProject = { ...project, cwd: wt.path }
          }

          const alreadyExisted = requestedSessionId ? sessions.get(requestedSessionId) !== undefined : false
          const session = sessions.create(sessionProject, agentId, requestedSessionId)
          clientSessions.set(ws, session.id)
          progressInterceptor.trackSession(session.id)

          // Reuse ParseEngine per PTY session (survives WS reconnects)
          // ParseEngine now only used for TUI detection (resume menu)
          let engine = sessionEngines.get(session.id)
          if (!engine) {
            engine = new ParseEngine(agentId, projectId, project.cwd)
            sessionEngines.set(session.id, engine)
            sessionRecentEvents.set(session.id, [])
          }
          clientEngines.set(ws, engine)

          // --- Structured session watchers (replace ANSI parsing for supported agents) ---
          // Common callback: store events, send to clients, broadcast activity
          const makeWatcherCallback = (sid: string) => (events: AgentEvent[]) => {
            const list = sessionRecentEvents.get(sid)
            if (list) {
              list.push(...events)
              if (list.length > 200) list.splice(0, list.length - 200)
              persistEvents(sid, list)
            }
            for (const [client, csid] of clientSessions) {
              if (csid === sid && client.readyState === WebSocket.OPEN) {
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
            if (events.length > 0) {
              const lastEvent = events[events.length - 1]
              const activityMsg = JSON.stringify({
                type: "session_activity",
                sessionId: sid,
                eventTitle: lastEvent.title,
                agentStatus: lastEvent.status === "waiting" ? "waiting" : "working",
              })
              for (const [client] of clientSessions) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(activityMsg)
                }
              }
            }

            // Track activity for progress interception
            const hasToolEvents = events.some(e =>
              e.type === "file_edit" || e.type === "file_create" || e.type === "command_run"
            )
            progressInterceptor.onData(sid, hasToolEvents)
          }

          if (!sessionJsonlWatchers.has(session.id)) {
            const sid = session.id
            const cb = makeWatcherCallback(sid)
            let watcher: { stop(): void; rescan?(): void; buildResumeOptions?(): AgentEvent | null } | null = null

            if (agentId === "claude") {
              watcher = new JsonlWatcher(project.cwd, cb)
            } else if (agentId === "codex") {
              watcher = new CodexWatcher(cb)
            } else if (agentId === "gemini") {
              watcher = new GeminiWatcher(project.cwd, cb)
            }

            if (watcher) {
              (watcher as any).start()
              sessionJsonlWatchers.set(sid, watcher)
              log.info(`Session watcher started for ${agentId} session ${sid}`)
            }
          }

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

          // Replay stored events — only for resumed sessions
          if (alreadyExisted) {
            let storedEvents = sessionRecentEvents.get(session.id) || []
            if (storedEvents.length === 0) {
              storedEvents = loadPersistedEvents(session.id)
              if (storedEvents.length > 0) {
                sessionRecentEvents.set(session.id, storedEvents)
              }
            }
            if (storedEvents.length > 0) {
              // Filter out stale "waiting" decision_requests on replay (they'll be re-emitted if still relevant)
              const replayEvents = storedEvents.filter(e =>
                !(e.type === "decision_request" && e.status === "waiting")
              )
              if (replayEvents.length > 0) {
                ws.send(JSON.stringify({ type: "events_replay", events: replayEvents }))
              }
            }
          }

          ws.send(JSON.stringify({ type: "attached", sessionId: session.id, projectName: project.name, agentId, resumed: alreadyExisted }))

          // Inject behavior rules for new sessions (not resumed)
          if (!alreadyExisted) {
            setTimeout(() => {
              const rules = getBehaviorRules()
              sessions.write(session.id, `\n${rules}\n`)
              log.info(`Injected behavior rules for session ${session.id}`)
            }, 2000)  // Wait for agent to initialize
          }
          break
        }

        case "input": {
          const sessionId = clientSessions.get(ws)
          if (sessionId) {
            const inputStr = msg.data as string

            // Reset resume state when user types /resume (allows new resume decision)
            if (/\/resume\b/i.test(inputStr)) {
              resumeDecisionDone.delete(sessionId)
              resumeTimers.delete(sessionId + "_scrolled")
              resumeCursorOffset.delete(sessionId)
            }

            // Detect /command and inject prompt instead of raw text
            const cmdMatch = inputStr.trim().replace(/\r?\n$/, "").match(/^(\/\w+)$/)
            if (cmdMatch) {
              const commandPrompt = getCommandPrompt(cmdMatch[1])
              if (commandPrompt) {
                sessions.write(sessionId, `${commandPrompt}\n`)
                log.info(`Injected /${cmdMatch[1]} command prompt for session ${sessionId}`)
                break
              }
            }

            sessions.write(sessionId, inputStr)
          }
          break
        }

        case "resize": {
          const sid = clientSessions.get(ws)
          if (sid) sessions.resize(sid, msg.cols as number, msg.rows as number)
          break
        }

        case "start_watch": {
          const targetSid = msg.sessionId as string
          if (!targetSid) break
          // Spawn a new terminal window running `agentrune watch --session <id>`
          const watchedSessions = (globalThis as any).__watchedSessions as Set<string> || new Set<string>()
          ;(globalThis as any).__watchedSessions = watchedSessions
          if (watchedSessions.has(targetSid)) {
            log.info(`Watch already active for session ${targetSid.slice(0, 8)}`)
            ws.send(JSON.stringify({ type: "watch_started", sessionId: targetSid, alreadyActive: true }))
            break
          }
          watchedSessions.add(targetSid)
          log.info(`Spawning watch terminal for session ${targetSid.slice(0, 8)}`)
          try {
            const binPath = join(dirname(fileURLToPath(import.meta.url)), "bin.js")
            const cmd = `node "${binPath}" watch --session ${targetSid} --port ${PORT}`
            const { spawn: spawnChild } = childProcess
            let child
            if (process.platform === "win32") {
              try {
                child = spawnChild("wt", ["--title", `AgentRune Watch`, "cmd", "/c", cmd], { detached: true, stdio: "ignore" })
              } catch {
                child = spawnChild("cmd", ["/c", "start", `"AgentRune Watch"`, "cmd", "/c", cmd], { detached: true, stdio: "ignore", shell: true })
              }
            } else {
              // macOS/Linux: try common terminal emulators
              child = spawnChild("bash", ["-c", cmd], { detached: true, stdio: "ignore" })
            }
            child.unref()
            child.on("error", () => watchedSessions.delete(targetSid))
            ws.send(JSON.stringify({ type: "watch_started", sessionId: targetSid }))
          } catch (err: any) {
            log.error(`Failed to spawn watch: ${err.message}`)
            watchedSessions.delete(targetSid)
            ws.send(JSON.stringify({ type: "error", message: `Failed to open watch terminal: ${err.message}` }))
          }
          break
        }

        case "merge_worktree": {
          const sid = msg.sessionId as string
          const s = sessions.get(sid)
          if (!s) { ws.send(JSON.stringify({ type: "worktree_result", success: false, message: "Session not found" })); break }
          const wtm = worktreeManagers.get(s.project.id)
          if (!wtm) { ws.send(JSON.stringify({ type: "worktree_result", success: false, message: "No worktree manager" })); break }
          const result = wtm.merge(sid)
          ws.send(JSON.stringify({ type: "worktree_result", ...result }))
          break
        }

        case "discard_worktree": {
          const sid = msg.sessionId as string
          const s = sessions.get(sid)
          if (!s) { ws.send(JSON.stringify({ type: "worktree_result", success: false, message: "Session not found" })); break }
          const wtm = worktreeManagers.get(s.project.id)
          if (!wtm) { ws.send(JSON.stringify({ type: "worktree_result", success: false, message: "No worktree manager" })); break }
          wtm.cleanup(sid)
          ws.send(JSON.stringify({ type: "worktree_result", success: true, message: "Worktree discarded" }))
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
            // Skip if JSONL watcher is active — it already provides better events with diff data.
            const hasWatcher = sessionJsonlWatchers.has(sid)
            if (scrollback && msg.reparse && !hasWatcher) {
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
              // Find the project for git diff
              const resumeSid = clientSessions.get(ws)
              const resumeProject = resumeSid ? projects.find(p => {
                const prefix = resumeSid.split("_")[0]
                return p.id === prefix
              }) : null
              while ((tm = toolRe.exec(stripped)) !== null) {
                const tool = tm[1]
                const rawArg = tm[2].replace(/[\r\n]+/g, "").replace(/\s{2,}/g, " ").trim()
                const arg = rawArg.replace(/\s{2,}/g, " ").trim().slice(0, 200)
                if (!arg) continue
                if (tool === "Bash") {
                  // Only include meaningful build/test/deploy commands, skip all diagnostic noise
                  if (!/^(npm|npx|yarn|pnpm|make|cargo|go\s|python|pip|docker|git\s|kubectl|terraform|tsc|eslint|jest|vitest|pytest|mvn|gradle)/i.test(arg)) continue
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
                // For file edits, try to get diff from git
                let diff: { filePath: string; before: string; after: string } | undefined
                if ((tool === "Edit" || tool === "Write") && resumeProject?.cwd) {
                  try {
                    const fullPath = isAbsolute(arg) ? arg : join(resumeProject.cwd, arg)
                    let after = ""
                    if (existsSync(fullPath)) {
                      after = readFileSync(fullPath, "utf-8")
                      if (after.length > 50000) after = after.slice(0, 50000) + "\n... (truncated)"
                    }
                    let before = ""
                    try {
                      before = execSync(`git show HEAD:${JSON.stringify(arg)}`, { cwd: resumeProject.cwd, encoding: "utf-8", timeout: 3000 })
                      if (before.length > 50000) before = before.slice(0, 50000) + "\n... (truncated)"
                    } catch { /* new file or not in git */ }
                    if (before || after) {
                      diff = { filePath: arg, before, after }
                    }
                  } catch { /* ignore */ }
                }
                allEvents.push({
                  id: makeId(),
                  timestamp: baseTime + idx * 2000,
                  type: (typeMap[tool] || "info") as any,
                  status: "completed",
                  title: titleMap[tool](arg),
                  detail: tool === "Bash" ? arg.slice(0, 150) : undefined,
                  ...(diff ? { diff } : {}),
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

    // When structured watcher is active, parse engine only provides decision_request events
    // (approval prompts). All tool calls and response text come from JSONL watcher.
    const jsonlWatcher = sessionJsonlWatchers.get(sessionId)
    if (jsonlWatcher) {
      // Filter out events that JSONL watcher already provides (tool calls, response text).
      // Keep: decision_request, test_result, compaction, token usage, and other non-tool events.
      events = events.filter(e => {
        // Resume Session decisions are never emitted by parse engine anymore (signal-only),
        // but filter as safety net in case of stale adapter code
        if (e.type === "decision_request" && /Resume Session/i.test(e.title || "")) return false
        if (e.type === "decision_request") return true
        if (e.type === "test_result") return true
        // Skip tool call events (JSONL watcher handles these better with diff data)
        if (e.type === "file_edit" || e.type === "file_create" || e.type === "command_run") return false
        // Skip parse engine's response text (JSONL watcher has full text)
        if (e.type === "info" && /^Claude responded/i.test(e.title || "")) return false
        // Skip parse engine's tool detection noise
        if (e.type === "info" && /^(Reading|Editing|Creating|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit)\b/i.test(e.title || "")) return false
        // Keep everything else (compaction, token usage, thinking, etc.)
        return true
      })
    }

    // ─── Resume TUI detection (signal-based architecture) ───
    // Parse engine sets ctx.resumeTuiActive = true when it detects Resume Session TUI.
    // ws-server reads that signal and triggers buildResumeOptions (JSONL) or scrollback
    // re-feed (legacy) as the SINGLE source of resume decision events.
    if (engine?.isResumeTuiActive()) {
      engine.clearResumeTuiSignal()

      if (jsonlWatcher?.buildResumeOptions && !resumeDecisionDone.has(sessionId)) {
        // JSONL path: use buildResumeOptions for rich file-system-based session list
        const existing = resumeTimers.get(sessionId)
        if (existing && typeof existing !== "boolean") clearTimeout(existing)
        resumeTimers.set(sessionId, setTimeout(() => {
          resumeTimers.delete(sessionId)
          if (resumeDecisionDone.has(sessionId)) return
          const resumeEvent = jsonlWatcher.buildResumeOptions?.()
          if (resumeEvent) {
            resumeDecisionDone.add(sessionId)
            const list = sessionRecentEvents.get(sessionId)
            if (list) {
              list.push(resumeEvent)
              if (list.length > 200) list.splice(0, list.length - 200)
              persistEvents(sessionId, list)
            }
            for (const [client, sid] of clientSessions) {
              if (sid === sessionId && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "event", event: resumeEvent }))
              }
            }
          }
        }, 2000))
      } else if (!jsonlWatcher && !resumeDecisionDone.has(sessionId)) {
        // Legacy path (non-JSONL agents): scroll TUI to discover options, then re-feed
        const strippedCheck = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
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
          if (resumeDecisionDone.has(sessionId)) return
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
    }

    // Mark resume decision as done once emitted (prevent re-emission on app switch)
    for (const evt of events) {
      if (evt.type === "decision_request" && /Resume Session/i.test(evt.title)) {
        resumeDecisionDone.add(sessionId)
      }
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
    progressInterceptor.untrackSession(sessionId)
    sessionEngines.delete(sessionId)
    sessionRecentEvents.delete(sessionId)
    const watcher = sessionJsonlWatchers.get(sessionId)
    if (watcher) { watcher.stop(); sessionJsonlWatchers.delete(sessionId) }
    const timer = resumeTimers.get(sessionId)
    if (timer && typeof timer !== "boolean") clearTimeout(timer)
    resumeTimers.delete(sessionId)
    resumeTimers.delete(sessionId + "_scrolled")
    resumeCursorOffset.delete(sessionId)
    resumeDecisionDone.delete(sessionId)

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
      } else {
        cloudToken = createSessionToken("cloud")
        writeFileSync(cloudTokenPath, cloudToken)
      }
      // Ensure cloud token is always valid (persisted in auth.ts)
      if (!validateSessionToken(cloudToken)) {
        // Re-register if expired or missing from persisted tokens
        const fresh = createSessionToken("cloud")
        cloudToken = fresh
        writeFileSync(cloudTokenPath, cloudToken)
      }
      sessionTokens.add(cloudToken)
      await agentloreHeartbeat(agentloreConfig.token, agentloreConfig.deviceId, PORT, cloudToken)
      setInterval(() => agentloreHeartbeat(agentloreConfig.token, agentloreConfig.deviceId, PORT, cloudToken), 2 * 60 * 1000)
    }
  })

  return server
}
