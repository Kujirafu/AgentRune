import express from "express"
import { createServer as createHttpServer } from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, appendFile, writeSync } from "node:fs"
import { join, basename, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { SessionManager, type Project } from "./sessions.js"
import { AuthManager, type AuthMode } from "./auth.js"
import { ParseEngine } from "./parse-engine.js"
import type { AgentEvent } from "../shared/types.js"
import { EventStore } from "./event-store.js"
import { printConnectionInfo } from "./qr-terminal.js"
import { initAgentLore, registerDevice, getLocalIp } from "./agentlore.js"

const PORT = parseInt(process.env.PORT || "3456")
const AUTH_MODE = (process.env.AGENTRUNE_AUTH || "pairing") as AuthMode
const app = express()
app.use(express.json())

// ─── Auth ────────────────────────────────────────────────────────

const auth = new AuthManager(AUTH_MODE)

// Active session tokens (device verified → gets a session token for WS)
const sessionTokens = new Set<string>()

function issueSessionToken(): string {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")
  sessionTokens.add(token)
  return token
}

// ─── Create server ───────────────────────────────────────────────
// HTTP only — self-signed HTTPS certs are blocked by Android WebView's
// network security config and cause fetch() to fail for FileBrowser/API calls.
// LAN security is provided by the device pairing auth system, not SSL.

const server = createHttpServer(app)
const protocol = "http"

const wss = new WebSocketServer({ server })

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write(`\n  AgentRune is already running — open ${protocol}://localhost:${PORT}\n\n`)
    writeSync(1, `\n  AgentRune is already running — open ${protocol}://localhost:${PORT}\n\n`)
    process.exit(0)
  }
  throw err
})
wss.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") { process.exit(0); return }
  throw err
})

const sessions = new SessionManager()
const eventStore = new EventStore()

// ─── Load projects config ────────────────────────────────────────

function loadProjects(): Project[] {
  const configPath = join(process.cwd(), "projects.json")
  if (!existsSync(configPath)) {
    return [{
      id: "default",
      name: "Home",
      cwd: process.env.HOME || process.env.USERPROFILE || ".",
    }]
  }
  return JSON.parse(readFileSync(configPath, "utf-8"))
}

const projects = loadProjects()

// ─── Serve static files ─────────────────────────────────────────

// Support both: local dev (process.cwd()/dist) and npx (dist/ next to dist-server/)
const __dirname_server = dirname(fileURLToPath(import.meta.url))
const distPath = existsSync(join(process.cwd(), "dist"))
  ? join(process.cwd(), "dist")
  : join(__dirname_server, "../dist")

if (existsSync(distPath)) {
  app.use(express.static(distPath))
}

// ─── CORS for native app ─────────────────────────────────────────

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Headers", "Content-Type")
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  if (req.method === "OPTIONS") {
    return res.sendStatus(200)
  }
  next()
})

// ─── Auth endpoints ──────────────────────────────────────────────

// Check auth mode + whether this device is already paired
app.get("/api/auth/check", (req, res) => {
  const deviceId = req.query.deviceId as string | undefined
  const deviceKnown = deviceId ? auth.isDeviceKnown(deviceId) : false

  res.json({
    mode: auth.mode,
    deviceKnown,
    hasPairedDevices: auth.deviceCount > 0,
  })
})

// Auto-login: verify a saved device token
app.post("/api/auth/device", (req, res) => {
  const { deviceId, token } = req.body
  if (!deviceId || !token) {
    return res.status(400).json({ error: "Missing deviceId or token" })
  }

  if (auth.verifyDevice(deviceId, token)) {
    const sessionToken = issueSessionToken()
    return res.json({ authenticated: true, sessionToken })
  }

  res.status(401).json({ authenticated: false })
})

// Pairing: verify the 6-digit code from console
app.post("/api/auth/pair", (req, res) => {
  if (auth.mode !== "pairing") {
    return res.status(400).json({ error: "Pairing mode not enabled" })
  }

  const { code, deviceName } = req.body
  if (!code) {
    return res.status(400).json({ error: "Missing pairing code" })
  }

  if (auth.verifyPairingCode(code)) {
    const device = auth.registerDevice(deviceName || "Phone")
    const sessionToken = issueSessionToken()
    return res.json({
      authenticated: true,
      deviceId: device.deviceId,
      deviceToken: device.token,
      sessionToken,
    })
  }

  res.status(401).json({ error: "Invalid pairing code" })
})

