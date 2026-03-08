// server/ws-server.ts
// Main WebSocket + HTTP server — ported from AirTerm/server/index.ts
import express from "express"
import { createServer as createHttpServer } from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, appendFile, unlinkSync, openSync, readSync, closeSync } from "node:fs"
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
import { AutomationManager } from "./automation-manager.js"
import { getCommandPrompt, getProjectMemory, updateProjectMemory, getMemoryPath } from "./behavior-rules.js"
import { loadVaultKeys, saveVaultKey, deleteVaultKey, listVaultKeyNames } from "./vault-keys.js"
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

async function agentloreHeartbeat(token: string, deviceId: string, port: number, cloudToken?: string, tunnelUrl?: string) {
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
        tunnelUrl: tunnelUrl || undefined,
      }),
    })
    if (res.ok) {
      log.info("AgentLore heartbeat OK (port " + port + (tunnelUrl ? `, tunnel: ${tunnelUrl}` : "") + ")")
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

  // CORS — allow cross-origin requests (phone app via tunnel)
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Agent-Id, X-Api-Keys")
    if (_req.method === "OPTIONS") return res.sendStatus(204)
    next()
  })

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

  let listenRetries = 0
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      listenRetries++
      if (listenRetries <= 5) {
        log.warn(`Port ${PORT} busy, retrying in 2s... (${listenRetries}/5)`)
        setTimeout(() => server.listen(PORT), 2000)
      } else {
        log.error(`Port ${PORT} still in use after 5 retries. Is another instance running?`)
        process.exit(1)
      }
      return
    }
    throw err
  })

  const sessions = new PtyManager()
  const eventStore = new EventStore()
  const progressInterceptor = new ProgressInterceptor()
  const worktreeManagers = new Map<string, WorktreeManager>()
  const projects = loadProjects()
  const automationManager = new AutomationManager(sessions, projects)

  // --- CORS ---
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
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

  // Cloud auth — phone app sends its AgentLore phone token,
  // CLI verifies the token owns this device, then issues a session token.
  app.post("/api/auth/cloud", async (req, res) => {
    const { phoneToken } = req.body
    if (!phoneToken) {
      return res.status(400).json({ error: "Missing phoneToken" })
    }
    const agentloreConfig = config.agentlore
    if (!agentloreConfig) {
      return res.status(403).json({ error: "This server is not linked to AgentLore" })
    }
    try {
      // Verify the phone token by calling AgentLore devices API
      // If the token is valid AND this device is registered under the same user, grant access
      const verifyRes = await fetch("https://agentlore.vercel.app/api/agentrune/devices", {
        headers: { Authorization: `Bearer ${phoneToken}` },
      })
      if (!verifyRes.ok) {
        return res.status(401).json({ error: "Invalid phone token" })
      }
      const data = await verifyRes.json()
      const devices: any[] = data.data?.devices ?? []
      // Check if this CLI server's deviceId is in the user's device list
      const myDevice = devices.find((d: any) => d.deviceId === agentloreConfig.deviceId)
      if (!myDevice) {
        return res.status(403).json({ error: "Device not registered under this account" })
      }
      // Phone token is valid and owns this device — issue a session token
      const sessionToken = issueSessionToken()
      res.json({ authenticated: true, sessionToken })
    } catch (err: any) {
      res.status(500).json({ error: "Verification failed: " + (err?.message || "unknown") })
    }
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

  app.delete("/api/projects/:id", (req, res) => {
    const idx = projects.findIndex((p) => p.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: "Project not found" })
    projects.splice(idx, 1)
    writeFileSync(getProjectsPath(), JSON.stringify(projects, null, 2))
    res.json({ ok: true })
  })

  app.get("/api/sessions", (_req, res) => {
    const allSessions = sessions.getAll().map((s) => {
      // Attach worktree branch info if available
      const wtm = worktreeManagers.get(s.projectId)
      const wt = wtm?.get(s.id)
      return { ...s, worktreeBranch: wt?.branch || null }
    })
    res.json(allSessions)
  })

  // List past agent sessions for a project — supports all agents with session history
  app.get("/api/agent-sessions/:projectId/:agentId", (req, res) => {
    try {
      const projectId = req.params.projectId
      const agentId = req.params.agentId
      const project = projects.find((p) => p.id === projectId)
      if (!project) return res.status(404).json({ error: "Project not found" })

      // Convert project cwd to folder name (used by Claude Code, Cursor, etc.)
      const cwdDirName = project.cwd
        .replaceAll("\\", "-")
        .replaceAll("/", "-")
        .replaceAll(":", "-")
        .replace(/^-/, "")

      // Helper: parse JSONL files for session summary (first 16KB only)
      const parseJsonlSessions = (dir: string, perProject: boolean): { sessionId: string; slug: string; firstUserMessage: string; messageCount: number; lastModified: number; sizeBytes: number }[] => {
        if (!existsSync(dir)) return []
        const jsonlFiles = perProject
          ? readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"))
          : findJsonlRecursive(dir)
        return jsonlFiles.map((f: string) => {
          const filePath = perProject ? join(dir, f) : f
          const stat = statSync(filePath)
          const sessionId = basename(filePath, ".jsonl")
            .replace(/^rollout-\d{4}-\d{2}-\d{2}T[\d-]*-/, "") // strip Codex date prefix
          let firstUserMessage = ""
          let slug = ""
          let messageCount = 0
          try {
            const fd = openSync(filePath, "r")
            const buf = Buffer.alloc(16384)
            const bytesRead = readSync(fd, buf, 0, 16384, 0)
            closeSync(fd)
            const chunk = buf.toString("utf-8", 0, bytesRead)
            for (const line of chunk.split("\n")) {
              if (!line.trim()) continue
              try {
                const entry = JSON.parse(line)
                if (entry.type === "user" || entry.type === "assistant") messageCount++
                if (entry.slug && !slug) slug = entry.slug
                if (entry.thread_name && !slug) slug = entry.thread_name  // Codex format
                if (entry.type === "user" && !firstUserMessage && entry.message?.content) {
                  const text = typeof entry.message.content === "string"
                    ? entry.message.content
                    : Array.isArray(entry.message.content)
                      ? entry.message.content.find((b: { type: string; text?: string }) => b.type === "text")?.text || ""
                      : ""
                  firstUserMessage = text.slice(0, 200)
                }
                if (firstUserMessage && slug) break
              } catch { /* skip malformed/truncated lines */ }
            }
          } catch { /* skip unreadable files */ }
          return { sessionId, slug, firstUserMessage, messageCount, lastModified: stat.mtimeMs, sizeBytes: stat.size }
        })
        .filter((s) => s.firstUserMessage || s.slug)
        .sort((a, b) => b.lastModified - a.lastModified)
        .slice(0, 20)
      }

      // Helper: find JSONL files recursively (for Codex date-tree structure)
      const findJsonlRecursive = (dir: string): string[] => {
        const results: string[] = []
        const walk = (d: string) => {
          if (!existsSync(d)) return
          for (const entry of readdirSync(d)) {
            const full = join(d, entry)
            try {
              const s = statSync(full)
              if (s.isDirectory()) walk(full)
              else if (entry.endsWith(".jsonl")) results.push(full)
            } catch { /* skip */ }
          }
        }
        walk(dir)
        return results
      }

      let sessions: ReturnType<typeof parseJsonlSessions> = []

      if (agentId === "claude") {
        // Claude Code: ~/.claude/projects/<cwdDirName>/*.jsonl
        sessions = parseJsonlSessions(join(homedir(), ".claude", "projects", cwdDirName), true)
      } else if (agentId === "codex") {
        // Codex: sessions are global in ~/.codex/sessions/YYYY/MM/DD/*.jsonl
        // Each session has session_meta with cwd — filter by project cwd
        const indexPath = join(homedir(), ".codex", "session_index.jsonl")
        const indexSessions: { id: string; thread_name: string }[] = []
        if (existsSync(indexPath)) {
          try {
            const content = readFileSync(indexPath, "utf-8")
            for (const line of content.split("\n")) {
              if (!line.trim()) continue
              try { indexSessions.push(JSON.parse(line)) } catch { /* skip */ }
            }
          } catch { /* skip */ }
        }
        // Scan all session files, filter by project cwd
        const allCodexSessions = findJsonlRecursive(join(homedir(), ".codex", "sessions"))
        const projectCwd = project.cwd.replace(/\\/g, "/").toLowerCase()
        for (const filePath of allCodexSessions) {
          try {
            const fd = openSync(filePath, "r")
            const buf = Buffer.alloc(16384)
            const bytesRead = readSync(fd, buf, 0, 16384, 0)
            closeSync(fd)
            const chunk = buf.toString("utf-8", 0, bytesRead)
            let sessionCwd = ""
            let sessionId = ""
            let firstUserMessage = ""
            let slug = ""
            for (const line of chunk.split("\n")) {
              if (!line.trim()) continue
              try {
                const entry = JSON.parse(line)
                if (entry.type === "session_meta" && entry.payload?.cwd) {
                  sessionCwd = entry.payload.cwd.replace(/\\/g, "/").toLowerCase()
                  sessionId = entry.payload.id || basename(filePath, ".jsonl")
                }
                if (entry.type === "response_item" && entry.payload?.role === "user" && !firstUserMessage) {
                  const content = entry.payload.content
                  if (Array.isArray(content)) {
                    const textItem = content.find((c: { type: string; text?: string }) => c.type === "input_text")
                    if (textItem?.text) firstUserMessage = textItem.text.slice(0, 200)
                  }
                }
                if (sessionCwd && firstUserMessage) break
              } catch { /* skip */ }
            }
            // Only include sessions for this project
            if (sessionCwd === projectCwd && sessionId) {
              const stat = statSync(filePath)
              const idx = indexSessions.find(i => sessionId.includes(i.id))
              sessions.push({
                sessionId,
                slug: idx?.thread_name || slug,
                firstUserMessage,
                messageCount: 0,
                lastModified: stat.mtimeMs,
                sizeBytes: stat.size,
              })
            }
          } catch { /* skip */ }
        }
        sessions = sessions.sort((a, b) => b.lastModified - a.lastModified).slice(0, 20)
      } else if (agentId === "gemini") {
        // Gemini CLI: ~/.gemini/history/<name>/ — structure varies
        const historyDir = join(homedir(), ".gemini", "history")
        if (existsSync(historyDir)) {
          // Try project-specific folder first, then all
          for (const sub of readdirSync(historyDir)) {
            const subPath = join(historyDir, sub)
            try {
              if (statSync(subPath).isDirectory()) {
                const found = parseJsonlSessions(subPath, true)
                sessions.push(...found)
              }
            } catch { /* skip */ }
          }
          sessions = sessions.sort((a, b) => b.lastModified - a.lastModified).slice(0, 20)
        }
      } else if (agentId === "cursor") {
        // Cursor Agent: ~/.cursor/projects/<cwdDirName>/
        const cursorCwdDir = project.cwd
          .replaceAll("\\", "-")
          .replaceAll("/", "-")
          .replaceAll(":", "")
          .replace(/^-/, "")
        const cursorPath = join(homedir(), ".cursor", "projects", cursorCwdDir)
        sessions = parseJsonlSessions(cursorPath, false)
      }

      res.json(sessions)
    } catch (err) {
      log.error("Error listing agent sessions:", err)
      res.status(500).json({ error: "Failed to list sessions", detail: String(err) })
    }
  })

  // Get conversation history for a specific agent session (for preview before resume)
  app.get("/api/agent-sessions/:projectId/:agentId/:sessionId/messages", (req, res) => {
    try {
      const { projectId, agentId, sessionId } = req.params
      const project = projects.find((p) => p.id === projectId)
      if (!project) return res.status(404).json({ error: "Project not found" })

      const cwdDirName = project.cwd
        .replaceAll("\\", "-")
        .replaceAll("/", "-")
        .replaceAll(":", "-")
        .replace(/^-/, "")

      let filePath = ""

      if (agentId === "claude") {
        filePath = join(homedir(), ".claude", "projects", cwdDirName, `${sessionId}.jsonl`)
      } else if (agentId === "codex") {
        // Codex: need to find the file containing this session ID
        const findCodexFile = (dir: string): string => {
          if (!existsSync(dir)) return ""
          for (const entry of readdirSync(dir)) {
            const full = join(dir, entry)
            try {
              const s = statSync(full)
              if (s.isDirectory()) { const r = findCodexFile(full); if (r) return r }
              else if (entry.includes(sessionId)) return full
            } catch { /* skip */ }
          }
          return ""
        }
        filePath = findCodexFile(join(homedir(), ".codex", "sessions"))
      }

      if (!filePath || !existsSync(filePath)) {
        return res.status(404).json({ error: "Session not found" })
      }

      // Parse messages — read up to 512KB for preview
      const fd = openSync(filePath, "r")
      const buf = Buffer.alloc(524288)
      const bytesRead = readSync(fd, buf, 0, 524288, 0)
      closeSync(fd)
      const chunk = buf.toString("utf-8", 0, bytesRead)

      const messages: { role: string; text: string; timestamp?: string }[] = []
      const seenMsgIds = new Set<string>()

      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue
        try {
          const entry = JSON.parse(line)

          if (entry.type === "user" && entry.message?.content) {
            const text = typeof entry.message.content === "string"
              ? entry.message.content
              : Array.isArray(entry.message.content)
                ? entry.message.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n")
                : ""
            if (text.trim()) {
              messages.push({ role: "user", text: text.slice(0, 500), timestamp: entry.timestamp })
            }
          }

          if (entry.type === "assistant" && entry.message?.content) {
            // Deduplicate: assistant messages stream as multiple JSONL lines with same message.id
            const msgId = entry.message.id
            if (msgId && seenMsgIds.has(msgId)) continue
            if (msgId) seenMsgIds.add(msgId)

            const textBlocks = Array.isArray(entry.message.content)
              ? entry.message.content.filter((b: { type: string }) => b.type === "text")
              : []
            const text = textBlocks.map((b: { text: string }) => b.text).join("\n")
            if (text.trim()) {
              messages.push({ role: "assistant", text: text.slice(0, 500), timestamp: entry.timestamp })
            }
          }

          // Codex format
          if (entry.type === "response_item" && entry.payload?.role === "user") {
            const content = entry.payload.content
            if (Array.isArray(content)) {
              const text = content.filter((c: { type: string }) => c.type === "input_text").map((c: { text: string }) => c.text).join("\n")
              if (text.trim()) messages.push({ role: "user", text: text.slice(0, 500), timestamp: entry.timestamp })
            }
          }
          if (entry.type === "response_item" && entry.payload?.role === "assistant") {
            const content = entry.payload.content
            if (Array.isArray(content)) {
              const text = content.filter((c: { type: string }) => c.type === "output_text").map((c: { text: string }) => c.text).join("\n")
              if (text.trim()) messages.push({ role: "assistant", text: text.slice(0, 500), timestamp: entry.timestamp })
            }
          }
        } catch { /* skip */ }
      }

      res.json(messages)
    } catch (err) {
      log.error("Error reading session messages:", err)
      res.status(500).json({ error: "Failed to read messages", detail: String(err) })
    }
  })

  app.post("/api/sessions/:id/kill", (req, res) => {
    const killId = req.params.id
    // Cleanup worktree before killing PTY
    const killSession = sessions.get(killId)
    if (killSession) {
      const wtm = worktreeManagers.get(killSession.project.id)
      if (wtm) wtm.cleanup(killId)
    }
    sessions.kill(killId)
    progressInterceptor.untrackSession(killId)
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

  // --- Image upload ---
  // Save base64 image to project temp dir so Claude Code can read it
  app.post("/api/upload", (req, res) => {
    try {
      const { projectId, data, filename } = req.body
      if (!data || !filename) {
        return res.status(400).json({ error: "Missing data or filename" })
      }
      // Find project cwd
      const project = projects.find(p => p.id === projectId)
      const targetDir = project ? project.cwd : homedir()
      const uploadDir = join(targetDir, ".agentrune", "uploads")
      mkdirSync(uploadDir, { recursive: true })
      // Strip data URI prefix if present
      const base64Data = data.replace(/^data:image\/\w+;base64,/, "")
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
      const filePath = join(uploadDir, `${Date.now()}_${safeName}`)
      writeFileSync(filePath, Buffer.from(base64Data, "base64"))
      res.json({ path: filePath })
    } catch (err) {
      log.error(`Upload failed: ${err instanceof Error ? err.message : "unknown"}`)
      res.status(500).json({ error: "Upload failed" })
    }
  })

  // --- Voice cleanup ---

  app.post("/api/voice-cleanup", express.json(), async (req, res) => {
    const { text, agentId, apiKeys } = req.body
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Missing text" })
    }
    // Allow frontend to pass API keys (from app settings)
    if (apiKeys && typeof apiKeys === "object") {
      for (const [k, v] of Object.entries(apiKeys)) {
        if (typeof v === "string" && v && !process.env[k]) {
          process.env[k] = v
        }
      }
    }
    try {
      const { cleanupVoiceText } = await import("./voice-cleanup.js")
      const result = await cleanupVoiceText(text, agentId || "claude")
      res.json(result)
    } catch (e: any) {
      log.error(`Voice cleanup error: ${e.message}`)
      res.status(500).json({ error: e.message, original: text, cleaned: text.trim() })
    }
  })

  // --- Voice transcribe (local Whisper STT) ---

  app.post("/api/voice-transcribe", async (req, res) => {
    // Accepts raw audio body (webm/ogg from MediaRecorder)
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", async () => {
      const audioBuffer = Buffer.concat(chunks)
      if (audioBuffer.length < 100) {
        return res.status(400).json({ error: "No audio data" })
      }

      const tmpDir = join(homedir(), ".agentrune", "whisper", "tmp")
      if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
      const ts = Date.now()
      const inputPath = join(tmpDir, `voice-${ts}.webm`)
      const wavPath = join(tmpDir, `voice-${ts}.wav`)

      try {
        writeFileSync(inputPath, audioBuffer)
        const { convertToWav, transcribeAudio } = await import("./whisper-stt.js")
        await convertToWav(inputPath, wavPath)
        const result = await transcribeAudio(wavPath)

        // Convert Simplified → Traditional Chinese (Whisper base model outputs Simplified)
        let rawText = result.text
        try {
          const OpenCC = await import("opencc-js")
          const s2t = OpenCC.Converter({ from: "cn", to: "tw" })
          rawText = s2t(rawText)
        } catch (e: any) {
          log.warn(`OpenCC s2t failed: ${e.message}`)
        }

        // Optionally run LLM cleanup on the result
        const agentId = req.headers["x-agent-id"] as string || "claude"
        let cleaned = rawText
        if (rawText.trim()) {
          try {
            const { cleanupVoiceText } = await import("./voice-cleanup.js")
            const apiKeys: Record<string, string> = {}
            const rawKeys = req.headers["x-api-keys"] as string
            if (rawKeys) try { Object.assign(apiKeys, JSON.parse(rawKeys)) } catch {}
            for (const [k, v] of Object.entries(apiKeys)) {
              if (typeof v === "string" && v && !process.env[k]) process.env[k] = v
            }
            const cleanup = await cleanupVoiceText(rawText, agentId)
            cleaned = cleanup.cleaned
          } catch (e: any) {
            log.warn(`Voice cleanup after transcribe failed: ${e.message}`)
          }
        }

        res.json({ text: rawText, cleaned, model: result.model, duration_ms: result.duration_ms })
      } catch (e: any) {
        log.error(`Voice transcribe error: ${e.message}`)
        res.status(500).json({ error: e.message })
      } finally {
        // Cleanup temp files
        try { unlinkSync(inputPath) } catch {}
        try { unlinkSync(wavPath) } catch {}
      }
    })
  })

  // Whisper status + setup
  app.get("/api/whisper-status", async (_req, res) => {
    try {
      const { isWhisperReady } = await import("./whisper-stt.js")
      res.json({ ready: isWhisperReady() })
    } catch { res.json({ ready: false }) }
  })

  app.post("/api/whisper-setup", async (_req, res) => {
    try {
      const { setupWhisper } = await import("./whisper-stt.js")
      const result = await setupWhisper()
      res.json({ ok: true, ...result })
    } catch (e: any) {
      log.error(`Whisper setup error: ${e.message}`)
      res.status(500).json({ error: e.message })
    }
  })

  // --- Voice edit (apply voice instruction to modify text) ---
  app.post("/api/voice-edit", express.json(), async (req, res) => {
    const { original, instruction } = req.body || {}
    if (!original || !instruction) {
      return res.status(400).json({ error: "Missing original or instruction" })
    }
    try {
      const { applyVoiceEdit } = await import("./voice-cleanup.js")
      const result = await applyVoiceEdit(original, instruction)
      res.json({ edited: result })
    } catch (e: any) {
      log.error(`Voice edit error: ${e.message}`)
      res.status(500).json({ error: e.message, edited: original })
    }
  })

  // --- Voice cleanup (LLM only, no whisper — for native STT results) ---
  app.post("/api/voice-cleanup", express.json(), async (req, res) => {
    const { text } = req.body || {}
    if (!text?.trim()) return res.status(400).json({ error: "Missing text" })
    const agentId = req.headers["x-agent-id"] as string || "claude"
    try {
      const { cleanupVoiceText } = await import("./voice-cleanup.js")
      const result = await cleanupVoiceText(text, agentId)
      res.json({ cleaned: result.cleaned, model: result.model, provider: result.provider })
    } catch (e: any) {
      log.warn(`Voice cleanup error: ${e.message}`)
      res.json({ cleaned: text })
    }
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

  // --- Diff Detail: structured hunks for a file ---
  app.get("/api/git/diff-detail", (req, res) => {
    const projectId = req.query.project as string
    const file = req.query.file as string
    const project = projects.find((p) => p.id === projectId)
    if (!project || !file) return res.status(400).json({ error: "Missing project or file" })

    try {
      // Get unified diff (staged + unstaged)
      let rawDiff = ""
      try {
        rawDiff = execSync(`git diff HEAD -- ${JSON.stringify(file)}`, { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
      } catch { /* new file or no HEAD */ }

      // If no diff against HEAD, try diff for untracked/new files
      if (!rawDiff) {
        try {
          rawDiff = execSync(`git diff --no-index /dev/null ${JSON.stringify(file)}`, { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
        } catch (e: unknown) {
          // git diff --no-index exits with 1 when there are differences
          if (e && typeof e === "object" && "stdout" in e) rawDiff = (e as { stdout: string }).stdout || ""
        }
      }

      // Check staged status
      let stagedRaw = ""
      try {
        stagedRaw = execSync(`git diff --cached -- ${JSON.stringify(file)}`, { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
      } catch { /* ok */ }
      const isFullyStaged = !!stagedRaw && !execSync(`git diff -- ${JSON.stringify(file)}`, { cwd: project.cwd, encoding: "utf-8", timeout: 5000 }).trim()

      // Parse hunks from raw diff
      interface Hunk {
        id: number
        header: string
        startLineBefore: number
        startLineAfter: number
        content: string
        lines: string[]
        staged: boolean
      }

      const hunks: Hunk[] = []
      const hunkRegex = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/
      let hunkId = 0

      if (rawDiff) {
        const diffLines = rawDiff.split("\n")
        let currentHunk: Hunk | null = null

        for (const line of diffLines) {
          const match = line.match(hunkRegex)
          if (match) {
            if (currentHunk) hunks.push(currentHunk)
            currentHunk = {
              id: hunkId++,
              header: line,
              startLineBefore: parseInt(match[1], 10),
              startLineAfter: parseInt(match[2], 10),
              content: match[3] ? match[3].trim() : "",
              lines: [],
              staged: isFullyStaged,
            }
          } else if (currentHunk && !line.startsWith("diff ") && !line.startsWith("index ") && !line.startsWith("---") && !line.startsWith("+++")) {
            currentHunk.lines.push(line)
          }
        }
        if (currentHunk) hunks.push(currentHunk)
      }

      res.json({ file, hunks, isFullyStaged })
    } catch {
      res.status(500).json({ error: "Cannot parse diff" })
    }
  })

  // --- Stage file or specific hunks ---
  app.post("/api/git/stage", express.json(), (req, res) => {
    const { project: projectId, filePath, hunks } = req.body as { project: string; filePath: string; hunks?: number[] }
    const project = projects.find((p) => p.id === projectId)
    if (!project || !filePath) return res.status(400).json({ error: "Missing project or filePath" })

    try {
      if (!hunks || hunks.length === 0) {
        // Stage entire file
        execSync(`git add ${JSON.stringify(filePath)}`, { cwd: project.cwd, timeout: 5000 })
        res.json({ ok: true, message: `Staged ${filePath}` })
      } else {
        // Stage specific hunks via git apply
        // Get the full diff first
        let rawDiff = ""
        try {
          rawDiff = execSync(`git diff -- ${JSON.stringify(filePath)}`, { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
        } catch { /* ok */ }

        if (!rawDiff) {
          // File might be untracked, just stage it
          execSync(`git add ${JSON.stringify(filePath)}`, { cwd: project.cwd, timeout: 5000 })
          return res.json({ ok: true, message: `Staged ${filePath}` })
        }

        // Parse and filter hunks
        const diffLines = rawDiff.split("\n")
        const header: string[] = []
        const allHunks: string[][] = []
        let currentHunk: string[] = []
        let hunkIdx = -1

        for (const line of diffLines) {
          if (line.startsWith("@@")) {
            if (currentHunk.length > 0) allHunks.push(currentHunk)
            currentHunk = [line]
            hunkIdx++
          } else if (hunkIdx === -1) {
            header.push(line)
          } else {
            currentHunk.push(line)
          }
        }
        if (currentHunk.length > 0) allHunks.push(currentHunk)

        // Build partial patch with only requested hunks
        const patchLines = [...header]
        for (const idx of hunks) {
          if (idx < allHunks.length) {
            patchLines.push(...allHunks[idx])
          }
        }
        patchLines.push("") // trailing newline

        const patchContent = patchLines.join("\n")
        execSync("git apply --cached -", { cwd: project.cwd, input: patchContent, timeout: 5000 })

        res.json({ ok: true, message: `Staged ${hunks.length} hunk(s) of ${filePath}` })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Stage failed"
      res.status(500).json({ error: msg })
    }
  })

  // --- Revert file or specific hunks ---
  app.post("/api/git/revert", express.json(), (req, res) => {
    const { project: projectId, filePath, hunks } = req.body as { project: string; filePath: string; hunks?: number[] }
    const project = projects.find((p) => p.id === projectId)
    if (!project || !filePath) return res.status(400).json({ error: "Missing project or filePath" })

    try {
      if (!hunks || hunks.length === 0) {
        // Revert entire file
        // Check if file is tracked
        try {
          execSync(`git ls-files --error-unmatch ${JSON.stringify(filePath)}`, { cwd: project.cwd, timeout: 5000, stdio: "pipe" })
          execSync(`git checkout HEAD -- ${JSON.stringify(filePath)}`, { cwd: project.cwd, timeout: 5000 })
        } catch {
          // Untracked file — cannot revert via git, would need to delete
          return res.status(400).json({ error: "Cannot revert untracked file" })
        }
        res.json({ ok: true, message: `Reverted ${filePath}` })
      } else {
        // Revert specific hunks via git apply --reverse
        let rawDiff = ""
        try {
          rawDiff = execSync(`git diff -- ${JSON.stringify(filePath)}`, { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
        } catch { /* ok */ }

        if (!rawDiff) {
          return res.status(400).json({ error: "No diff to revert" })
        }

        const diffLines = rawDiff.split("\n")
        const header: string[] = []
        const allHunks: string[][] = []
        let currentHunk: string[] = []
        let hunkIdx = -1

        for (const line of diffLines) {
          if (line.startsWith("@@")) {
            if (currentHunk.length > 0) allHunks.push(currentHunk)
            currentHunk = [line]
            hunkIdx++
          } else if (hunkIdx === -1) {
            header.push(line)
          } else {
            currentHunk.push(line)
          }
        }
        if (currentHunk.length > 0) allHunks.push(currentHunk)

        const patchLines = [...header]
        for (const idx of hunks) {
          if (idx < allHunks.length) {
            patchLines.push(...allHunks[idx])
          }
        }
        patchLines.push("")

        const patchContent = patchLines.join("\n")
        execSync("git apply --reverse -", { cwd: project.cwd, input: patchContent, timeout: 5000 })

        res.json({ ok: true, message: `Reverted ${hunks.length} hunk(s) of ${filePath}` })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Revert failed"
      res.status(500).json({ error: msg })
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

  // --- Branch management ---

  app.get("/api/git/branches", (req, res) => {
    const projectId = req.query.project as string
    const project = projects.find((p) => p.id === projectId)
    if (!project) return res.status(404).json({ error: "Project not found" })

    try {
      const raw = execSync("git branch -a --no-color", { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
      const branches = raw.split("\n").filter(Boolean).map((l) => {
        const current = l.startsWith("* ")
        const name = l.replace(/^\*?\s+/, "").trim()
        const isRemote = name.startsWith("remotes/")
        return { name: isRemote ? name.replace("remotes/", "") : name, current, isRemote }
      })
      res.json({ branches })
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list branches" })
    }
  })

  app.post("/api/git/branch-delete", express.json(), (req, res) => {
    const { project: projectId, branch, force } = req.body
    const proj = projects.find((p) => p.id === projectId)
    if (!proj || !branch) return res.status(400).json({ error: "Missing project or branch" })

    try {
      const flag = force ? "-D" : "-d"
      execSync(`git branch ${flag} ${JSON.stringify(branch)}`, { cwd: proj.cwd, encoding: "utf-8", timeout: 5000 })
      res.json({ ok: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Delete failed"
      if (msg.includes("not fully merged")) {
        res.status(409).json({ error: "Branch not fully merged. Use force delete.", notMerged: true })
      } else {
        res.status(500).json({ error: msg })
      }
    }
  })

  app.post("/api/git/branch-checkout", express.json(), (req, res) => {
    const { project: projectId, branch } = req.body
    const proj = projects.find((p) => p.id === projectId)
    if (!proj || !branch) return res.status(400).json({ error: "Missing project or branch" })

    try {
      execSync(`git checkout ${JSON.stringify(branch)}`, { cwd: proj.cwd, encoding: "utf-8", timeout: 10000 })
      res.json({ ok: true })
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Checkout failed" })
    }
  })

  // --- Worktree management ---

  app.get("/api/git/worktrees", (req, res) => {
    const projectId = req.query.project as string
    const project = projects.find((p) => p.id === projectId)
    if (!project) return res.status(404).json({ error: "Project not found" })

    try {
      const raw = execSync("git worktree list --porcelain", { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
      const worktrees: { path: string; branch: string; bare: boolean }[] = []
      let current: { path: string; branch: string; bare: boolean } = { path: "", branch: "", bare: false }
      for (const line of raw.split("\n")) {
        if (line.startsWith("worktree ")) {
          if (current.path) worktrees.push(current)
          current = { path: line.slice(9), branch: "", bare: false }
        } else if (line.startsWith("branch ")) {
          current.branch = line.slice(7).replace("refs/heads/", "")
        } else if (line === "bare") {
          current.bare = true
        }
      }
      if (current.path) worktrees.push(current)
      res.json({ worktrees })
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list worktrees" })
    }
  })

  app.post("/api/git/worktree-delete", express.json(), (req, res) => {
    const { project: projectId, path: wtPath, force } = req.body
    const proj = projects.find((p) => p.id === projectId)
    if (!proj || !wtPath) return res.status(400).json({ error: "Missing project or path" })

    try {
      const flag = force ? "--force" : ""
      execSync(`git worktree remove ${flag} ${JSON.stringify(wtPath)}`, { cwd: proj.cwd, encoding: "utf-8", timeout: 10000 })
      res.json({ ok: true })
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Remove failed" })
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

  // --- Shared Memory (agentlore.md) endpoints ---

  app.get("/api/memory", (_req, res) => {
    const cwd = resolveProjectCwd()
    if (!cwd) { res.json({ content: "", path: "" }); return }
    const content = getProjectMemory(cwd)
    res.json({ content, path: getMemoryPath(cwd) })
  })

  app.put("/api/memory", express.json(), (req, res) => {
    const { content } = req.body
    if (typeof content !== "string") { res.status(400).json({ error: "Missing content" }); return }
    const cwd = resolveProjectCwd()
    if (!cwd) { res.status(400).json({ error: "No active project" }); return }
    updateProjectMemory(cwd, content)
    log.info(`[Memory] Updated agentlore.md for project at ${cwd} (${content.length} chars)`)
    res.json({ ok: true, path: getMemoryPath(cwd) })
  })

  // --- Insight endpoints ---

  app.post("/api/insight/generate", express.json(), (req, res) => {
    const { projectId, sessionId } = req.body as { projectId?: string; sessionId?: string }

    // Gather events from a specific session or the most recent one
    let events: AgentEvent[] = []
    if (sessionId) {
      events = eventStore.getSessionEvents(sessionId)
    } else {
      // Find most recent session for the project or any active session
      const pid = projectId || projects[0]?.id
      if (pid) {
        const sessionsForProject = eventStore.getSessionsByProject(pid)
        if (sessionsForProject.length > 0) {
          events = eventStore.getSessionEvents(sessionsForProject[0].id)
        }
      }
    }

    if (events.length === 0) {
      return res.json({ markdown: "", empty: true })
    }

    // Extract meaningful events for insight
    const errors = events.filter(e => e.type === "error")
    const fixes = events.filter(e => e.type === "file_edit" || e.type === "file_create")
    const commands = events.filter(e => e.type === "command_run")
    const decisions = events.filter(e => e.type === "decision_request")
    const infos = events.filter(e => e.type === "info" || e.type === "response")

    // Build markdown report
    const lines: string[] = []
    lines.push("# Session Insight Report\n")

    if (errors.length > 0) {
      lines.push("## Problems Encountered\n")
      for (const e of errors.slice(-5)) {
        lines.push(`- **${e.title}**`)
        if (e.detail) lines.push(`  ${e.detail.slice(0, 200)}`)
      }
      lines.push("")
    }

    if (fixes.length > 0) {
      lines.push("## Files Modified\n")
      const seen = new Set<string>()
      for (const e of fixes) {
        const path = e.diff?.filePath || e.title
        if (!seen.has(path)) {
          seen.add(path)
          lines.push(`- \`${path}\``)
        }
      }
      lines.push("")
    }

    if (commands.length > 0) {
      lines.push("## Commands Executed\n")
      for (const e of commands.slice(-8)) {
        lines.push(`- \`${e.title}\` — ${e.status}`)
      }
      lines.push("")
    }

    if (decisions.length > 0) {
      lines.push("## Decisions Made\n")
      for (const e of decisions) {
        lines.push(`- ${e.title}`)
      }
      lines.push("")
    }

    // Summary section from recent info/response events
    const summaryEvents = events.filter(e => e.type === "session_summary" || e.type === "progress_report")
    if (summaryEvents.length > 0) {
      lines.push("## Summary\n")
      for (const e of summaryEvents.slice(-3)) {
        lines.push(`${e.title}`)
        if (e.detail) lines.push(`\n${e.detail.slice(0, 500)}`)
      }
      lines.push("")
    }

    // Build sourceText for submission
    const sourceText = lines.join("\n")
    const title = errors.length > 0
      ? `Debug: ${errors[0].title.slice(0, 60)}`
      : fixes.length > 0
        ? `Session: ${fixes.length} files modified`
        : `Session insight — ${events.length} events`

    res.json({ markdown: sourceText, title, sourceText, empty: false })
  })

  app.post("/api/insight/submit", express.json(), async (req, res) => {
    const { sourceText, title } = req.body as { sourceText?: string; title?: string }
    if (!sourceText || sourceText.length < 200) {
      return res.status(400).json({ error: "sourceText must be at least 200 characters" })
    }
    const config = loadConfig()
    const token = config.agentlore?.token
    if (!token) {
      return res.status(400).json({ error: "AgentLore token not configured. Run `agentrune login` first." })
    }

    try {
      const apiRes = await fetch("https://agentlore.vercel.app/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          tool: "submit_knowledge",
          arguments: { sourceText, title: title || "Session Insight" },
        }),
      })
      const result = await apiRes.json()
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Submit failed" })
    }
  })

  // --- Worktree endpoints ---

  app.get("/api/worktrees/:projectId", (req, res) => {
    const wtm = worktreeManagers.get(req.params.projectId)
    if (!wtm) { res.json([]); return }
    res.json(wtm.list())
  })

  // --- Automation endpoints ---

  app.get("/api/automations/:projectId", (req, res) => {
    res.json(automationManager.list(req.params.projectId))
  })

  app.post("/api/automations/:projectId", express.json(), (req, res) => {
    const { name, command, prompt, skill, templateId, schedule, runMode, agentId } = req.body
    if (!name || !schedule || (!command && !prompt)) {
      return res.status(400).json({ error: "name, schedule, and (prompt or command) are required" })
    }
    const auto = automationManager.add({
      projectId: req.params.projectId,
      name,
      command,
      prompt,
      skill,
      templateId,
      schedule,
      runMode: runMode || "local",
      agentId: agentId || "claude",
      enabled: req.body.enabled !== false,
    })
    res.json(auto)
  })

  app.patch("/api/automations/:projectId/:id", express.json(), (req, res) => {
    const auto = automationManager.update(req.params.id, req.body)
    if (!auto) return res.status(404).json({ error: "Automation not found" })
    res.json(auto)
  })

  app.delete("/api/automations/:projectId/:id", (req, res) => {
    const deleted = automationManager.remove(req.params.id)
    if (!deleted) return res.status(404).json({ error: "Automation not found" })
    res.json({ ok: true })
  })

  app.get("/api/automations/:projectId/:id/results", (req, res) => {
    const results = automationManager.getResults(req.params.id)
    res.json(results)
  })

  /** Resolve current project name from first connected session */
  function resolveProjectName(): string {
    for (const [, sid] of clientSessions) {
      const s = sessions.get(sid)
      if (s) return s.project.name
    }
    return "unknown"
  }

  /** Resolve current project CWD from first connected session */
  function resolveProjectCwd(): string | null {
    for (const [, sid] of clientSessions) {
      const s = sessions.get(sid)
      if (s) return s.project.cwd
    }
    // Fallback: use first project
    if (projects.length > 0) return projects[0].cwd
    return null
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
        case "ping": {
          ws.send(JSON.stringify({ type: "pong" }))
          break
        }
        case "attach": {
          const projectId = msg.projectId as string
          const project = projects.find((p) => p.id === projectId)
          log.info(`[attach] projectId=${projectId} found=${!!project} agentId=${msg.agentId} sessionId=${msg.sessionId || "new"}`)
          if (!project) {
            ws.send(JSON.stringify({ type: "error", message: "Project not found" }))
            return
          }

          const agentId = (msg.agentId as string) || "terminal"
          const requestedSessionId = msg.sessionId as string | undefined

          // Pre-generate session ID so worktree and PTY share the same key
          // Use random suffix to avoid collisions when multiple sessions start simultaneously
          const newSessionId = requestedSessionId || `${project.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

          // Worktree isolation: create isolated workspace for every new session
          // Falls back to project cwd if git worktree creation fails (e.g. not a git repo)
          let sessionProject = project
          let worktreeBranch: string | null = null
          if (!requestedSessionId) {
            try {
              let wtm = worktreeManagers.get(project.id)
              if (!wtm) {
                wtm = new WorktreeManager(project.cwd)
                worktreeManagers.set(project.id, wtm)
              }
              const wt = wtm.create(newSessionId, msg.taskSlug as string)
              sessionProject = { ...project, cwd: wt.path }
              worktreeBranch = wt.branch
              log.info(`Worktree created for session ${newSessionId}: ${wt.branch} at ${wt.path}`)
            } catch (err) {
              log.warn(`Worktree creation failed, using project cwd: ${err instanceof Error ? err.message : "unknown"}`)
            }
          } else {
            // Resumed session — check if worktree exists and restore CWD
            const wtm = worktreeManagers.get(project.id)
            const existingWt = wtm?.get(requestedSessionId)
            if (existingWt) {
              worktreeBranch = existingWt.branch
              sessionProject = { ...project, cwd: existingWt.path }
            }
          }

          const alreadyExisted = requestedSessionId ? sessions.get(requestedSessionId) !== undefined : false
          log.info(`[attach] sessionProject.cwd=${sessionProject.cwd} alreadyExisted=${alreadyExisted} requestedSessionId=${requestedSessionId || "none"}`)

          // Load API keys from vault and inject into PTY environment
          const attachCfg = loadConfig()
          const vaultKeys = agentId !== "terminal"
            ? loadVaultKeys({
                autoSaveKeysPath: (msg.autoSaveKeysPath as string) || undefined,
                vaultPath: attachCfg.vaultPath || undefined,
                keyVaultPath: attachCfg.keyVaultPath || undefined,
              })
            : {}
          const session = sessions.create(sessionProject, agentId, newSessionId, vaultKeys)
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

          log.info(`[attach] watcherExists=${sessionJsonlWatchers.has(session.id)} session.id=${session.id} agentId=${agentId}`)
          if (!sessionJsonlWatchers.has(session.id)) {
            const sid = session.id
            const cb = makeWatcherCallback(sid)
            let watcher: { stop(): void; rescan?(): void; buildResumeOptions?(): AgentEvent | null } | null = null

            // Use sessionProject.cwd (may be worktree path) — this is where Claude Code runs
            const claudeSessionId = msg.claudeSessionId as string | undefined
            if (agentId === "claude") {
              watcher = new JsonlWatcher(sessionProject.cwd, cb, claudeSessionId)
              log.info(`[attach] JsonlWatcher created for cwd=${sessionProject.cwd} claudeSessionId=${claudeSessionId || "none"}`)
            } else if (agentId === "codex") {
              watcher = new CodexWatcher(cb)
            } else if (agentId === "gemini") {
              watcher = new GeminiWatcher(sessionProject.cwd, cb)
            }

            if (watcher) {
              (watcher as any).start()
              // For resumed sessions with claudeSessionId, no need to rescan —
              // the watcher already targets the specific file.
              // For resumed sessions without claudeSessionId, clear filter.
              if (requestedSessionId && !claudeSessionId && (watcher as any).rescan) {
                log.info(`[attach] Calling rescan() for resumed session (no claudeSessionId)`)
                ;(watcher as any).rescan()
              }
              sessionJsonlWatchers.set(sid, watcher)
              log.info(`[attach] Session watcher started for ${agentId} session ${sid}`)
            } else {
              log.warn(`[attach] No watcher created for agentId=${agentId}`)
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

          // Replay stored events — for resumed sessions (requestedSessionId means user chose "resume")
          // Note: after daemon restart, alreadyExisted is false because in-memory Map is empty,
          // but persisted events on disk may still exist. Use requestedSessionId as the trigger.
          if (requestedSessionId) {
            let storedEvents = sessionRecentEvents.get(session.id) || []
            log.info(`[attach] events_replay: inMemory=${storedEvents.length} for session.id=${session.id}`)
            if (storedEvents.length === 0) {
              storedEvents = loadPersistedEvents(session.id)
              log.info(`[attach] events_replay: loadedFromDisk=${storedEvents.length}`)
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

          ws.send(JSON.stringify({ type: "attached", sessionId: session.id, projectName: project.name, agentId, resumed: alreadyExisted, worktreeBranch }))

          // For new sessions: auto-install agent if not found.
          // Rules are no longer PTY-injected — they live in .agentrune/rules.md
          // and are enforced via --append-system-prompt (Claude) or initial prompt (Codex/Gemini).
          if (!alreadyExisted) {
            // --- Auto-install agent binary if missing ---
            const agentInstallMap: Record<string, { bin: string; npm?: string; pip?: string; script?: string }> = {
              claude:   { bin: "claude",   npm: "@anthropic-ai/claude-code" },
              codex:    { bin: "codex",    npm: "@openai/codex" },
              openclaw: { bin: "openclaw", npm: "openclaw" },
              aider:    { bin: "aider",    pip: "aider-chat" },
              cline:    { bin: "cline",    npm: "@anthropic-ai/cline" },
              gemini:   { bin: "gemini",   npm: "@google/gemini-cli" },
              cursor:   { bin: "agent",    script: "curl https://cursor.com/install -fsSL | bash" },
            }
            const installInfo = agentInstallMap[agentId]
            if (installInfo && agentId !== "terminal") {
              const isWin = process.platform === "win32"
              let checkAndInstall: string
              if (isWin) {
                const installCmd = installInfo.npm
                  ? `npm install -g ${installInfo.npm}`
                  : installInfo.pip
                    ? `pip install ${installInfo.pip}`
                    : installInfo.script || ""
                checkAndInstall = `if (-not (Get-Command ${installInfo.bin} -ErrorAction SilentlyContinue)) { Write-Host 'Installing ${agentId}...'; ${installCmd} }`
              } else {
                const installCmd = installInfo.npm
                  ? `npm install -g ${installInfo.npm}`
                  : installInfo.pip
                    ? `pip install ${installInfo.pip}`
                    : installInfo.script || ""
                checkAndInstall = `command -v ${installInfo.bin} >/dev/null 2>&1 || { echo "Installing ${agentId}..."; ${installCmd}; }`
              }
              sessions.write(session.id, `${checkAndInstall}\r`)
              log.info(`Auto-install check injected for ${agentId} (bin: ${installInfo.bin})`)
            }
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
              // Trigger JSONL watcher rescan — /resume may switch to a different conversation file
              const watcher = sessionJsonlWatchers.get(sessionId)
              if (watcher?.rescan) {
                setTimeout(() => watcher.rescan!(), 3000) // wait for Claude to write new JSONL
              }
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

        // Send input to a specific session by ID (for batch operations)
        case "session_input": {
          const targetId = msg.sessionId as string
          const inputStr = msg.data as string
          if (targetId && inputStr && sessions.get(targetId)) {
            if (/\/resume\b/i.test(inputStr)) {
              resumeDecisionDone.delete(targetId)
              resumeTimers.delete(targetId + "_scrolled")
              resumeCursorOffset.delete(targetId)
            }
            const cmdMatch = inputStr.trim().replace(/\r?\n$/, "").match(/^(\/\w+)$/)
            if (cmdMatch) {
              const commandPrompt = getCommandPrompt(cmdMatch[1])
              if (commandPrompt) {
                sessions.write(targetId, `${commandPrompt}\n`)
                log.info(`Batch: injected /${cmdMatch[1]} for session ${targetId}`)
                break
              }
            }
            sessions.write(targetId, inputStr)
            log.info(`Batch input sent to session ${targetId.slice(0, 8)}`)
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

        // ─── Session Snapshots ────────────────────────────────
        case "snapshot_create": {
          const sid = msg.sessionId as string
          const name = (msg.name as string) || `snap-${Date.now()}`
          const s = sessions.get(sid)
          if (!s) { ws.send(JSON.stringify({ type: "snapshot_result", success: false, message: "Session not found" })); break }
          try {

            const tag = `agentrune/snapshot/${sid.slice(0, 12)}/${name}`
            execSync(`git tag -f "${tag}"`, { cwd: s.project.cwd, stdio: "pipe" })
            ws.send(JSON.stringify({ type: "snapshot_result", success: true, tag, message: `Snapshot "${name}" created` }))
          } catch (err) {
            ws.send(JSON.stringify({ type: "snapshot_result", success: false, message: err instanceof Error ? err.message : "Failed" }))
          }
          break
        }

        case "snapshot_list": {
          const sid = msg.sessionId as string
          const s = sessions.get(sid)
          if (!s) { ws.send(JSON.stringify({ type: "snapshot_list_result", snapshots: [] })); break }
          try {

            const prefix = `agentrune/snapshot/${sid.slice(0, 12)}/`
            const raw = execSync(`git tag -l "${prefix}*" --sort=-creatordate`, { cwd: s.project.cwd, encoding: "utf-8" })
            const snapshots = raw.trim().split("\n").filter(Boolean).map(tag => ({
              tag,
              name: tag.replace(prefix, ""),
            }))
            ws.send(JSON.stringify({ type: "snapshot_list_result", snapshots }))
          } catch {
            ws.send(JSON.stringify({ type: "snapshot_list_result", snapshots: [] }))
          }
          break
        }

        case "snapshot_restore": {
          const sid = msg.sessionId as string
          const tag = msg.tag as string
          const s = sessions.get(sid)
          if (!s || !tag) { ws.send(JSON.stringify({ type: "snapshot_result", success: false, message: "Invalid" })); break }
          try {

            execSync(`git checkout "${tag}" -- .`, { cwd: s.project.cwd, stdio: "pipe" })
            ws.send(JSON.stringify({ type: "snapshot_result", success: true, message: `Restored to "${tag}"` }))
          } catch (err) {
            ws.send(JSON.stringify({ type: "snapshot_result", success: false, message: err instanceof Error ? err.message : "Failed" }))
          }
          break
        }

        // ─── Project Health ──────────────────────────────────
        case "health_scan": {
          const projectId = msg.projectId as string
          const project = projects.find(p => p.id === projectId)
          if (!project) { ws.send(JSON.stringify({ type: "health_result", error: "Project not found" })); break }
          try {

            const opts = { cwd: project.cwd, encoding: "utf-8" as const, timeout: 30000, stdio: "pipe" as const }
            const health: Record<string, any> = {}

            // Tests
            try {
              const testOut = execSync("npm test -- --passWithNoTests 2>&1 || true", opts)
              const passMatch = testOut.match(/(\d+) passed/)
              const failMatch = testOut.match(/(\d+) failed/)
              health.tests = { passed: passMatch ? parseInt(passMatch[1]) : 0, failed: failMatch ? parseInt(failMatch[1]) : 0, raw: testOut.slice(-500) }
            } catch { health.tests = null }

            // Security audit
            try {
              const auditOut = execSync("npm audit --json 2>/dev/null || true", opts)
              const audit = JSON.parse(auditOut || "{}")
              health.security = { vulnerabilities: audit.metadata?.vulnerabilities?.total || 0, details: audit.metadata?.vulnerabilities }
            } catch { health.security = null }

            // Outdated packages
            try {
              const outdatedOut = execSync("npm outdated --json 2>/dev/null || true", opts)
              const outdated = JSON.parse(outdatedOut || "{}")
              health.outdated = { count: Object.keys(outdated).length, packages: Object.entries(outdated).slice(0, 10).map(([name, info]: [string, any]) => ({ name, current: info.current, wanted: info.wanted, latest: info.latest })) }
            } catch { health.outdated = null }

            ws.send(JSON.stringify({ type: "health_result", health }))
          } catch (err) {
            ws.send(JSON.stringify({ type: "health_result", error: err instanceof Error ? err.message : "Failed" }))
          }
          break
        }

        // ─── Agent Swarm (inter-session messaging) ────────────
        case "swarm_ask": {
          const fromSid = msg.fromSessionId as string
          const toSid = msg.toSessionId as string
          const question = msg.question as string
          if (!fromSid || !toSid || !question) break
          const toSession = sessions.get(toSid)
          if (toSession) {
            sessions.write(toSid, `\n[來自其他 Session ${fromSid.slice(0, 8)} 的提問] ${question}\n請回答後 report_progress，在 summary 開頭加上 [回覆 ${fromSid.slice(0, 8)}]\n`)
            ws.send(JSON.stringify({ type: "swarm_sent", toSessionId: toSid, message: `Question sent to ${toSid.slice(0, 8)}` }))
          } else {
            ws.send(JSON.stringify({ type: "swarm_sent", error: "Target session not found" }))
          }
          break
        }

        // ─── API Key Management ──────────────────────────────
        case "save_api_key": {
          const envVar = msg.envVar as string
          const value = msg.value as string
          if (!envVar || !value) { ws.send(JSON.stringify({ type: "api_key_result", success: false, message: "Missing envVar or value" })); break }
          try {
            saveVaultKey(envVar, value)
            // If there's an active session, kill and restart with the new key
            const currentSessionId = clientSessions.get(ws)
            if (currentSessionId) {
              const currentSession = sessions.get(currentSessionId)
              if (currentSession && currentSession.agentId !== "terminal") {
                const agentId = currentSession.agentId
                const project = currentSession.project
                sessions.kill(currentSessionId)
                // Reload all vault keys and create new session
                const restartCfg = loadConfig()
                const vaultKeys = loadVaultKeys({
                  autoSaveKeysPath: (msg.autoSaveKeysPath as string) || undefined,
                  vaultPath: restartCfg.vaultPath || undefined,
                  keyVaultPath: restartCfg.keyVaultPath || undefined,
                })
                const newSession = sessions.create(project, agentId, undefined, vaultKeys)
                clientSessions.set(ws, newSession.id)
                progressInterceptor.trackSession(newSession.id)
                ws.send(JSON.stringify({ type: "api_key_result", success: true, restarted: true, newSessionId: newSession.id }))
                log.info(`Session restarted with API key ${envVar} for ${agentId}`)
                break
              }
            }
            ws.send(JSON.stringify({ type: "api_key_result", success: true }))
          } catch (err) {
            ws.send(JSON.stringify({ type: "api_key_result", success: false, message: err instanceof Error ? err.message : "Failed" }))
          }
          break
        }

        case "delete_api_key": {
          const envVar = msg.envVar as string
          if (!envVar) break
          try {
            deleteVaultKey(envVar)
            ws.send(JSON.stringify({ type: "api_key_result", success: true, deleted: true }))
          } catch (err) {
            ws.send(JSON.stringify({ type: "api_key_result", success: false, message: err instanceof Error ? err.message : "Failed" }))
          }
          break
        }

        case "list_api_keys": {
          try {
            const keys = listVaultKeyNames()
            ws.send(JSON.stringify({ type: "api_keys_list", keys }))
          } catch {
            ws.send(JSON.stringify({ type: "api_keys_list", keys: [] }))
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

    // ─── Auth URL detection (open login page on phone) ───
    // CLI agents print auth URLs when login is needed. Detect and emit as tappable event.
    {
      const stripped = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
      const currentSession = sessions.get(sessionId)
      const currentAgentId = currentSession?.agentId || "unknown"

      // Match auth/login URLs — typically contain "login", "auth", "oauth", "callback", "device", "activate"
      const authUrlMatch = stripped.match(/https?:\/\/[^\s)>"']+(?:login|auth|oauth|callback|device|activate|verify|consent|accounts|signin)[^\s)>"']*/i)
        // Also catch generic "open this URL" / "visit this URL" patterns
        || (/(open|visit|go to|navigate|copy|paste)\s+(this\s+)?(url|link)/i.test(stripped) && stripped.match(/https?:\/\/[^\s)>"']+/))
      // Also detect API key prompts (e.g. "Enter your API key", "ANTHROPIC_API_KEY not set")
      const isApiKeyPrompt = !authUrlMatch && /(?:api.?key|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|CURSOR_API_KEY|OPENROUTER_API_KEY).*(?:not set|not found|missing|required|enter|provide|set the)/i.test(stripped)

      if (authUrlMatch || isApiKeyPrompt) {
        const authUrl = authUrlMatch ? authUrlMatch[0].replace(/[.,;:!?]+$/, "") : ""
        const authEventId = `auth_${sessionId}_${Date.now()}`
        // Dedup: don't emit same event within 30s
        const lastAuth = (sessionRecentEvents.get(sessionId) || [])
          .filter(e => e.type === "decision_request" && (e.title === "Login required" || e.title === "API Key required"))
          .pop()
        if (!lastAuth || Date.now() - lastAuth.timestamp > 30000) {
          const options: { label: string; input: string; style: string }[] = []
          if (authUrl) {
            options.push({ label: "Open in browser", input: `__open_url__${authUrl}`, style: "primary" })
            options.push({ label: "Copy URL", input: `__copy_url__${authUrl}`, style: "default" })
          }
          options.push({ label: "Enter API Key", input: `__enter_api_key__${currentAgentId}`, style: authUrl ? "default" : "primary" })

          const authEvent: AgentEvent = {
            id: authEventId,
            timestamp: Date.now(),
            type: "decision_request",
            status: "waiting",
            title: authUrl ? "Login required" : "API Key required",
            detail: authUrl || `${currentAgentId} requires an API key to start`,
            decision: { options },
          }
          events.push(authEvent)
        }
      }
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

    // Start Cloudflare Tunnel for remote access
    let tunnelUrl: string | undefined
    try {
      const { startTunnel } = await import("./tunnel.js")
      const tunnel = await startTunnel(PORT)
      tunnelUrl = tunnel.url
      log.info(`Remote access: ${tunnelUrl}`)
      // Auto-update AgentLore when tunnel restarts with new URL
      tunnel.onRestart = (newUrl: string) => {
        tunnelUrl = newUrl
        log.info(`Tunnel URL changed: ${newUrl}`)
        // Push new URL to AgentLore immediately
        const agentloreConfig = config.agentlore
        if (agentloreConfig) {
          const cloudTokenPath = join(getConfigDir(), "cloud-token")
          const cloudToken = existsSync(cloudTokenPath) ? readFileSync(cloudTokenPath, "utf-8").trim() : ""
          if (cloudToken) agentloreHeartbeat(agentloreConfig.token, agentloreConfig.deviceId, PORT, cloudToken, newUrl)
        }
      }
      // Clean up tunnel on server close
      server.on("close", () => tunnel.stop())
    } catch (err: any) {
      log.warn(`Tunnel failed (LAN-only mode): ${err.message}`)
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
      await agentloreHeartbeat(agentloreConfig.token, agentloreConfig.deviceId, PORT, cloudToken, tunnelUrl)
      setInterval(() => agentloreHeartbeat(agentloreConfig.token, agentloreConfig.deviceId, PORT, cloudToken, tunnelUrl), 2 * 60 * 1000)
    }
  })

  return server
}
