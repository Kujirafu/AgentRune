import express from "express"
import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { WebSocketServer, WebSocket } from "ws"
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { join, basename, dirname } from "node:path"
import { networkInterfaces } from "node:os"
import { execSync } from "node:child_process"
import { SessionManager, type Project } from "./sessions.js"
import { AuthManager, type AuthMode } from "./auth.js"
import { ParseEngine } from "./parse-engine.js"

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

// ─── Self-signed HTTPS cert ──────────────────────────────────────

function ensureCerts(): { key: string; cert: string } | null {
  const certDir = join(process.cwd(), ".certs")
  const keyPath = join(certDir, "key.pem")
  const certPath = join(certDir, "cert.pem")

  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: readFileSync(keyPath, "utf-8"), cert: readFileSync(certPath, "utf-8") }
  }

  try {
    mkdirSync(certDir, { recursive: true })
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=AgentRune"`,
      { stdio: "ignore" },
    )
    console.log("  Generated self-signed HTTPS certificate")
    return { key: readFileSync(keyPath, "utf-8"), cert: readFileSync(certPath, "utf-8") }
  } catch {
    return null
  }
}

// ─── Create server ───────────────────────────────────────────────

const certs = ensureCerts()
const server = certs
  ? createHttpsServer({ key: certs.key, cert: certs.cert }, app)
  : createHttpServer(app)
const protocol = certs ? "https" : "http"

const wss = new WebSocketServer({ server })
const sessions = new SessionManager()

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

const distPath = join(process.cwd(), "dist")
if (existsSync(distPath)) {
  app.use(express.static(distPath))
}

// ─── CORS for native app ─────────────────────────────────────────

app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Headers", "Content-Type")
  res.header("Access-Control-Allow-Methods", "GET, POST")
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

        const session = sessions.create(project)
        clientSessions.set(ws, session.id)

        const agentId = (msg.agentId as string) || "terminal"
        const engine = new ParseEngine(agentId, projectId)
        clientEngines.set(ws, engine)

        const scrollback = sessions.getScrollback(session.id)
        if (scrollback) {
          ws.send(JSON.stringify({ type: "scrollback", data: scrollback }))
        }

        ws.send(JSON.stringify({ type: "attached", sessionId: session.id, projectName: project.name }))
        break
      }

      case "input": {
        const sessionId = clientSessions.get(ws)
        if (sessionId) sessions.write(sessionId, msg.data as string)
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
    clientSessions.delete(ws)
    clientEngines.delete(ws)
  })
})

sessions.on("data", (sessionId: string, data: string) => {
  for (const [client, sid] of clientSessions) {
    if (sid === sessionId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "output", data }))

      // Feed Parse Engine and emit events
      const engine = clientEngines.get(client)
      if (engine) {
        const events = engine.feed(data)
        for (const event of events) {
          client.send(JSON.stringify({ type: "event", event }))
        }
      }
    }
  }
})

sessions.on("exit", (sessionId: string) => {
  for (const [client, sid] of clientSessions) {
    if (sid === sessionId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "exit", sessionId }))
    }
  }
})

// ─── Start ───────────────────────────────────────────────────────

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  AgentRune running at:`)
  console.log(`    Local:   ${protocol}://localhost:${PORT}`)

  const nets = Object.values(networkInterfaces()).flat()
  const lan = nets.find((n) => n && n.family === "IPv4" && !n.internal)
  if (lan) {
    console.log(`    Phone:   ${protocol}://${lan.address}:${PORT}`)
  }

  auth.printAuthInfo()

  if (!certs) {
    console.log(`    HTTPS:   Not available (install openssl to enable)`)
  }

  console.log()
})