// TOTP: verify a 6-digit authenticator code
app.post("/api/auth/totp", (req, res) => {
  if (auth.mode !== "totp") {
    return res.status(400).json({ error: "TOTP mode not enabled" })
  }

  const { code, deviceName } = req.body
  if (!code) {
    return res.status(400).json({ error: "Missing TOTP code" })
  }

  if (auth.verifyTotpCode(code)) {
    const device = auth.registerDevice(deviceName || "Phone")
    const sessionToken = issueSessionToken()
    return res.json({
      authenticated: true,
      deviceId: device.deviceId,
      deviceToken: device.token,
      sessionToken,
    })
  }

  res.status(401).json({ error: "Invalid TOTP code" })
})

// ─── REST API ────────────────────────────────────────────────────

app.get("/api/projects", (_req, res) => {
  res.json(projects)
})

app.get("/api/sessions", (_req, res) => {
  res.json(sessions.getAll())
})

// Get project scripts from package.json
app.get("/api/projects/:id/scripts", (req, res) => {
  const project = projects.find((p) => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: "Project not found" })

  const pkgPath = join(project.cwd, "package.json")
  if (!existsSync(pkgPath)) return res.json({ scripts: {} })

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    res.json({ scripts: pkg.scripts || {} })
  } catch {
    res.json({ scripts: {} })
  }
})

// Create a new project
app.post("/api/projects", (req, res) => {
  const { name, cwd } = req.body
  if (!name || !cwd) return res.status(400).json({ error: "Missing name or cwd" })

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  if (projects.find((p) => p.id === id)) return res.status(409).json({ error: "Project exists" })

  const project = { id, name, cwd }
  projects.push(project)

  // Persist to projects.json
  const configPath = join(process.cwd(), "projects.json")
  writeFileSync(configPath, JSON.stringify(projects, null, 2))
  res.json(project)
})

// Kill a session
app.post("/api/sessions/:id/kill", (req, res) => {
  sessions.kill(req.params.id)
  res.json({ ok: true })
})

// ─── File browser ───────────────────────────────────────────────

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
      .filter((e) => !e.name.startsWith(".")) // hide dotfiles
      .map((e) => ({
        name: e.name,
        path: join(dirPath, e.name),
        isDir: e.isDirectory(),
      }))
      .sort((a, b) => {
        // directories first, then alphabetical
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    res.json({
      path: dirPath,
      parent: dirname(dirPath),
      entries,
    })
  } catch (err) {
    res.status(500).json({ error: "Cannot read directory" })
  }
})

// ─── Create directory ────────────────────────────────────────────

app.post("/api/mkdir", (req, res) => {
  const { path: dirPath } = req.body
  if (!dirPath || typeof dirPath !== "string") {
    return res.status(400).json({ error: "Missing path" })
  }

  if (existsSync(dirPath)) {
    return res.status(409).json({ error: "Path already exists" })
  }

  try {
    mkdirSync(dirPath, { recursive: true })
    res.json({ path: dirPath, name: basename(dirPath) })
  } catch (err) {
    res.status(400).json({ error: "Cannot create directory" })
  }
})

// ─── Image upload ───────────────────────────────────────────────

app.post("/api/upload", (req, res) => {
  const { projectId, data, filename } = req.body
  if (!data) return res.status(400).json({ error: "Missing image data" })

  const project = projects.find((p) => p.id === projectId)
  const targetDir = project ? join(project.cwd, ".agentrune") : join(process.cwd(), ".agentrune")

  mkdirSync(targetDir, { recursive: true })

  const ext = filename?.split(".").pop() || "png"
  const name = `paste-${Date.now()}.${ext}`
  const filePath = join(targetDir, name)

  // data is base64
  const buffer = Buffer.from(data.replace(/^data:image\/\w+;base64,/, ""), "base64")
  writeFileSync(filePath, buffer)

  res.json({ path: filePath, filename: name })
})

// Session history API
app.get("/api/history/:projectId", (req, res) => {
  res.json(eventStore.getSessionsByProject(req.params.projectId))
})

app.get("/api/history/:projectId/:sessionId", (req, res) => {
  const events = eventStore.getSessionEvents(req.params.sessionId)
  res.json(events)
})

// ─── QR pairing page ────────────────────────────────────────────

// QR pairing page — serves a simple HTML page with auto-pair functionality
app.get("/pair", (req, res) => {
  const code = req.query.pair as string || ""
  res.send(`<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentRune Pair</title>
<style>
  body { background: #0f172a; color: #e2e8f0; font-family: system-ui;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; }
  .card { text-align: center; padding: 40px; border-radius: 24px;
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
          backdrop-filter: blur(32px); max-width: 360px; }
  h1 { font-family: Georgia, serif; font-size: 28px; margin: 0 0 8px; }
  .sub { font-size: 12px; color: rgba(255,255,255,0.3); text-transform: uppercase;
         letter-spacing: 2px; margin-bottom: 32px; }
  .status { font-size: 14px; color: rgba(96,165,250,0.8); margin-top: 24px; }
  .code { font-family: monospace; font-size: 36px; font-weight: 700; letter-spacing: 8px;
          color: #60a5fa; margin: 20px 0; }
  .btn { padding: 12px 24px; border-radius: 12px; border: 1px solid rgba(96,165,250,0.3);
         background: rgba(96,165,250,0.1); color: #60a5fa; font-size: 16px; font-weight: 600;
         cursor: pointer; margin-top: 16px; }
  .success { color: #4ade80; }
  .error { color: #f87171; }
</style>
</head><body>
<div class="card">
  <h1>AgentRune</h1>
  <div class="sub">Device Pairing</div>
  ${code ? `
    <div class="code">${code}</div>
    <div class="status" id="status">Pairing...</div>
    <script>
      fetch("/api/auth/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "${code}", deviceName: navigator.userAgent.match(/(iPhone|iPad|Android|Mac|Windows)/)?.[1] || "Phone" })
      }).then(r => r.json()).then(data => {
        if (data.authenticated) {
          localStorage.setItem("agentrune_device_id", data.deviceId);
          localStorage.setItem("agentrune_device_token", data.deviceToken);
          document.getElementById("status").className = "status success";
          document.getElementById("status").textContent = "Paired! Redirecting...";
          setTimeout(() => window.location.href = "/", 1000);
        } else {
          document.getElementById("status").className = "status error";
          document.getElementById("status").textContent = "Invalid code. Try again.";
        }
      }).catch(() => {
        document.getElementById("status").className = "status error";
        document.getElementById("status").textContent = "Connection failed.";
      });
    </script>
  ` : `
    <div class="status">Open this page with a pairing code:</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.3);margin-top:12px;">
      {server-url}/pair?pair={code}
    </div>
  `}
</div>
</body></html>`)
})

// SPA fallback
app.get("/{*splat}", (_req, res) => {
  const indexPath = join(distPath, "index.html")
  if (existsSync(indexPath)) {
    res.sendFile(indexPath)
  } else {
    res.status(404).send("Not found — run npm run build first")
  }
})

// ─── WebSocket ───────────────────────────────────────────────────

const clientSessions = new Map<WebSocket, string>()
const clientEngines = new Map<WebSocket, ParseEngine>()
const clientEventSessions = new Map<WebSocket, string>()

// Per-PTY-session state (survives WS reconnects)
const sessionEngines = new Map<string, ParseEngine>()
const sessionRecentEvents = new Map<string, AgentEvent[]>()

wss.on("connection", (ws, req) => {
  // Auth check for WebSocket
  if (auth.mode !== "none") {
    const url = new URL(req.url || "/", `${protocol}://localhost`)
    const token = url.searchParams.get("token") || ""
    if (!sessionTokens.has(token)) {
      ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }))
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

        // Resume existing session by ID, or create a new one
        const alreadyExisted = requestedSessionId ? sessions.get(requestedSessionId) !== undefined : false
        const session = sessions.create(project, agentId, requestedSessionId)
        clientSessions.set(ws, session.id)

        // Reuse ParseEngine per PTY session (survives WS reconnects)
        let engine = sessionEngines.get(session.id)
        if (!engine) {
          engine = new ParseEngine(agentId, projectId)
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

        // Replay stored events so MissionControl shows them immediately
        const storedEvents = sessionRecentEvents.get(session.id) || []
        if (storedEvents.length > 0) {
          ws.send(JSON.stringify({ type: "events_replay", events: storedEvents }))
        }

        ws.send(JSON.stringify({ type: "attached", sessionId: session.id, projectName: project.name, agentId, resumed: alreadyExisted }))
        break
      }

      case "input": {
        const sessionId = clientSessions.get(ws)
        const inputData = msg.data as string
        const preview = inputData.length > 80 ? inputData.slice(0, 80) + "..." : inputData
        const hex = [...inputData].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ")
        console.log(`[INPUT] session=${sessionId || "NONE"} len=${inputData.length} text=${JSON.stringify(preview)} hex=${hex}`)
        if (sessionId) {
          sessions.write(sessionId, inputData)
        } else {
          console.log(`[INPUT] DROPPED — no session mapping for this WS`)
        }
        break
      }

      case "resize": {
        const sid = clientSessions.get(ws)
        if (sid) sessions.resize(sid, msg.cols as number, msg.rows as number)
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

// PTY data log file for debugging (only when AGENTRUNE_DEBUG=1)
const ptyLogPath = join(process.cwd(), "pty-debug.log")
const ptyLogEnabled = process.env.AGENTRUNE_DEBUG === "1"
let ptyLogSize = 0
const PTY_LOG_MAX = 10 * 1024 * 1024  // 10MB cap
if (ptyLogEnabled) {
  try {
    writeFileSync(ptyLogPath, `=== PTY Debug Log started ${new Date().toISOString()} ===\n`)
    console.log(`  PTY debug log: ${ptyLogPath}`)
  } catch { /* ignore */ }
}

sessions.on("data", (sessionId: string, data: string) => {
  // Feed the session-level engine once (not per-client)
  const engine = sessionEngines.get(sessionId)
  const events = engine ? engine.feed(data) : []

  // DEBUG: log raw PTY data to file for analysis (async, capped)
  const stripped = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\(B/g, "")
  const preview = stripped.replace(/[\x00-\x1f]/g, " ").trim().slice(0, 150)
  if (ptyLogEnabled && preview.length > 2 && ptyLogSize < PTY_LOG_MAX) {
    const hex = [...data.slice(0, 200)].map(c => {
      const code = c.charCodeAt(0)
      return code < 32 || code > 126 ? `\\x${code.toString(16).padStart(2, "0")}` : c
    }).join("")
    const logEntry =
      `[${new Date().toISOString()}] session=${sessionId} engine=${!!engine} events=${events.length}\n` +
      `  preview: "${preview}"\n` +
      `  hex200: "${hex}"\n` +
      (events.length > 0 ? events.map(e => `  EVENT: type=${e.type} title="${e.title}"\n`).join("") : "")
    ptyLogSize += logEntry.length
    appendFile(ptyLogPath, logEntry, () => {})  // async, fire-and-forget
  }
  if (preview.length > 2) {
    console.log(`[PARSE] session=${sessionId} engine=${!!engine} events=${events.length} preview="${preview}"`)
    for (const e of events) {
      console.log(`  [EVENT] type=${e.type} status=${e.status} title="${e.title}" detail="${(e.detail || "").slice(0, 80)}"`)
    }
  }

  // Store events in per-session list (cap at 100)
  if (events.length > 0) {
    const list = sessionRecentEvents.get(sessionId)
    if (list) {
      list.push(...events)
      if (list.length > 100) list.splice(0, list.length - 100)
    }
  }

  for (const [client, sid] of clientSessions) {
    if (sid === sessionId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "output", data }))

      // Send detected events to client
      for (const event of events) {
        client.send(JSON.stringify({ type: "event", event }))
      }

      // Persist events to event store
      const eventSessionId = clientEventSessions.get(client)
      if (eventSessionId) {
        for (const event of events) {
          eventStore.addEvent(eventSessionId, event)
        }
      }
    }
  }
})

sessions.on("exit", (sessionId: string) => {
  // Clean up per-session state
  sessionEngines.delete(sessionId)
  sessionRecentEvents.delete(sessionId)

  for (const [client, sid] of clientSessions) {
    if (sid === sessionId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "exit", sessionId }))
    }
  }
})

// ─── Start ───────────────────────────────────────────────────────

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`\n  AgentRune running at:`)
  console.log(`    Local:   ${protocol}://localhost:${PORT}`)

  const localIpAddr = getLocalIp()
  if (localIpAddr !== "127.0.0.1") {
    console.log(`    Phone:   ${protocol}://${localIpAddr}:${PORT}`)
  }

  auth.printAuthInfo()

  if (auth.mode === "pairing") {
    const pairingCode = auth.getCurrentCode?.()
    if (localIpAddr !== "127.0.0.1" && pairingCode) {
      printConnectionInfo(`${protocol}://${localIpAddr}:${PORT}`, pairingCode)
    }
  }

  console.log()

  // AgentLore device registration
  const agentLoreConfig = await initAgentLore(PORT)
  if (agentLoreConfig) {
    const localIp = getLocalIp()
    await registerDevice(agentLoreConfig, localIp, PORT)
    setInterval(() => registerDevice(agentLoreConfig, localIp, PORT), 2 * 60 * 1000)
  }
})
