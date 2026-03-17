// server/ws-server.ts
// Main WebSocket + HTTP server — ported from AirTerm/server/index.ts
import express from "express"
import { createServer as createHttpServer } from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, appendFile, unlinkSync, openSync, readSync, closeSync } from "node:fs"
import { join, basename, dirname, isAbsolute, resolve, normalize, sep } from "node:path"
import { homedir, hostname, networkInterfaces } from "node:os"
import { execFileSync, spawn as childSpawn } from "node:child_process"
import { randomInt, randomBytes } from "node:crypto"
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
import { AutomationManager, ADMIN_LIMITS } from "./automation-manager.js"
import { buildPlanningConstraints } from "./planning-constraints.js"
import { createFromTrustProfile } from "./authority-map.js"
import { readAuditLog, listAuditDates, getRecentAuditEntries, getAutomationAudit } from "./audit-log.js"
import { analyzeSkillContent } from "./skill-analyzer.js"
import { getCommandPrompt, getProjectMemory, updateProjectMemory, getMemoryPath, ensureRulesFile, ensurePrdApiSection, getRulesPath } from "./behavior-rules.js"
import { loadStandards, saveRule, deleteRule, saveCategory, deleteCategory, getGlobalStandardsDir, getProjectStandardsDir } from "./standards-loader.js"
import { validateStandards } from "./standards-validator.js"
import { loadVaultKeys, saveVaultKey, deleteVaultKey, listVaultKeyNames } from "./vault-keys.js"
import { AGENT_INSTALL_INFO, buildAgentLaunch, isLaunchAgentId, normalizeAgentSettings } from "./agent-launch.js"
import { buildSessionActivityPayload, shouldSendCrashPush } from "./crash-notification.js"
import { loadProjectsFromDisk, saveProjectsToDisk } from "./project-registry.js"
import { log } from "../shared/logger.js"
import { initCliTelemetry, captureCliEvent } from "./telemetry.js"
import type { AgentEvent, TaskStore, PrdItem, PrdPriority, Project } from "../shared/types.js"
import type { LaunchAgentId, NormalizedAgentSettings } from "./agent-launch.js"

// --- Terminal Web UI (desktop sync) ---
function getTerminalHtml(nonce: string): string {
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
  <button id="send-btn">Send</button>
</div>
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script nonce="${nonce}">
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
document.getElementById('send-btn').addEventListener('click', sendCmd);

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

// --- Server-side i18n for crash/restart events ---
const crashI18n: Record<string, Record<string, string>> = {
  "crash.title": { "en": "Agent is not running", "zh-TW": "Agent 未在執行" },
  "crash.detail": { "en": "The agent has exited. Restart it or close this session.", "zh-TW": "Agent 已結束。重新啟動或關閉此工作階段。" },
  "crash.exited": { "en": "{agent} has exited", "zh-TW": "{agent} 已結束" },
  "crash.exitedDetail": { "en": "Agent process is no longer running. Your messages will go to the shell instead of the agent.", "zh-TW": "Agent 已停止執行，你的訊息會送到 shell 而不是 Agent。" },
  "crash.restartClaude": { "en": "Restart Claude", "zh-TW": "重啟 Claude" },
  "crash.restartCodex": { "en": "Restart Codex", "zh-TW": "重啟 Codex" },
  "crash.restartGemini": { "en": "Restart Gemini", "zh-TW": "重啟 Gemini" },
  "crash.restartAider": { "en": "Restart Aider", "zh-TW": "重啟 Aider" },
  "crash.restartCursor": { "en": "Restart Cursor", "zh-TW": "重啟 Cursor" },
  "crash.closeSession": { "en": "Close session", "zh-TW": "關閉工作階段" },
  "crash.ignore": { "en": "Ignore (send to shell)", "zh-TW": "忽略（送到 shell）" },
  "crash.restarting": { "en": "Restarting {agent}...", "zh-TW": "正在重啟 {agent}⋯" },
  "crash.autoResuming": { "en": "Auto-resuming {agent}...", "zh-TW": "正在自動恢復 {agent}⋯" },
}
function ct(key: string, locale?: string, vars?: Record<string, string>): string {
  const entry = crashI18n[key]
  if (!entry) return key
  let text = entry[locale || "en"] || entry["en"] || key
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, v)
  return text
}
// Get locale for a session from its stored launch settings
type LaunchSessionState = {
  agentId: LaunchAgentId
  settings: NormalizedAgentSettings
  projectId: string
}

function asSettingsRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function getSessionLocale(sessionId: string, launchSettings: Map<string, LaunchSessionState>): string {
  return launchSettings.get(sessionId)?.settings.locale || "en"
}

function isPlainNumberDecisionInput(input: string | undefined): boolean {
  return typeof input === "string" && /^\d+\r?\n?$/.test(input)
}

function buildCrashRestartOptions(locale?: string) {
  const isZh = locale?.toLowerCase().startsWith("zh")
  return [
    { label: ct("crash.restartClaude", locale), input: "__restart_agent__claude", style: "primary" as const },
    { label: ct("crash.restartCodex", locale), input: "__restart_agent__codex", style: "default" as const },
    { label: ct("crash.restartGemini", locale), input: "__restart_agent__gemini", style: "default" as const },
    { label: ct("crash.restartAider", locale), input: "__restart_agent__aider", style: "default" as const },
    { label: ct("crash.restartCursor", locale), input: "__restart_agent__cursor", style: "default" as const },
    { label: isZh ? "重啟 OpenClaw" : "Restart OpenClaw", input: "__restart_agent__openclaw", style: "default" as const },
    { label: isZh ? "重啟 Cline" : "Restart Cline", input: "__restart_agent__cline", style: "default" as const },
    { label: ct("crash.closeSession", locale), input: "__close_session__", style: "danger" as const },
    { label: ct("crash.ignore", locale), input: "__dismiss_crash__", style: "default" as const },
  ]
}

// Legacy agent command builders removed (2026-03-17 security audit).
// All agent launches now use buildAgentLaunch() from agent-launch.ts
// which has strict enum allowlists + safe shell quoting.

// --- Projects ---

function getProjectsPath(): string {
  return join(getConfigDir(), "projects.json")
}

function loadProjects(): Project[] {
  const fallbackProject: Project = {
    id: "default",
    name: "Home",
    cwd: process.env.HOME || process.env.USERPROFILE || ".",
  }
  const configPath = getProjectsPath()
  const loaded = loadProjectsFromDisk(configPath, fallbackProject)
  if (loaded.changed) {
    saveProjectsToDisk(configPath, loaded.projects)
  }
  return loaded.projects
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

// Cached sibling daemon info — updated by probeSiblingDaemon, exposed via /api/daemon-info
let cachedSiblingInfo: { tunnelUrl: string; role: string; port: number } | null = null

// Track consecutive sibling failures for auto-restart
let siblingFailCount = 0
const SIBLING_RESTART_THRESHOLD = 3 // restart after 3 consecutive failures (~3 heartbeats)

async function probeSiblingDaemon(myPort: number): Promise<string | undefined> {
  const otherPort = myPort === 3457 ? 3456 : 3457
  try {
    const r = await fetch(`http://127.0.0.1:${otherPort}/api/daemon-info`, { signal: AbortSignal.timeout(2000) })
    if (r.ok) {
      const info = await r.json()
      siblingFailCount = 0 // reset on success
      if (info.tunnelUrl) {
        log.dim(`Sibling daemon (port ${otherPort}) tunnel: ${info.tunnelUrl}`)
        cachedSiblingInfo = { tunnelUrl: info.tunnelUrl, role: info.role, port: otherPort }
        return info.tunnelUrl as string
      }
    }
  } catch {
    cachedSiblingInfo = null // sibling offline
    siblingFailCount++
    if (siblingFailCount === SIBLING_RESTART_THRESHOLD) {
      log.warn(`[Watchdog] Sibling daemon (port ${otherPort}) not responding after ${SIBLING_RESTART_THRESHOLD} checks, restarting...`)
      restartSiblingDaemon(otherPort)
    }
  }
  return undefined
}

/** Restart sibling daemon via spawn (unless stop marker exists) */
function restartSiblingDaemon(port: number) {
  try {
    // Check stop marker — if someone explicitly stopped this daemon, don't restart
    const markerPath = join(process.env.HOME || process.env.USERPROFILE || "~", ".agentrune", `stop-${port}.marker`)
    if (existsSync(markerPath)) {
      log.dim(`[Watchdog] Stop marker found for port ${port}, skipping restart`)
      return
    }
    const thisFile = fileURLToPath(import.meta.url)
    const distBin = join(thisFile, "..", "..", "bin.js")
    const srcBin = join(thisFile, "..", "..", "..", "bin.ts")
    const binScript = existsSync(distBin) ? distBin : srcBin

    const loaderArgs: string[] = []
    for (let i = 0; i < process.execArgv.length; i++) {
      if (process.execArgv[i] === "--import" && process.execArgv[i + 1]) {
        loaderArgs.push("--import", process.execArgv[i + 1])
        i++
      }
    }

    const configDir = join(process.env.HOME || process.env.USERPROFILE || "~", ".agentrune")
    const logFile = join(configDir, "daemon.log")
    const logFd = openSync(logFile, "a")
    const pidSuffix = port !== 3456 ? `-${port}` : ""
    const pidFile = join(configDir, `daemon${pidSuffix}.pid`)

    const child = childSpawn(process.execPath, [
      ...loaderArgs, binScript, "start", "--foreground", "--port", String(port),
    ], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    })

    if (child.pid) {
      writeFileSync(pidFile, String(child.pid))
      child.unref()
      log.success(`[Watchdog] Restarted sibling daemon on port ${port} (PID: ${child.pid})`)
    }
  } catch (err: any) {
    log.error(`[Watchdog] Failed to restart sibling: ${err.message}`)
  }
}

async function agentloreHeartbeat(token: string, deviceId: string, port: number, cloudToken?: string, tunnelUrl?: string) {
  try {
    // Probe sibling daemon for fallback URL
    const siblingTunnelUrl = await probeSiblingDaemon(port)
    const myRole = port === 3457 ? "dev" : "release"

    // Priority rule: dev is always primary, release is always fallback.
    // When release detects dev is alive, it sets dev's URL as primary tunnelUrl
    // so AgentLore always points the app to dev first.
    let primaryUrl = tunnelUrl
    let fallbackUrl = siblingTunnelUrl
    if (myRole === "release" && siblingTunnelUrl) {
      // Dev is alive — put dev as primary, myself as fallback
      primaryUrl = siblingTunnelUrl
      fallbackUrl = tunnelUrl
    }

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
        tunnelUrl: primaryUrl || undefined,
        fallbackTunnelUrl: fallbackUrl || undefined,
      }),
    })
    if (res.ok) {
      log.info("AgentLore heartbeat OK (port " + port + `, primary: ${primaryUrl}` + (fallbackUrl ? `, fallback: ${fallbackUrl}` : "") + ")")
    } else {
      const body = await res.text().catch(() => "")
      log.warn("AgentLore heartbeat failed: " + res.status + " " + body.substring(0, 100))
    }
  } catch (err: any) {
    log.warn("AgentLore heartbeat error: " + (err?.message || err))
  }
}

// --- AgentLore push notifications ---

/** Read FCM token from ~/.agentrune/fcm-token (written by the app) */
function readFcmToken(): string | null {
  try {
    const tokenPath = join(homedir(), ".agentrune", "fcm-token")
    if (!existsSync(tokenPath)) return null
    return readFileSync(tokenPath, "utf-8").trim() || null
  } catch {
    return null
  }
}

/** Send a push notification via AgentLore API. Fails silently — never crashes the daemon. */
async function sendPushNotification(
  config: { token: string; deviceId: string },
  title: string,
  body: string,
  data?: Record<string, string>,
) {
  try {
    const fcmToken = readFcmToken()
    if (!fcmToken) return // no FCM token registered, skip silently

    const res = await fetch("https://agentlore.vercel.app/api/push-notification", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: config.deviceId,
        fcmToken,
        title,
        body,
        data: data || undefined,
      }),
    })
    if (res.ok) {
      log.dim(`Push notification sent: ${title}`)
    } else {
      const text = await res.text().catch(() => "")
      log.dim(`Push notification failed: ${res.status} ${text.substring(0, 100)}`)
    }
  } catch (err: any) {
    log.dim(`Push notification error: ${err?.message || err}`)
  }
}

// --- Create server ---

// --- CLI version check (cached, non-blocking) ---
const __wsDir = dirname(fileURLToPath(import.meta.url))
const cliPkgPath = [join(__wsDir, "..", "package.json"), join(__wsDir, "..", "..", "package.json")]
  .find(p => { try { readFileSync(p); return true } catch { return false } })!
const cliPkg = JSON.parse(readFileSync(cliPkgPath, "utf-8"))
let updateInfo: { latest: string; current: string; changelog?: string } | null = null

/** Compare two semver strings: returns true if b > a */
function isNewerVersion(current: string, latest: string): boolean {
  const a = current.split(".").map(Number)
  const b = latest.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    if ((b[i] || 0) > (a[i] || 0)) return true
    if ((b[i] || 0) < (a[i] || 0)) return false
  }
  return false
}

async function checkCliUpdate(): Promise<void> {
  try {
    const res = await fetch("https://registry.npmjs.org/agentrune/latest", { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return
    const data = await res.json() as { version?: string; changelog?: string }
    if (data.version && isNewerVersion(cliPkg.version, data.version)) {
      // Fetch changelog from GitHub release tag
      let changelog: string | undefined
      try {
        const ghRes = await fetch(`https://api.github.com/repos/Kujirafu/AgentRune/releases/tags/v${data.version}`, {
          signal: AbortSignal.timeout(5000),
          headers: { Accept: "application/vnd.github.v3+json" },
        })
        if (ghRes.ok) {
          const release = await ghRes.json() as { body?: string }
          changelog = release.body || undefined
        }
      } catch {}
      updateInfo = { latest: data.version, current: cliPkg.version, changelog }
      log.info(`CLI update available: v${cliPkg.version} → v${data.version}`)
    }
  } catch {}
}

// Whitelist of allowed environment variable keys for API key injection
const ALLOWED_ENV_KEYS = new Set(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY", "FIREWORKS_API_KEY", "TOGETHER_API_KEY", "COHERE_API_KEY", "PERPLEXITY_API_KEY", "OPENROUTER_API_KEY", "AZURE_OPENAI_API_KEY", "REPLICATE_API_TOKEN", "AGENTLORE_API_KEY", "OPENCLAW_API_KEY"])

export function createServer(portOverride?: number) {
  const config = loadConfig()
  const PORT = portOverride || config.port || 3456

  // Check for CLI updates on startup (non-blocking)
  checkCliUpdate()

  const app = express()
  app.use(express.json({ limit: "10mb" }))

  // Security headers
  app.use((_req, res, next) => {
    res.header("X-Content-Type-Options", "nosniff")
    res.header("X-Frame-Options", "DENY")
    res.header("X-XSS-Protection", "1; mode=block")
    res.header("Referrer-Policy", "no-referrer")
    res.header("Content-Security-Policy", "default-src 'self'; script-src 'self' cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' cdn.jsdelivr.net; connect-src 'self' ws: wss:; img-src 'self' data:;")
    next()
  })

  // CORS — allow cross-origin requests (phone app via tunnel)
  const ALLOWED_ORIGINS = new Set(["capacitor://localhost", "http://localhost"])
  function isAllowedOrigin(origin: string | undefined): string | false {
    if (!origin) return "http://localhost" // Same-origin requests have no origin — use localhost as default
    if (ALLOWED_ORIGINS.has(origin)) return origin
    // Allow http://localhost with any port
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin
    // Allow capacitor with any scheme (http or capacitor)
    if (/^(capacitor|http):\/\/localhost$/.test(origin)) return origin
    return false
  }
  app.use((_req, res, next) => {
    const origin = _req.headers.origin
    const allowed = isAllowedOrigin(origin)
    if (allowed) {
      res.header("Access-Control-Allow-Origin", allowed)
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Agent-Id, X-Api-Keys")
    if (_req.method === "OPTIONS") return res.sendStatus(204)
    next()
  })

  // Serve terminal web UI at root — enables desktop sync terminal
  app.get("/", (_req, res) => {
    const nonce = randomBytes(16).toString("base64")
    res.header("Content-Security-Policy", `default-src 'self'; script-src 'nonce-${nonce}' cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' cdn.jsdelivr.net; connect-src 'self' ws: wss:; img-src 'self' data:;`)
    res.type("html").send(getTerminalHtml(nonce))
  })

  // Session tokens for WS auth — Map<token, boundIp>
  const sessionTokens = new Map<string, string>()

  /** Extract real client IP (cloudflared sets Cf-Connecting-Ip) */
  function getClientIp(req: any): string {
    return req.headers?.["cf-connecting-ip"]
      || req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
      || req.socket?.remoteAddress
      || ""
  }

  function issueSessionToken(clientIp?: string): string {
    const token = createSessionToken("local", clientIp)
    sessionTokens.set(token, clientIp || "")
    return token
  }

  // ─── Auth middleware for HTTP API routes ─────────────────────────
  // All /api/* routes except /api/auth/* require a valid session token.
  // Token can be passed via Authorization header or ?token= query param.
  function requireAuth(req: any, res: any, next: any) {
    // Skip auth routes (pairing, device auth, cloud auth, etc.)
    // EXCEPT /api/auth/new-code which must require auth to prevent remote pairing bypass
    if (req.path.startsWith("/api/auth/") && req.path !== "/api/auth/new-code") return next()

    // Allow local connections without auth (same as WS local bypass)
    const remoteAddr = req.socket?.remoteAddress || ""
    const isLocal = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1"
    if (isLocal) return next()

    // Check for session token
    const authHeader = req.headers.authorization || ""
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
    const queryToken = req.query?.token || ""
    const token = bearerToken || queryToken

    if (!token) {
      return res.status(401).json({ error: "Authentication required" })
    }

    const clientIp = getClientIp(req)
    const boundIp = sessionTokens.get(token)
    // Fast path: token in local cache — verify IP binding
    if (boundIp !== undefined) {
      if (boundIp && clientIp && boundIp !== clientIp) {
        return res.status(401).json({ error: "Session bound to different network" })
      }
      return next()
    }
    // Slow path: check persisted tokens (with IP binding)
    if (validateSessionToken(token, clientIp)) {
      return next()
    }

    return res.status(401).json({ error: "Invalid or expired session token" })
  }

  // Apply auth middleware to all /api/* routes (before route handlers)
  app.use("/api", requireAuth)

  const server = createHttpServer(app)
  const wss = new WebSocketServer({ server })

  // Heartbeat: ping clients every 20s
  const wsAlive = new WeakMap<WebSocket, boolean>()
  const heartbeatInterval = setInterval(() => {
    if (wss.clients.size === 0) return
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
    if (clientSessions.size === 0) return
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
        setTimeout(() => server.listen(PORT, "127.0.0.1"), 2000)
      } else {
        log.error(`Port ${PORT} still in use after 5 retries. Is another instance running?`)
        process.exit(1)
      }
      return
    }
    log.error(`[Server error] ${err.code}: ${err.message}`)
    // Don't throw — let the process keep running
  })

  // Self-heal: if the server closes unexpectedly, try to re-listen
  server.on("close", () => {
    if (!server.listening) {
      log.warn("[Self-heal] Server closed unexpectedly — attempting re-listen in 3s...")
      listenRetries = 0
      setTimeout(() => {
        try { server.listen(PORT, "127.0.0.1") } catch (e: any) {
          log.error(`[Self-heal] Re-listen failed: ${e.message}`)
        }
      }, 3000)
    }
  })

  const sessions = new PtyManager()
  const eventStore = new EventStore()
  const progressInterceptor = new ProgressInterceptor()
  const sessionLastTitle = new Map<string, string>()  // Track last meaningful event title per session

  // --- Recoverable sessions: scan persisted events on startup ---
  interface RecoverableSession {
    id: string
    projectId: string
    projectName: string
    agentId: string
    lastEventTitle: string
    lastActivity: number
    status: "recoverable"
    claudeSessionId?: string
  }

  function scanRecoverableSessions(): RecoverableSession[] {
    try {
      const eventsDir = getEventsDir()
      const files = readdirSync(eventsDir).filter(f => f.endsWith(".json"))
      // Group by projectId (prefix before first _timestamp)
      const byProject = new Map<string, { file: string; sessionId: string; mtime: number }[]>()
      for (const f of files) {
        const sessionId = f.replace(/\.json$/, "")
        // Extract projectId from sessionId format: projectId_timestamp_suffix
        const match = sessionId.match(/^(.+?)_(\d{13,})/)
        if (!match) continue
        const projectId = match[1]
        const mtime = parseInt(match[2], 10)
        const list = byProject.get(projectId) || []
        list.push({ file: f, sessionId, mtime })
        byProject.set(projectId, list)
      }

      const result: RecoverableSession[] = []
      const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days
      const now = Date.now()

      for (const [projectId, entries] of byProject) {
        // Sort by mtime desc, take the latest 3 per project
        entries.sort((a, b) => b.mtime - a.mtime)
        const recent = entries.filter(e => now - e.mtime < maxAge).slice(0, 3)

        const project = projects.find(p => p.id === projectId)
        if (!project) continue

        for (const entry of recent) {
          // Read last event title from persisted events
          let lastTitle = ""
          try {
            const events: AgentEvent[] = JSON.parse(readFileSync(join(eventsDir, entry.file), "utf-8"))
            // Find last meaningful title (walk backwards)
            for (let i = events.length - 1; i >= 0; i--) {
              const t = events[i].title
              if (t && isMeaningfulTitle(t)) { lastTitle = t; break }
            }
            if (!lastTitle && events.length > 0) {
              // Fallback: use first event title
              lastTitle = events[0].title || ""
            }
          } catch { /* skip unreadable */ }

          const mapping = sessionClaudeMap.get(entry.sessionId)
          result.push({
            id: entry.sessionId,
            projectId,
            projectName: project.name,
            agentId: "claude",
            lastEventTitle: lastTitle || mapping?.lastTitle || "",
            lastActivity: entry.mtime,
            status: "recoverable",
            claudeSessionId: mapping?.claudeSessionId,
          })
        }
      }

      return result.sort((a, b) => b.lastActivity - a.lastActivity)
    } catch {
      return []
    }
  }

  // --- Session-to-Claude mapping (persisted to disk for resume across daemon restarts) ---
  const sessionMapPath = join(getConfigDir(), "session-map.json")
  const sessionClaudeMap = new Map<string, { claudeSessionId: string; projectId: string; lastTitle: string }>()
  let lastResumeTime = 0

  function loadSessionMap() {
    try {
      if (existsSync(sessionMapPath)) {
        const raw = JSON.parse(readFileSync(sessionMapPath, "utf-8"))
        for (const [k, v] of Object.entries(raw)) {
          sessionClaudeMap.set(k, v as { claudeSessionId: string; projectId: string; lastTitle: string })
        }
      }
    } catch { /* ignore */ }
  }

  function saveSessionMap() {
    try {
      writeFileSync(sessionMapPath, JSON.stringify(Object.fromEntries(sessionClaudeMap), null, 2))
    } catch { /* ignore */ }
  }

  function updateSessionMapping(agentruneSessionId: string, claudeSessionId: string, projectId: string, lastTitle?: string) {
    const existing = sessionClaudeMap.get(agentruneSessionId)
    sessionClaudeMap.set(agentruneSessionId, {
      claudeSessionId,
      projectId,
      lastTitle: lastTitle || existing?.lastTitle || "",
    })
    saveSessionMap()
  }

  loadSessionMap()

  // Build initial session mapping from JSONL files if session-map is empty
  function buildInitialSessionMap() {
    if (sessionClaudeMap.size > 0) return // Already have mappings
    try {
      const claudeProjectsDir = join(homedir(), ".claude", "projects")
      if (!existsSync(claudeProjectsDir)) return

      for (const project of projects) {
        // Convert project cwd to Claude Code dir name
        const normalized = project.cwd.replace(/\\/g, "/")
        const dirName = normalized.replace(/^([A-Za-z]):/, "$1-").replace(/\//g, "-")
        const jsonlDir = join(claudeProjectsDir, dirName)
        if (!existsSync(jsonlDir)) continue

        // Get all JSONL files sorted by mtime desc
        const jsonlFiles = readdirSync(jsonlDir)
          .filter(f => f.endsWith(".jsonl"))
          .map(f => ({
            name: f,
            claudeId: f.replace(/\.jsonl$/, ""),
            mtime: statSync(join(jsonlDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime)

        // Get event files for this project
        const eventsDir = getEventsDir()
        const eventFiles = readdirSync(eventsDir)
          .filter(f => f.startsWith(project.id + "_") && f.endsWith(".json"))
          .map(f => {
            const m = f.match(/^(.+?)_(\d{13,})/)
            return m ? { sessionId: f.replace(/\.json$/, ""), ts: parseInt(m[2], 10) } : null
          })
          .filter(Boolean) as { sessionId: string; ts: number }[]

        // Match event files to JSONL files by closest timestamp
        for (const ef of eventFiles) {
          if (sessionClaudeMap.has(ef.sessionId)) continue
          // Find JSONL file with closest mtime to event timestamp
          let bestMatch: typeof jsonlFiles[0] | null = null
          let bestDiff = Infinity
          for (const jf of jsonlFiles) {
            const diff = Math.abs(jf.mtime - ef.ts)
            if (diff < bestDiff) { bestDiff = diff; bestMatch = jf }
          }
          // Only accept matches within 5 minutes
          if (bestMatch && bestDiff < 5 * 60 * 1000) {
            sessionClaudeMap.set(ef.sessionId, {
              claudeSessionId: bestMatch.claudeId,
              projectId: project.id,
              lastTitle: "",
            })
          }
        }
      }
      if (sessionClaudeMap.size > 0) {
        saveSessionMap()
        log.info(`[session-map] Built initial mapping: ${sessionClaudeMap.size} sessions`)
      }
    } catch (err) {
      log.warn(`[session-map] Failed to build initial mapping: ${err}`)
    }
  }

  // Cache recoverable sessions — initialized ONCE at startup. Sessions that exit
  // normally are tracked in closedSessionIds (persisted to disk) and excluded
  // from the recoverable list. Only sessions that were active when daemon crashed
  // (not in closed list) appear as recoverable.
  let cachedRecoverable: RecoverableSession[] = []
  const closedSessionsPath = join(getConfigDir(), "closed-sessions.json")
  const closedSessionIds = new Set<string>(
    (() => { try { return JSON.parse(readFileSync(closedSessionsPath, "utf-8")) } catch { return [] } })()
  )
  function persistClosedSessions() {
    try { writeFileSync(closedSessionsPath, JSON.stringify([...closedSessionIds])) } catch {}
  }
  const authDedup = new Map<string, string>()  // sessionId -> last auth URL/dedup key (URL-based dedup)
  // Filter: only store titles that are useful as session summaries (not technical noise)
  function isMeaningfulTitle(title: string): boolean {
    if (!title || title.length < 3) return false
    // Skip tool-centric noise
    if (/^(Editing|Creating|Reading|Searching|Running command|Subagent:)/i.test(title)) return false
    if (/^\d[\d,]*\s*tokens?\s*(used|remaining|total)?$/i.test(title)) return false
    if (/^(Thinking|Processing|Token usage|Permission requested|Agent is requesting)/i.test(title)) return false
    if (/^Session (started|ended|resumed)/i.test(title)) return false
    return true
  }
  const worktreeManagers = new Map<string, WorktreeManager>()
  const projects = loadProjects()
  buildInitialSessionMap()
  cachedRecoverable = scanRecoverableSessions()
  log.info(`[Startup] Found ${cachedRecoverable.length} recoverable sessions`)
  const cfg = loadConfig()
  const automationManager = new AutomationManager(sessions, projects, (event) => {
    // Broadcast automation events to all connected WS clients
    const payload = JSON.stringify(event)
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload)
    }

    // Send push notification via AgentLore
    const alCfg = cfg.agentlore
    if (alCfg) {
      if (event.type === "automation_completed") {
        const { automation, result } = event
        const durationMs = result.finishedAt - result.startedAt
        const durationStr = durationMs < 60000 ? `${Math.round(durationMs / 1000)}s` : `${Math.round(durationMs / 60000)}m`

        let title: string
        let body: string
        if (result.status === "success") {
          title = `${automation.name} completed`
          body = `Finished in ${durationStr}`
        } else if (result.status === "timeout") {
          title = `${automation.name} timed out`
          body = `Timed out after ${durationStr}`
        } else {
          title = `${automation.name} failed`
          body = `Status: ${result.status}`
        }

        sendPushNotification(alCfg, title, body, {
          automationId: automation.id,
          status: result.status,
        }).catch(() => {})
      } else if (event.type === "bypass_confirmation_required") {
        sendPushNotification(alCfg, `${event.automationName} needs approval`, "Automation requires permission confirmation", {
          automationId: event.automationId,
          type: "confirmation_required",
        }).catch(() => {})
      } else if (event.type === "skill_confirmation_required") {
        const auto = automationManager.get(event.automationId)
        const name = auto?.name || event.skillId
        sendPushNotification(alCfg, `${name} needs approval`, `Skill requires confirmation (risk score: ${event.riskReport.score})`, {
          automationId: event.automationId,
          type: "confirmation_required",
        }).catch(() => {})
      } else if (event.type === "daily_limit_reached") {
        sendPushNotification(alCfg, `${event.automationName} skipped`, `Daily run limit reached (${event.todayCount}/${event.limit}). Free plan has limited daily runs.`, {
          automationId: event.automationId,
          type: "daily_limit_reached",
        }).catch(() => {})
      } else if (event.type === "plan_review_required") {
        sendPushNotification(alCfg, `${event.automationName} awaiting review`, `Plan review required (timeout: ${event.timeoutMinutes}m). Approve or reject in the app.`, {
          automationId: event.automationId,
          type: "plan_review_required",
        }).catch(() => {})
      } else if (event.type === "reauth_required") {
        sendPushNotification(alCfg, `${event.automationName} needs reauth`, `Critical operation blocked: ${event.violationDescription}. Approve or deny in the app.`, {
          automationId: event.automationId,
          type: "reauth_required",
          permissionKey: event.permissionKey,
        }).catch(() => {})
      } else if (event.type === "phase_gate_waiting") {
        sendPushNotification(alCfg, `${event.gate.automationName} — Phase ${event.gate.completedPhase} done`, `Waiting for your decision to continue (${event.gate.totalTokensUsed}/${event.gate.tokenBudget} tokens)`, {
          automationId: event.gate.automationId,
          type: "phase_gate_waiting",
          completedPhase: String(event.gate.completedPhase),
        }).catch(() => {})
      }
    }
  }, { vaultPath: cfg.vaultPath, limits: ADMIN_LIMITS, schedulingEnabled: PORT !== 3456 })

  // --- Auth endpoints ---

  // --- First-launch pairing code (6 digits, shown in CLI) ---
  let pairingCode: string | null = null
  let pairingCodeExpiry = 0

  function generatePairingCode(): string {
    pairingCode = String(randomInt(100000, 1000000))
    pairingCodeExpiry = Date.now() + 5 * 60 * 1000 // 5 min expiry
    log.info(`\n  Pairing code: ${pairingCode}\n  (expires in 5 minutes)\n`)
    return pairingCode
  }

  // Generate first pairing code on startup if no devices paired yet
  if (!hasPairedDevices()) {
    generatePairingCode()
  }

  // --- Daemon info endpoint (localhost only, no auth required) ---
  // Used by sibling daemon and app failback to discover tunnel URLs
  app.get("/api/daemon-info", (req, res) => {
    // Restrict to localhost — this endpoint exposes tunnel URLs and should not be reachable via tunnel
    const remoteIp = req.socket.remoteAddress || ""
    const isLocalhost = remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1"
    if (!isLocalhost) {
      return res.status(403).json({ error: "Forbidden" })
    }
    res.json({
      port: PORT,
      role: PORT === 3457 ? "dev" : "release",
      tunnelUrl: (globalThis as any).__agentrune_tunnel_url__ || null,
      sibling: cachedSiblingInfo,
    })
  })

  app.get("/api/auth/check", (req, res) => {
    const deviceId = req.query.deviceId as string | undefined
    const isKnown = deviceId ? validateDeviceToken(deviceId, "") === false && hasPairedDevices() : false
    res.json({
      mode: hasPairedDevices() ? "token" : "pairing",
      deviceKnown: !!deviceId,
      hasPairedDevices: hasPairedDevices(),
    })
  })

  // Rate limiter for pairing attempts (brute-force protection)
  const pairAttempts = new Map<string, { count: number; resetAt: number }>()

  // Pair a new device with the 6-digit code shown in CLI
  app.post("/api/auth/pair", (req, res) => {
    // Rate limit by IP
    const ip = req.ip || req.socket.remoteAddress || "unknown"
    const now = Date.now()
    const attempt = pairAttempts.get(ip)
    if (attempt && attempt.resetAt > now && attempt.count >= 5) {
      return res.status(429).json({ error: "Too many pairing attempts. Try again later.", retryAfter: Math.ceil((attempt.resetAt - now) / 1000) })
    }
    if (!attempt || attempt.resetAt <= now) {
      pairAttempts.set(ip, { count: 1, resetAt: now + 60000 })
    } else {
      attempt.count++
    }

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
      // Phone token is valid and owns this device — issue a session token bound to client IP
      const authClientIp = getClientIp(req)
      const sessionToken = issueSessionToken(authClientIp)
      res.json({ authenticated: true, sessionToken })
    } catch (err: any) {
      log.error(`[cloud auth] Verification failed: ${err?.message || "unknown"}`)
      res.status(500).json({ error: "Verification failed" })
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

    // Validate CWD: must exist, be a directory, and be within user's home directory
    const resolvedCwd = resolve(cwd)
    const userHome = process.env.HOME || process.env.USERPROFILE || "."
    if (!isWithinDir(resolvedCwd, userHome)) {
      return res.status(400).json({ error: "Project path must be within user home directory" })
    }
    try {
      const stat = statSync(resolvedCwd)
      if (!stat.isDirectory()) return res.status(400).json({ error: "Path is not a directory" })
    } catch {
      return res.status(400).json({ error: "Path does not exist" })
    }

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    if (projects.find((p) => p.id === id)) return res.status(409).json({ error: "Project exists" })

    const project = { id, name, cwd: resolvedCwd }
    projects.push(project)

    saveProjectsToDisk(getProjectsPath(), projects)
    res.json(project)
  })

  app.patch("/api/projects/:id", (req, res) => {
    const idx = projects.findIndex((p) => p.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: "Project not found" })
    const { name } = req.body
    if (!name) return res.status(400).json({ error: "Missing name" })
    projects[idx].name = name
    saveProjectsToDisk(getProjectsPath(), projects)
    res.json(projects[idx])
  })

  app.delete("/api/projects/:id", (req, res) => {
    const idx = projects.findIndex((p) => p.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: "Project not found" })
    projects.splice(idx, 1)
    saveProjectsToDisk(getProjectsPath(), projects)
    res.json({ ok: true })
  })

  app.get("/api/sessions", (_req, res) => {
    const activeIds = new Set<string>()
    const allSessions = sessions.getAll().map((s) => {
      activeIds.add(s.id)
      // Attach worktree branch info if available
      const wtm = worktreeManagers.get(s.projectId)
      const wt = wtm?.get(s.id)
      return { ...s, status: "active" as const, worktreeBranch: wt?.branch || null, lastEventTitle: sessionLastTitle.get(s.id) || "" }
    })
    // Append recoverable sessions that are not currently active and not closed during this daemon lifetime
    const recoverable = cachedRecoverable.filter(r => !activeIds.has(r.id) && !closedSessionIds.has(r.id))
    res.json([...allSessions, ...recoverable])
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

      // Helper: parse JSONL files for session summary (first 64KB — injection prompts can be large)
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
            const buf = Buffer.alloc(65536)
            const bytesRead = readSync(fd, buf, 0, 65536, 0)
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
                  // Skip injection prompts — find the real first user message
                  if (/請先讀取\s*\.agentrune\//.test(text)) continue
                  if (/Get-Command.*ErrorAction.*SilentlyContinue/.test(text)) continue
                  if (/command -v .* >\/dev\/null 2>&1/.test(text)) continue
                  if (/^<[a-z][\w-]*>/.test(text)) continue
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
      log.error(`Failed to list sessions: ${err}`)
      res.status(500).json({ error: "Failed to list sessions" })
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

      // Parse full JSONL file
      const chunk = readFileSync(filePath, "utf-8")

      // Claude JSONL: each assistant line has ONE content block (thinking/tool_use/text).
      // Same message.id appears multiple times with different blocks.
      // We must collect all text blocks per message.id, in order.
      type MsgEntry = { role: string; texts: string[]; timestamp?: string; order: number }
      const msgMap = new Map<string, MsgEntry>() // keyed by message.id
      const ordered: MsgEntry[] = [] // for messages without id
      let orderCounter = 0

      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue
        try {
          const entry = JSON.parse(line)

          // User messages
          if (entry.type === "user" && entry.message?.content) {
            const text = typeof entry.message.content === "string"
              ? entry.message.content
              : Array.isArray(entry.message.content)
                ? entry.message.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n")
                : ""
            if (text.trim()) {
              ordered.push({ role: "user", texts: [text], timestamp: entry.timestamp, order: orderCounter++ })
            }
          }

          // Assistant messages — accumulate text blocks by message.id
          if (entry.type === "assistant" && entry.message?.content) {
            const textBlocks = Array.isArray(entry.message.content)
              ? entry.message.content.filter((b: { type: string }) => b.type === "text")
              : []
            const msgId = entry.message.id
            if (textBlocks.length > 0 && msgId) {
              const existing = msgMap.get(msgId)
              if (existing) {
                for (const b of textBlocks) if (b.text) existing.texts.push(b.text)
              } else {
                const e: MsgEntry = { role: "assistant", texts: textBlocks.map((b: { text: string }) => b.text).filter(Boolean), timestamp: entry.timestamp, order: orderCounter++ }
                msgMap.set(msgId, e)
                ordered.push(e)
              }
            }
          }

          // Codex format
          if (entry.type === "response_item" && entry.payload?.role === "user") {
            const content = entry.payload.content
            if (Array.isArray(content)) {
              const text = content.filter((c: { type: string }) => c.type === "input_text").map((c: { text: string }) => c.text).join("\n")
              if (text.trim()) ordered.push({ role: "user", texts: [text], timestamp: entry.timestamp, order: orderCounter++ })
            }
          }
          if (entry.type === "response_item" && entry.payload?.role === "assistant") {
            const content = entry.payload.content
            if (Array.isArray(content)) {
              const text = content.filter((c: { type: string }) => c.type === "output_text").map((c: { text: string }) => c.text).join("\n")
              if (text.trim()) ordered.push({ role: "assistant", texts: [text], timestamp: entry.timestamp, order: orderCounter++ })
            }
          }
        } catch { /* skip */ }
      }

      // Build final message list, sorted by order
      const messages = ordered
        .sort((a, b) => a.order - b.order)
        .filter(e => e.texts.length > 0)
        .map(e => ({
          role: e.role,
          text: e.texts.join("\n").slice(0, 2000),
          timestamp: e.timestamp,
        }))

      res.json(messages)
    } catch (err) {
      log.error(`Failed to read messages: ${err}`)
      res.status(500).json({ error: "Failed to read messages" })
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
    // Mark as closed immediately so it won't reappear as recoverable
    closedSessionIds.add(killId)
    persistClosedSessions()
    // Also remove from cachedRecoverable in-memory list
    cachedRecoverable = cachedRecoverable.filter(r => r.id !== killId)
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

  // --- Test: send decision_request to all connected APP clients ---
  app.post("/api/test-decision", (req, res) => {
    const { title, options } = req.body
    if (!options) return res.status(400).json({ error: "Missing options" })
    const event: AgentEvent = {
      id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: "decision_request",
      status: "waiting",
      title: title || "Test options",
      decision: { options },
    }
    // Store in all active sessions and broadcast to all connected clients
    let sent = 0
    for (const [client, sid] of clientSessions) {
      if (client.readyState === WebSocket.OPEN) {
        const list = sessionRecentEvents.get(sid)
        if (list) { list.push(event); persistEvents(sid, list) }
        client.send(JSON.stringify({ type: "event", event }))
        sent++
      }
    }
    res.json({ ok: true, eventId: event.id, sentTo: sent })
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

  // --- Serve uploaded images ---

  app.get("/api/uploads/:projectId/:filename", (req, res) => {
    try {
      const { projectId, filename } = req.params
      const project = projects.find(p => p.id === projectId)
      if (!project) return res.status(404).json({ error: "Project not found" })
      // Sanitize filename to prevent path traversal
      const safeName = basename(filename)
      const filePath = join(project.cwd, ".agentrune", "uploads", safeName)
      if (!existsSync(filePath)) return res.status(404).json({ error: "File not found" })
      // Set content type based on extension
      const ext = safeName.split(".").pop()?.toLowerCase() || ""
      const mimeTypes: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
      }
      res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream")
      res.setHeader("Cache-Control", "public, max-age=86400")
      res.send(readFileSync(filePath))
    } catch (err) {
      res.status(500).json({ error: "Failed to serve file" })
    }
  })

  // --- Voice cleanup ---

  app.post("/api/voice-cleanup", express.json(), async (req, res) => {
    const { text, agentId, apiKeys } = req.body
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Missing text" })
    }
    // Filter and pass API keys directly (no process.env mutation — prevents race conditions)
    const filteredKeys: Record<string, string> = {}
    if (apiKeys && typeof apiKeys === "object") {
      for (const [k, v] of Object.entries(apiKeys)) {
        if (ALLOWED_ENV_KEYS.has(k) && typeof v === "string" && v) {
          filteredKeys[k] = v
        }
      }
    }
    try {
      const { cleanupVoiceText } = await import("./voice-cleanup.js")
      const result = await cleanupVoiceText(text, agentId || "claude", filteredKeys)
      res.json(result)
    } catch (e: any) {
      log.error(`Voice cleanup error: ${e.message}`)
      res.status(500).json({ error: "Voice cleanup failed" })
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
          const OpenCC: any = await import("opencc-js")
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
            // Pass API keys directly (no process.env mutation — prevents race conditions)
            const filteredKeys2: Record<string, string> = {}
            const rawKeys = req.headers["x-api-keys"] as string
            if (rawKeys) {
              try {
                const parsed = JSON.parse(rawKeys)
                for (const [k, v] of Object.entries(parsed)) {
                  if (ALLOWED_ENV_KEYS.has(k) && typeof v === "string" && v) {
                    filteredKeys2[k] = v
                  }
                }
              } catch {}
            }
            const cleanup = await cleanupVoiceText(rawText, agentId, filteredKeys2)
            cleaned = cleanup.cleaned
          } catch (e: any) {
            log.warn(`Voice cleanup after transcribe failed: ${e.message}`)
          }
        }

        res.json({ text: rawText, cleaned, model: result.model, duration_ms: result.duration_ms })
      } catch (e: any) {
        log.error(`Voice transcribe error: ${e.message}`)
        res.status(500).json({ error: "Voice transcription failed" })
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
      res.status(500).json({ error: "Whisper setup failed" })
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
      res.status(500).json({ error: "Voice edit failed", edited: original })
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

  // --- Path validation: restrict file access to project directories ---
  /** Check if a resolved path is within a directory (handles prefix attacks and Windows case-insensitivity) */
  function isWithinDir(filePath: string, dir: string): boolean {
    let resolved = normalize(resolve(filePath))
    let dirResolved = normalize(resolve(dir))
    // Windows paths are case-insensitive
    if (process.platform === "win32") {
      resolved = resolved.toLowerCase()
      dirResolved = dirResolved.toLowerCase()
    }
    return resolved === dirResolved || resolved.startsWith(dirResolved + sep)
  }

  function isPathInProject(filePath: string): boolean {
    return projects.some(p => isWithinDir(filePath, p.cwd))
  }

  // --- File browser ---

  app.get("/api/browse", (req, res) => {
    // Browse is used to select folders when adding NEW projects.
    // Restricted to user's home directory tree to prevent full filesystem enumeration.
    const userHome = process.env.HOME || process.env.USERPROFILE || "."
    const rawPath = (req.query.path as string) || userHome
    const dirPath = normalize(resolve(rawPath))
    if (!isWithinDir(dirPath, userHome)) {
      return res.status(403).json({ error: "Access denied: path outside home directory" })
    }

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
    if (!isPathInProject(filePath)) return res.status(403).json({ error: "Access denied: path is outside project directories" })
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
      const raw = execFileSync("git", ["status", "--porcelain", "-b"], { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
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
    // Path traversal protection: ensure file stays within project directory
    const fullPath = normalize(resolve(project.cwd, file))
    if (!isWithinDir(fullPath, project.cwd)) {
      return res.status(403).json({ error: "Access denied: path outside project" })
    }

    try {
      let before = ""
      let after = ""
      try {
        before = execFileSync("git", ["show", `HEAD:${file}`], { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
      } catch { /* new file, no HEAD version */ }
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
    // Path traversal protection
    if (!isWithinDir(resolve(project.cwd, file), project.cwd)) {
      return res.status(403).json({ error: "Access denied: path outside project" })
    }

    try {
      // Get unified diff (staged + unstaged)
      let rawDiff = ""
      try {
        rawDiff = execFileSync("git", ["diff", "HEAD", "--", file], { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
      } catch { /* new file or no HEAD */ }

      // If no diff against HEAD, try diff for untracked/new files
      if (!rawDiff) {
        try {
          rawDiff = execFileSync("git", ["diff", "--no-index", "/dev/null", file], { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
        } catch (e: unknown) {
          // git diff --no-index exits with 1 when there are differences
          if (e && typeof e === "object" && "stdout" in e) rawDiff = (e as { stdout: string }).stdout || ""
        }
      }

      // Check staged status
      let stagedRaw = ""
      try {
        stagedRaw = execFileSync("git", ["diff", "--cached", "--", file], { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
      } catch { /* ok */ }
      const isFullyStaged = !!stagedRaw && !execFileSync("git", ["diff", "--", file], { cwd: project.cwd, encoding: "utf-8", timeout: 5000 }).trim()

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
    // Path traversal protection
    if (!isWithinDir(resolve(project.cwd, filePath), project.cwd)) {
      return res.status(403).json({ error: "Access denied: path outside project" })
    }

    try {
      if (!hunks || hunks.length === 0) {
        // Stage entire file
        execFileSync("git", ["add", filePath], { cwd: project.cwd, timeout: 5000 })
        res.json({ ok: true, message: `Staged ${filePath}` })
      } else {
        // Stage specific hunks via git apply
        // Get the full diff first
        let rawDiff = ""
        try {
          rawDiff = execFileSync("git", ["diff", "--", filePath], { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
        } catch { /* ok */ }

        if (!rawDiff) {
          // File might be untracked, just stage it
          execFileSync("git", ["add", filePath], { cwd: project.cwd, timeout: 5000 })
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
        execFileSync("git", ["apply", "--cached", "-"], { cwd: project.cwd, input: patchContent, timeout: 5000 })

        res.json({ ok: true, message: `Staged ${hunks.length} hunk(s) of ${filePath}` })
      }
    } catch (err: unknown) {
      log.error(`[git/stage] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Stage failed" })
    }
  })

  // --- Revert file or specific hunks ---
  app.post("/api/git/revert", express.json(), (req, res) => {
    const { project: projectId, filePath, hunks } = req.body as { project: string; filePath: string; hunks?: number[] }
    const project = projects.find((p) => p.id === projectId)
    if (!project || !filePath) return res.status(400).json({ error: "Missing project or filePath" })
    // Path traversal protection
    if (!isWithinDir(resolve(project.cwd, filePath), project.cwd)) {
      return res.status(403).json({ error: "Access denied: path outside project" })
    }

    try {
      if (!hunks || hunks.length === 0) {
        // Revert entire file
        // Check if file is tracked
        try {
          execFileSync("git", ["ls-files", "--error-unmatch", filePath], { cwd: project.cwd, timeout: 5000, stdio: "pipe" })
          execFileSync("git", ["checkout", "HEAD", "--", filePath], { cwd: project.cwd, timeout: 5000 })
        } catch {
          // Untracked file — cannot revert via git, would need to delete
          return res.status(400).json({ error: "Cannot revert untracked file" })
        }
        res.json({ ok: true, message: `Reverted ${filePath}` })
      } else {
        // Revert specific hunks via git apply --reverse
        let rawDiff = ""
        try {
          rawDiff = execFileSync("git", ["diff", "--", filePath], { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
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
        execFileSync("git", ["apply", "--reverse", "-"], { cwd: project.cwd, input: patchContent, timeout: 5000 })

        res.json({ ok: true, message: `Reverted ${hunks.length} hunk(s) of ${filePath}` })
      }
    } catch (err: unknown) {
      log.error(`[git/revert] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Revert failed" })
    }
  })

  app.post("/api/git/commit", (req, res) => {
    const { project: projectId, message, files } = req.body
    const project = projects.find((p) => p.id === projectId)
    if (!project || !message) return res.status(400).json({ error: "Missing project or message" })

    try {
      if (files && Array.isArray(files) && files.length > 0) {
        for (const f of files) {
          // Path traversal protection
          if (!isWithinDir(resolve(project.cwd, f), project.cwd)) {
            return res.status(403).json({ error: "Access denied: path outside project" })
          }
          execFileSync("git", ["add", f], { cwd: project.cwd, timeout: 5000 })
        }
      } else {
        execFileSync("git", ["add", "-A"], { cwd: project.cwd, timeout: 5000 })
      }
      const result = execFileSync("git", ["commit", "-m", message], { cwd: project.cwd, encoding: "utf-8", timeout: 10000 })
      const hashMatch = result.match(/\[[\w/-]+ ([a-f0-9]+)\]/)
      res.json({ hash: hashMatch?.[1] || "unknown", message })
    } catch (err: unknown) {
      log.error(`[git/commit] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Commit failed" })
    }
  })

  // --- Branch management ---

  app.get("/api/git/branches", (req, res) => {
    const projectId = req.query.project as string
    const project = projects.find((p) => p.id === projectId)
    if (!project) return res.status(404).json({ error: "Project not found" })

    try {
      const raw = execFileSync("git", ["branch", "-a", "--no-color"], { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
      const branches = raw.split("\n").filter(Boolean).map((l) => {
        const current = l.startsWith("* ")
        const name = l.replace(/^\*?\s+/, "").trim()
        const isRemote = name.startsWith("remotes/")
        return { name: isRemote ? name.replace("remotes/", "") : name, current, isRemote }
      })
      res.json({ branches })
    } catch (err: unknown) {
      log.error(`[git/branches] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Failed to list branches" })
    }
  })

  app.post("/api/git/branch-delete", express.json(), (req, res) => {
    const { project: projectId, branch, force } = req.body
    const proj = projects.find((p) => p.id === projectId)
    if (!proj || !branch) return res.status(400).json({ error: "Missing project or branch" })
    if (typeof branch !== "string" || branch.startsWith("-") || !/^[a-zA-Z0-9_\/.@-]+$/.test(branch)) return res.status(400).json({ error: "Invalid branch name" })

    try {
      const flag = force ? "-D" : "-d"
      execFileSync("git", ["branch", flag, branch], { cwd: proj.cwd, encoding: "utf-8", timeout: 5000 })
      res.json({ ok: true })
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : ""
      log.error(`[git/branch-delete] ${errMsg || err}`)
      if (errMsg.includes("not fully merged")) {
        res.status(409).json({ error: "Branch not fully merged. Use force delete.", notMerged: true })
      } else {
        res.status(500).json({ error: "Delete failed" })
      }
    }
  })

  app.post("/api/git/branch-checkout", express.json(), (req, res) => {
    const { project: projectId, branch } = req.body
    const proj = projects.find((p) => p.id === projectId)
    if (!proj || !branch) return res.status(400).json({ error: "Missing project or branch" })
    if (typeof branch !== "string" || branch.startsWith("-") || !/^[a-zA-Z0-9_\/.@-]+$/.test(branch)) return res.status(400).json({ error: "Invalid branch name" })

    try {
      execFileSync("git", ["checkout", branch], { cwd: proj.cwd, encoding: "utf-8", timeout: 10000 })
      res.json({ ok: true })
    } catch (err: unknown) {
      log.error(`[git/checkout] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Checkout failed" })
    }
  })

  // --- Worktree management ---

  app.get("/api/git/worktrees", (req, res) => {
    const projectId = req.query.project as string
    const project = projects.find((p) => p.id === projectId)
    if (!project) return res.status(404).json({ error: "Project not found" })

    try {
      const raw = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: project.cwd, encoding: "utf-8", timeout: 5000 })
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
      log.error(`[git/worktrees] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Failed to list worktrees" })
    }
  })

  app.post("/api/git/worktree-delete", express.json(), (req, res) => {
    const { project: projectId, path: wtPath, force } = req.body
    const proj = projects.find((p) => p.id === projectId)
    if (!proj || !wtPath) return res.status(400).json({ error: "Missing project or path" })
    if (typeof wtPath !== "string" || wtPath.startsWith("-")) return res.status(400).json({ error: "Invalid worktree path" })
    // Validate worktree path is within project directory or its parent
    const resolvedWt = resolve(wtPath)
    const projectParent = resolve(proj.cwd, "..")
    if (!isWithinDir(resolvedWt, projectParent)) {
      return res.status(400).json({ error: "Invalid worktree path" })
    }

    try {
      const args = ["worktree", "remove"]
      if (force) args.push("--force")
      args.push(resolvedWt)
      execFileSync("git", args, { cwd: proj.cwd, encoding: "utf-8", timeout: 10000 })
      res.json({ ok: true })
    } catch (err: unknown) {
      log.error(`[git/worktree-remove] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Remove failed" })
    }
  })

  // --- PRD endpoints (multi-PRD per project) ---

  const PRD_BASE = join(homedir(), ".agentrune", "prd")
  try { mkdirSync(PRD_BASE, { recursive: true }) } catch { /* ok */ }

  const safePid = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_")

  /** Get PRD directory for a project, auto-migrate old TaskStore format */
  function getPrdDir(projectId: string): string {
    const dir = join(PRD_BASE, safePid(projectId))
    try { mkdirSync(dir, { recursive: true }) } catch { /* ok */ }
    // Migrate old TaskStore → PrdItem (one-time)
    const oldPath = join(homedir(), ".agentrune", "tasks", `${safePid(projectId)}.json`)
    if (existsSync(oldPath)) {
      try {
        const old = JSON.parse(readFileSync(oldPath, "utf-8"))
        if (old.prd || old.tasks?.length) {
          const prdId = `prd_${old.createdAt || Date.now()}`
          const migrated: PrdItem = {
            id: prdId,
            title: old.prd?.goal || old.requirement || "Migrated PRD",
            priority: "p1",
            status: old.tasks?.every((t: any) => t.status === "done" || t.status === "completed" || t.status === "skipped") ? "done" : "active",
            goal: old.prd?.goal || old.requirement || "",
            decisions: old.prd?.decisions || [],
            approaches: old.prd?.approaches || [],
            scope: old.prd?.scope || { included: [], excluded: [] },
            tasks: (old.tasks || []).map((t: any) => ({ ...t, priority: undefined })),
            createdAt: old.createdAt || Date.now(),
            updatedAt: old.updatedAt || Date.now(),
          }
          writeFileSync(join(dir, `${prdId}.json`), JSON.stringify(migrated, null, 2))
        }
        // Remove old file after successful migration
        unlinkSync(oldPath)
        log.info(`[PRD] Migrated old TaskStore → ${dir}`)
      } catch (err: any) {
        log.warn(`[PRD] Migration failed: ${err.message}`)
      }
    }
    return dir
  }

  function readPrd(filePath: string): PrdItem | null {
    try { return JSON.parse(readFileSync(filePath, "utf-8")) } catch { return null }
  }

  function checkAutoComplete(prd: PrdItem): boolean {
    if (prd.status === "done" || prd.tasks.length === 0) return false
    const allDone = prd.tasks.every(t => t.status === "done" || t.status === "skipped")
    if (allDone) {
      prd.status = "done"
      prd.updatedAt = Date.now()
      return true
    }
    return false
  }

  // List all PRDs for a project (summaries)
  app.get("/api/prd/:projectId", (req, res) => {
    const dir = getPrdDir(req.params.projectId)
    try {
      const files = readdirSync(dir).filter(f => f.endsWith(".json")).sort()
      const summaries = files.map(f => {
        const prd = readPrd(join(dir, f))
        if (!prd) return null
        return {
          id: prd.id,
          title: prd.title,
          priority: prd.priority,
          status: prd.status,
          tasksDone: prd.tasks.filter(t => t.status === "done").length,
          tasksSkipped: prd.tasks.filter(t => t.status === "skipped").length,
          tasksTotal: prd.tasks.length,
          createdAt: prd.createdAt,
          updatedAt: prd.updatedAt,
        }
      }).filter(Boolean)
      // Sort: active before done, then by priority (p0 first), then by updatedAt desc
      summaries.sort((a: any, b: any) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1
        if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1
        return b.updatedAt - a.updatedAt
      })
      res.json(summaries)
    } catch {
      res.json([])
    }
  })

  // Get full PRD detail
  app.get("/api/prd/:projectId/:prdId", (req, res) => {
    const prd = readPrd(join(getPrdDir(req.params.projectId), `${safePid(req.params.prdId)}.json`))
    if (!prd) return res.status(404).json({ error: "PRD not found" })
    res.json(prd)
  })

  // Create new PRD
  app.post("/api/prd/:projectId", (req, res) => {
    const { title, priority, goal, decisions, approaches, scope, tasks } = req.body
    if (!title && !goal) return res.status(400).json({ error: "title or goal is required" })
    const prdId = `prd_${Date.now()}`
    const prd: PrdItem = {
      id: prdId,
      title: title || goal || "",
      priority: priority || "p1",
      status: "active",
      goal: goal || title || "",
      decisions: decisions || [],
      approaches: approaches || [],
      scope: scope || { included: [], excluded: [] },
      tasks: (tasks || []).map((t: any, i: number) => ({
        id: t.id || i + 1,
        title: t.title || "",
        description: t.description || "",
        status: t.status || "pending",
        priority: t.priority,
        dependsOn: t.dependsOn || [],
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const dir = getPrdDir(req.params.projectId)
    writeFileSync(join(dir, `${prdId}.json`), JSON.stringify(prd, null, 2))
    // Broadcast to connected clients so PlanPanel auto-refreshes
    for (const ws of wss.clients) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "prd_changed", projectId: req.params.projectId, prdId }))
    }
    res.json(prd)
  })

  // Update PRD metadata (priority, status, title)
  app.patch("/api/prd/:projectId/:prdId", (req, res) => {
    const filePath = join(getPrdDir(req.params.projectId), `${safePid(req.params.prdId)}.json`)
    const prd = readPrd(filePath)
    if (!prd) return res.status(404).json({ error: "PRD not found" })
    if (req.body.priority) prd.priority = req.body.priority
    if (req.body.status) prd.status = req.body.status
    if (req.body.title) prd.title = req.body.title
    if (req.body.goal) prd.goal = req.body.goal
    prd.updatedAt = Date.now()
    writeFileSync(filePath, JSON.stringify(prd, null, 2))
    for (const ws of wss.clients) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "prd_changed", projectId: req.params.projectId, prdId: req.params.prdId }))
    }
    res.json(prd)
  })

  // Add task to a PRD
  app.post("/api/prd/:projectId/:prdId/tasks", (req, res) => {
    const filePath = join(getPrdDir(req.params.projectId), `${safePid(req.params.prdId)}.json`)
    const prd = readPrd(filePath)
    if (!prd) return res.status(404).json({ error: "PRD not found" })
    const { title, description, priority, dependsOn } = req.body
    if (!title) return res.status(400).json({ error: "title is required" })
    const maxId = prd.tasks.reduce((m, t) => Math.max(m, t.id), 0)
    const task = { id: maxId + 1, title, description: description || "", status: "pending" as const, priority: priority as PrdPriority | undefined, dependsOn: dependsOn || [] }
    prd.tasks.push(task)
    prd.updatedAt = Date.now()
    writeFileSync(filePath, JSON.stringify(prd, null, 2))
    for (const ws of wss.clients) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "prd_changed", projectId: req.params.projectId, prdId: req.params.prdId }))
    }
    res.json(task)
  })

  // Update task in a PRD (with auto-complete check)
  app.patch("/api/prd/:projectId/:prdId/tasks/:taskId", (req, res) => {
    const filePath = join(getPrdDir(req.params.projectId), `${safePid(req.params.prdId)}.json`)
    const prd = readPrd(filePath)
    if (!prd) return res.status(404).json({ error: "PRD not found" })
    const taskId = parseInt(req.params.taskId)
    const task = prd.tasks.find(t => t.id === taskId)
    if (!task) return res.status(404).json({ error: "Task not found" })
    if (req.body.status) task.status = req.body.status
    if (req.body.title) task.title = req.body.title
    if (req.body.description !== undefined) task.description = req.body.description
    if (req.body.priority !== undefined) task.priority = req.body.priority
    prd.updatedAt = Date.now()
    const autoCompleted = checkAutoComplete(prd)
    writeFileSync(filePath, JSON.stringify(prd, null, 2))
    for (const ws of wss.clients) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "prd_changed", projectId: req.params.projectId, prdId: req.params.prdId }))
    }
    res.json({ task, prdAutoCompleted: autoCompleted })
  })

  // Delete a PRD
  app.delete("/api/prd/:projectId/:prdId", (req, res) => {
    const filePath = join(getPrdDir(req.params.projectId), `${safePid(req.params.prdId)}.json`)
    if (!existsSync(filePath)) return res.status(404).json({ error: "PRD not found" })
    try { unlinkSync(filePath) } catch {}
    res.json({ ok: true })
  })

  // --- Legacy Tasks endpoints (backward compat, redirects to PRD) ---

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
    const { requirement, tasks, prd } = req.body
    const filePath = join(TASKS_DIR, `${req.params.projectId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`)
    let existing: TaskStore | null = null
    try { existing = existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf-8")) : null } catch {}
    const store: TaskStore = {
      projectId: req.params.projectId,
      requirement: requirement ?? existing?.requirement ?? "",
      tasks: tasks ?? existing?.tasks ?? [],
      prd: prd ?? existing?.prd,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    writeFileSync(filePath, JSON.stringify(store, null, 2))
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
      if (req.body.title) task.title = req.body.title
      if (req.body.description !== undefined) task.description = req.body.description
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

  // --- Project Summary (aggregate events across sessions) ---

  app.post("/api/project-summary", express.json(), async (req, res) => {
    const { projectId } = req.body || {}
    if (!projectId) {
      return res.status(400).json({ error: "Missing projectId" })
    }

    try {
      // Collect events from all sessions belonging to this project
      const projectSessions = eventStore.getSessionsByProject(projectId)
      if (projectSessions.length === 0) {
        return res.json({ summary: "No sessions found for this project." })
      }

      // Gather recent events from all sessions (newest first, cap at 200)
      const allEvents: AgentEvent[] = []
      for (const session of projectSessions) {
        const events = eventStore.getSessionEvents(session.id)
        allEvents.push(...events)
      }
      allEvents.sort((a, b) => b.timestamp - a.timestamp)
      const recentEvents = allEvents.slice(0, 200)

      // Build a concatenated text from event titles/details
      const eventLines = recentEvents.map(e => {
        const ts = new Date(e.timestamp).toISOString().slice(0, 16)
        const detail = e.detail ? ` — ${e.detail.slice(0, 120)}` : ""
        return `[${ts}] ${e.type}: ${e.title}${detail}`
      })
      const concatenated = eventLines.join("\n")

      log.info(`[project-summary] sessions=${projectSessions.length} events=${allEvents.length} textLen=${concatenated.length}`)

      // Try LLM-based summary with dedicated summarization prompt
      try {
        const { callLlmForSummary } = await import("./llm-summary.js")
        const summary = await callLlmForSummary(concatenated)
        log.info(`[project-summary] LLM result: ${summary ? summary.slice(0, 80) : "(null)"}`)
        if (summary) {
          return res.json({ summary })
        }
      } catch (llmErr: any) {
        log.warn(`Project summary LLM fallback: ${llmErr.message}`)
      }

      // Fallback: return concatenated event summaries
      res.json({ summary: concatenated })
    } catch (e: any) {
      log.error(`Project summary error: ${e.message}`)
      res.status(500).json({ error: "Failed to generate summary" })
    }
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
      log.error(`[vault/read] ${err instanceof Error ? err.message : err}`)
      res.json({ context: "Error reading vault" })
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

  // --- Standards endpoints ---

  app.get("/api/standards", (_req, res) => {
    const cwd = resolveProjectCwd()
    const standards = loadStandards(cwd || undefined)
    res.json(standards)
  })

  app.get("/api/standards/categories/:categoryId/rules", (req, res) => {
    const cwd = resolveProjectCwd()
    const standards = loadStandards(cwd || undefined)
    const category = standards.categories.find(c => c.id === req.params.categoryId)
    if (!category) { res.status(404).json({ error: "Category not found" }); return }
    res.json(category)
  })

  app.post("/api/standards/categories", express.json(), (req, res) => {
    const { id, name, icon, description, scope } = req.body as { id: string; name: Record<string, string>; icon: string; description: Record<string, string>; scope?: string }
    if (!id || !name) { res.status(400).json({ error: "Missing id or name" }); return }
    const cwd = resolveProjectCwd()
    const dir = scope === "global" ? getGlobalStandardsDir() : cwd ? getProjectStandardsDir(cwd) : getGlobalStandardsDir()
    saveCategory(dir, { id, name, icon: icon || "file-text", description: description || { en: "", "zh-TW": "" }, builtin: false })
    log.info(`[Standards] Saved category: ${id} to ${dir}`)
    res.json({ ok: true })
  })

  app.delete("/api/standards/categories/:categoryId", (req, res) => {
    const cwd = resolveProjectCwd()
    const dir = cwd ? getProjectStandardsDir(cwd) : getGlobalStandardsDir()
    deleteCategory(dir, req.params.categoryId)
    log.info(`[Standards] Deleted category: ${req.params.categoryId}`)
    res.json({ ok: true })
  })

  app.post("/api/standards/rules", express.json(), (req, res) => {
    const { categoryId, rule, scope } = req.body as { categoryId: string; rule: any; scope?: string }
    if (!categoryId || !rule?.id) { res.status(400).json({ error: "Missing categoryId or rule" }); return }
    const cwd = resolveProjectCwd()
    const dir = scope === "global" ? getGlobalStandardsDir() : cwd ? getProjectStandardsDir(cwd) : getGlobalStandardsDir()
    saveRule(dir, categoryId, rule)
    log.info(`[Standards] Saved rule: ${categoryId}/${rule.id}`)
    res.json({ ok: true })
  })

  app.delete("/api/standards/rules/:categoryId/:ruleId", (req, res) => {
    const cwd = resolveProjectCwd()
    const dir = cwd ? getProjectStandardsDir(cwd) : getGlobalStandardsDir()
    deleteRule(dir, req.params.categoryId, req.params.ruleId)
    log.info(`[Standards] Deleted rule: ${req.params.categoryId}/${req.params.ruleId}`)
    res.json({ ok: true })
  })

  app.post("/api/standards/validate", express.json(), (req, res) => {
    const { prdTaskCount } = req.body || {}
    const cwd = resolveProjectCwd()
    if (!cwd) { res.status(400).json({ error: "No active project" }); return }
    const standards = loadStandards(cwd)
    const report = validateStandards(standards, cwd, { prdTaskCount })
    res.json(report)
  })

  // --- Insight endpoints ---

  app.post("/api/insight/generate", express.json(), (req, res) => {
    const { projectId, sessionId } = req.body as { projectId?: string; sessionId?: string }

    // Gather events from in-memory sessionRecentEvents (persisted events files)
    // EventStore sessions/ is often empty; sessionRecentEvents is the live source
    let events: AgentEvent[] = []
    if (sessionId) {
      events = sessionRecentEvents.get(sessionId) || []
      // Fallback: try loading from persisted events file
      if (events.length === 0) {
        events = loadPersistedEvents(sessionId)
      }
    } else {
      // Find sessions for the project from PtyManager (live sessions)
      const pid = projectId || projects[0]?.id
      if (pid) {
        const projectSessions = sessions.getByProject(pid)
        // Collect events from all project sessions, pick the one with most events
        let bestEvents: AgentEvent[] = []
        for (const s of projectSessions) {
          const sEvents = sessionRecentEvents.get(s.id) || loadPersistedEvents(s.id)
          if (sEvents.length > bestEvents.length) bestEvents = sEvents
        }
        events = bestEvents
      }
    }

    if (events.length === 0) {
      return res.json({ markdown: "", empty: true })
    }

    // Extract meaningful events for insight
    const errors = events.filter(e => e.type === "error")
    const fixes = events.filter(e => e.type === "file_edit" || e.type === "file_create")
    const deletes = events.filter(e => e.type === "file_delete")
    const commands = events.filter(e => e.type === "command_run")
    const decisions = events.filter(e => e.type === "decision_request")
    const tests = events.filter(e => e.type === "test_result")
    const summaryEvents = events.filter(e => e.type === "session_summary" || e.type === "progress_report")
    const responses = events.filter(e => e.type === "response" || e.type === "info")

    // Helper: strip common path prefix to show short relative paths
    const shortPath = (p: string) => {
      return p
        .replace(/^.*[/\\](src[/\\])/, "$1")
        .replace(/^.*[/\\](app[/\\]src[/\\])/, "$1")
        .replace(/^.*[/\\](components[/\\])/, "$1")
        .replace(/^.*[/\\](lib[/\\])/, "$1")
        .replace(/^.*[/\\](pages[/\\])/, "$1")
        .replace(/\\/g, "/")
    }

    // Build markdown report
    const lines: string[] = []
    lines.push("# Session Insight Report\n")

    // Overview stats
    const statsItems: string[] = []
    if (fixes.length > 0) statsItems.push(`${fixes.length} file edits`)
    if (deletes.length > 0) statsItems.push(`${deletes.length} deletions`)
    if (commands.length > 0) statsItems.push(`${commands.length} commands`)
    if (errors.length > 0) statsItems.push(`${errors.length} errors`)
    if (tests.length > 0) statsItems.push(`${tests.length} test runs`)
    if (statsItems.length > 0) {
      lines.push(`> ${statsItems.join(" · ")}\n`)
    }

    // Summary from AI responses (the actual insight)
    if (summaryEvents.length > 0) {
      lines.push("## Summary\n")
      for (const e of summaryEvents.slice(-3)) {
        lines.push(e.title)
        if (e.detail) lines.push(`\n${e.detail.slice(0, 500)}`)
      }
      lines.push("")
    } else if (responses.length > 0) {
      // Extract key insights from response events
      lines.push("## What Happened\n")
      const meaningful = responses
        .filter(e => e.title && e.title.length > 20 && !e.title.startsWith("Running"))
        .slice(-5)
      if (meaningful.length > 0) {
        for (const e of meaningful) {
          lines.push(`- ${e.title.slice(0, 150)}`)
        }
      } else {
        // Infer from file changes
        const fileNames = new Set<string>()
        for (const e of fixes) {
          const p = shortPath(e.diff?.filePath || e.title)
          fileNames.add(p.split("/").pop() || p)
        }
        if (fileNames.size > 0) {
          lines.push(`Modified ${fileNames.size} file(s): ${[...fileNames].join(", ")}`)
        }
      }
      lines.push("")
    }

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
        const rawPath = e.diff?.filePath || e.title
        const short = shortPath(rawPath)
        if (!seen.has(short)) {
          seen.add(short)
          lines.push(`- \`${short}\``)
        }
      }
      lines.push("")
    }

    // Only show completed commands with actual content
    const finishedCommands = commands.filter(e => e.status === "completed" && e.title && e.title !== "Running command")
    if (finishedCommands.length > 0) {
      lines.push("## Commands\n")
      const seenCmds = new Set<string>()
      for (const e of finishedCommands.slice(-8)) {
        const cmd = e.title.slice(0, 80)
        if (!seenCmds.has(cmd)) {
          seenCmds.add(cmd)
          lines.push(`- \`${cmd}\``)
        }
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

    if (tests.length > 0) {
      const passed = tests.filter(e => e.status === "completed").length
      const failed = tests.filter(e => e.status === "failed").length
      lines.push("## Tests\n")
      lines.push(`- ${passed} passed, ${failed} failed`)
      lines.push("")
    }

    // Build sourceText for submission
    const sourceText = lines.join("\n")
    const title = errors.length > 0
      ? `Debug: ${errors[0].title.slice(0, 60)}`
      : summaryEvents.length > 0
        ? summaryEvents[summaryEvents.length - 1].title.slice(0, 60)
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
      log.error(`[submit-knowledge] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Submit failed" })
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
    const { name, command, prompt, skill, templateId, schedule, runMode, agentId, locale, model, bypass, crew } = req.body
    // Crew automations don't need a prompt (roles have their own prompts)
    if (!name || !schedule || (!command && !prompt && !crew)) {
      return res.status(400).json({ error: "name, schedule, and (prompt or command or crew) are required" })
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
      locale: typeof locale === "string" ? locale : undefined,
      model: model || undefined,
      bypass: bypass || false,
      enabled: req.body.enabled !== false,
      crew: crew || undefined,
    })
    if ("error" in auto) return res.status(429).json(auto)
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

  app.get("/api/automations/:projectId/:id/crew-reports", (req, res) => {
    const reports = automationManager.getCrewReports(req.params.id)
    res.json(reports)
  })

  app.get("/api/automations/:projectId/:id/scan-conflicts", (req, res) => {
    const level = req.query.level as string | undefined
    const validLevels = ["strict", "moderate", "permissive", "none"]
    if (level && !validLevels.includes(level)) {
      return res.status(400).json({ error: `Invalid level. Must be one of: ${validLevels.join(", ")}` })
    }
    const result = automationManager.scanConflicts(req.params.id, level as any)
    if (!result) return res.status(404).json({ error: "Automation not found or has no prompt" })
    res.json(result)
  })

  app.get("/api/automations/:projectId/:id/constraints", (req, res) => {
    const auto = automationManager.get(req.params.id)
    if (!auto) return res.status(404).json({ error: "Automation not found" })
    const project = projects.find(p => p.id === req.params.projectId)
    try {
      const authorityMap = createFromTrustProfile({
        sessionId: auto.id,
        automationId: auto.id,
        sandboxLevel: auto.sandboxLevel,
        requirePlanReview: auto.requirePlanReview,
        requireMergeApproval: auto.requireMergeApproval,
      })
      const constraintSet = buildPlanningConstraints({
        projectPath: project?.cwd,
        sandboxLevel: auto.sandboxLevel || "strict",
        manifest: auto.manifest,
        authorityMap,
        trustProfile: auto.trustProfile,
      })
      res.json(constraintSet)
    } catch (err) {
      log.error(`[constraints] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Failed to build constraints" })
    }
  })

  // ── Audit log API (rate limited: 30 req/min) ──
  const auditRateMap = new Map<string, { count: number; resetAt: number }>()
  const AUDIT_RATE_LIMIT = 30
  const AUDIT_RATE_WINDOW = 60_000

  function checkAuditRate(ip: string): boolean {
    const now = Date.now()
    const entry = auditRateMap.get(ip)
    if (!entry || now > entry.resetAt) {
      auditRateMap.set(ip, { count: 1, resetAt: now + AUDIT_RATE_WINDOW })
      return true
    }
    entry.count++
    return entry.count <= AUDIT_RATE_LIMIT
  }

  function auditRateLimiter(req: any, res: any, next: any) {
    const ip = req.ip || req.socket.remoteAddress || "unknown"
    if (!checkAuditRate(ip)) {
      return res.status(429).json({ error: "Too many requests", retryAfter: 60 })
    }
    next()
  }

  app.get("/api/audit", auditRateLimiter, (_req, res) => {
    const dates = listAuditDates()
    res.json({ dates })
  })

  app.get("/api/audit/recent", auditRateLimiter, (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50
    res.json(getRecentAuditEntries(Math.min(limit, 200)))
  })

  app.get("/api/audit/:date", auditRateLimiter, (req, res) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
      return res.status(400).json({ error: "Invalid date format (expected YYYY-MM-DD)" })
    }
    res.json(readAuditLog(req.params.date))
  })

  app.get("/api/audit/automation/:automationId", auditRateLimiter, (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50
    res.json(getAutomationAudit(req.params.automationId, Math.min(limit, 200)))
  })

  app.post("/api/automations/:projectId/:id/trigger", async (req, res) => {
    try {
      const result = await automationManager.trigger(req.params.id)
      if (!result.ok) return res.status(429).json({ error: "Automation trigger rate limited" })
      res.json({ ok: true })
    } catch (err) {
      log.error(`[automation/trigger] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Trigger failed" })
    }
  })

  // Fire-and-forget: create temp automation and execute immediately (no scheduling)
  app.post("/api/automations/:projectId/fire", express.json(), async (req, res) => {
    try {
      const { crew, sessionContext, name } = req.body
      if (!crew || !crew.roles || !Array.isArray(crew.roles)) {
        return res.status(400).json({ error: "crew config with roles is required" })
      }
      const projectId = req.params.projectId
      const autoName = name || `fire_${Date.now()}`
      const autoId = await automationManager.fireAndForget(projectId, autoName, crew, sessionContext)
      res.json({ ok: true, automationId: autoId })
    } catch (err) {
      log.error(`[automation/fire] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Fire failed" })
    }
  })

  app.post("/api/automations/:projectId/:id/approve-merge", (req, res) => {
    try {
      const result = automationManager.approveWorktreeMerge(req.params.id)
      if (!result.success) return res.status(404).json({ error: "Merge approval failed or not found" })
      res.json(result)
    } catch (err) {
      log.error(`[automation/approve-merge] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Merge approval failed" })
    }
  })

  app.get("/api/automations/pending-merges", (_req, res) => {
    res.json(automationManager.listPendingMerges())
  })

  // --- Reauth API ---

  app.get("/api/automations/pending-reauths", (_req, res) => {
    res.json(automationManager.listPendingReauths())
  })

  app.post("/api/automations/:projectId/:id/reauth", express.json(), async (req, res) => {
    try {
      const { action, noExpiry } = req.body
      if (!action || !["approve", "deny"].includes(action)) {
        return res.status(400).json({ error: "action must be 'approve' or 'deny'" })
      }
      const result = await automationManager.resolveReauth(req.params.id, action, { noExpiry: noExpiry === true })
      if (!result.success) return res.status(404).json({ error: result.message })
      res.json(result)
    } catch (err) {
      log.error(`[automation/reauth] ${err instanceof Error ? err.message : err}`)
      res.status(500).json({ error: "Reauth resolution failed" })
    }
  })

  // --- Skill security API ---

  app.post("/api/skill-analyze", express.json(), (req, res) => {
    const { content, manifest } = req.body
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "content (string) is required" })
    }
    try {
      const report = analyzeSkillContent(content, manifest)
      res.json(report)
    } catch (err) {
      // analyzeSkillContent should never throw, but safety first
      res.json({ score: 0, level: "low", findings: [], requiresManualReview: false, analyzedAt: Date.now() })
    }
  })

  app.get("/api/skill-trust", (_req, res) => {
    res.json(automationManager.getWhitelist().list())
  })

  app.post("/api/skill-trust", express.json(), (req, res) => {
    const { skillId, level, riskScore } = req.body
    if (!skillId || !level) {
      return res.status(400).json({ error: "skillId and level are required" })
    }
    if (level !== "full" && level !== "prompt-only") {
      return res.status(400).json({ error: "level must be 'full' or 'prompt-only'" })
    }
    const entry = automationManager.getWhitelist().trust(skillId, level, riskScore ?? 0)
    res.json(entry)
  })

  app.delete("/api/skill-trust/:skillId", (req, res) => {
    const revoked = automationManager.getWhitelist().revoke(req.params.skillId)
    if (!revoked) return res.status(404).json({ error: "Skill not found in trust list" })
    res.json({ ok: true })
  })

  app.post("/api/skill-trust/:automationId/confirm", express.json(), (req, res) => {
    const { action } = req.body
    if (!action || !["approve", "approve_and_trust", "deny"].includes(action)) {
      return res.status(400).json({ error: "action must be 'approve', 'approve_and_trust', or 'deny'" })
    }
    const resolved = automationManager.resolveConfirmation(req.params.automationId, action)
    if (!resolved) return res.status(404).json({ error: "No pending confirmation for this automation" })
    res.json({ ok: true })
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

  // --- WS rate limiting (per-client) ---
  const WS_RATE_LIMIT = 120 // max messages per window
  const WS_RATE_WINDOW = 1000 // 1 second window
  const wsRateMap = new WeakMap<WebSocket, { count: number; resetAt: number }>()

  // Per-PTY-session state (survives WS reconnects)
  const sessionEngines = new Map<string, ParseEngine>()
  const sessionRecentEvents = new Map<string, AgentEvent[]>()
  const sessionJsonlWatchers = new Map<string, { stop(): void; rescan?(): void; buildResumeOptions?(): AgentEvent | null; [key: string]: any }>()

  // Per-session timer for delayed Resume Session detection
  const resumeTimers = new Map<string, NodeJS.Timeout>()
  const resumeCursorOffset = new Map<string, number>()
  const resumeDecisionDone = new Set<string>() // Sessions where user already chose a resume option

  // --- Agent crash detection ---
  // Track last JSONL activity per session — if agent wrote to JSONL recently, it's alive
  const lastJsonlActivity = new Map<string, number>()
  // Track pending tool execution — if agent has a command_run in_progress, shell prompts are expected
  const pendingToolUse = new Map<string, number>()
  // Tracks sessions where the agent process exited back to shell prompt.
  // Key = sessionId, Value = { detectedAt, agentId, notified }
  const crashedSessions = new Map<string, { detectedAt: number; agentId: string; notified: boolean }>()
  // Pending crash detection (debounce — first shell prompt sighting, needs confirmation)
  const crashPending = new Map<string, number>()
  // Grace period after restart — suppress crash detection while agent boots
  const restartGrace = new Map<string, number>()
  // Track restart attempts — if agent exits again after restart, don't re-trigger crash loop
  const crashRestartCount = new Map<string, number>()
  const crashPushCooldown = new Map<string, number>()
  // Store launch settings per session so we can restart with the same config
  const sessionLaunchSettings = new Map<string, LaunchSessionState>()

  wss.on("connection", (ws, req) => {
    wsAlive.set(ws, true)
    ws.on("pong", () => wsAlive.set(ws, true))
    log.info(`WS connection from ${req.socket.remoteAddress} authenticated=${!!(new URL(req.url || "/", "http://localhost").searchParams.get("token"))}`)

    // Push CLI update notification to app
    if (updateInfo) {
      ws.send(JSON.stringify({ type: "cli_update_available", latest: updateInfo.latest, current: updateInfo.current, changelog: updateInfo.changelog }))
    }

    // Auth check for WebSocket
    // Session tokens are persisted to disk, so they survive daemon restarts.
    // If a token is truly expired (>24h), issue a fresh one instead of
    // rejecting — this prevents reconnect loops while keeping auth valid.
    const url = new URL(req.url || "/", "http://localhost")
    const token = url.searchParams.get("token") || ""
    const isLocal = url.searchParams.get("local") === "1" &&
      (req.socket.remoteAddress === "127.0.0.1" || req.socket.remoteAddress === "::1" || req.socket.remoteAddress === "::ffff:127.0.0.1")
    if (!isLocal) {
      // Reject connections with no token or invalid token
      if (!token) {
        ws.send(JSON.stringify({ type: "error", message: "Authentication required" }))
        ws.close()
        return
      }
      const wsClientIp = getClientIp(req)
      // Check local cache with IP binding
      const wsBoundIp = sessionTokens.get(token)
      if (wsBoundIp !== undefined) {
        if (wsBoundIp && wsClientIp && wsBoundIp !== wsClientIp) {
          ws.send(JSON.stringify({ type: "error", message: "Session bound to different network" }))
          ws.close()
          return
        }
      } else if (!validateSessionToken(token, wsClientIp)) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid or expired token" }))
        ws.close()
        return
      }
    }

    // Send daemon role info + current tunnel URL so app can update its stored URL
    // NOTE: Do NOT send refreshToken — app should use its own phoneToken for AgentLore API calls
    const daemonRole = PORT === 3457 ? "dev" : "release"
    const currentTunnelUrl = (globalThis as any).__agentrune_tunnel_url__ || undefined
    const agentloreCfg = config.agentlore
    ws.send(JSON.stringify({
      type: "daemon_info",
      role: daemonRole,
      port: PORT,
      tunnelUrl: currentTunnelUrl,
      daemonDeviceId: agentloreCfg?.deviceId || undefined,
    }))

    // Send pending phase gates on reconnect (state recovery)
    const pendingGates = automationManager.listPendingPhaseGates()
    for (const gate of pendingGates) {
      ws.send(JSON.stringify({ type: "phase_gate_waiting", gate }))
    }

    ws.on("message", (raw) => {
      // Rate limiting
      const now = Date.now()
      const rate = wsRateMap.get(ws) || { count: 0, resetAt: now + WS_RATE_WINDOW }
      if (now > rate.resetAt) { rate.count = 0; rate.resetAt = now + WS_RATE_WINDOW }
      rate.count++
      wsRateMap.set(ws, rate)
      if (rate.count > WS_RATE_LIMIT) {
        ws.send(JSON.stringify({ type: "error", message: "Rate limit exceeded" }))
        return
      }

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
        case "set_fcm_token": {
          const token = msg.token as string
          if (token && typeof token === "string" && token.length > 10) {
            const fcmPath = join(getConfigDir(), "fcm-token")
            writeFileSync(fcmPath, token, { encoding: "utf-8" })
            log.info(`[FCM] Token saved (${token.slice(0, 12)}...)`)
            ws.send(JSON.stringify({ type: "fcm_token_saved" }))
          }
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

          const requestedAgentId = (msg.agentId as string) || "terminal"
          if (requestedAgentId !== "terminal" && !isLaunchAgentId(requestedAgentId)) {
            ws.send(JSON.stringify({ type: "error", message: `Unsupported agent: ${requestedAgentId}` }))
            return
          }

          const agentId: LaunchAgentId | "terminal" = requestedAgentId === "terminal" ? "terminal" : requestedAgentId
          const rawSettings = asSettingsRecord(msg.settings)
          const normalizedSettings = normalizeAgentSettings(rawSettings)
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
            engine = new ParseEngine(agentId, projectId, sessionProject.cwd)
            sessionEngines.set(session.id, engine)
            sessionRecentEvents.set(session.id, [])
          }
          clientEngines.set(ws, engine)

          // --- Structured session watchers (replace ANSI parsing for supported agents) ---
          // Common callback: store events, send to clients, broadcast activity
          const makeWatcherCallback = (sid: string) => (events: AgentEvent[]) => {
            // Filter out user_message events — APP client creates its own usr_* events
            // (keeping them in storage would cause duplicates on replay)
            const filtered = events.filter(e => e.type !== "user_message")
            if (filtered.length === 0) return

            log.info(`[watcher-cb] sid=${sid} events=${filtered.length} types=${filtered.map(e=>e.type).join(",")}`)
            // Mark agent as alive
            lastJsonlActivity.set(sid, Date.now())
            // Track pending commands — if a command_run is in_progress, agent is running a tool
            for (const e of filtered) {
              if (e.type === "command_run" && e.status === "in_progress") {
                pendingToolUse.set(sid, Date.now())
              } else if (e.type === "command_run" && (e.status === "completed" || e.status === "failed")) {
                pendingToolUse.delete(sid)
              } else if (e.type !== "command_run") {
                // Any non-command event means agent is processing (response, file_edit, etc.)
                pendingToolUse.delete(sid)
              }
            }
            // Agent is alive — clear all crash state
            if (crashedSessions.has(sid)) {
              log.info(`[watcher-cb] Agent alive — clearing crash state for ${sid.slice(0, 8)}`)
              crashedSessions.delete(sid)
            }
            crashPending.delete(sid)
            crashRestartCount.delete(sid)
            crashPushCooldown.delete(sid)
            // Keep restartGrace active (will expire naturally)

            const list = sessionRecentEvents.get(sid)
            if (list) {
              list.push(...filtered)
              if (list.length > 200) list.splice(0, list.length - 200)
              persistEvents(sid, list)
            }
            // Pre-serialize events once for all clients
            const serializedEvents = filtered.map(event => JSON.stringify({ type: "event", event }))
            let sentCount = 0
            for (const [client, csid] of clientSessions) {
              if (csid === sid && client.readyState === WebSocket.OPEN) {
                sentCount++
                for (const msg of serializedEvents) {
                  client.send(msg)
                }
                const eventSessionId = clientEventSessions.get(client)
                if (eventSessionId) {
                  for (const event of filtered) {
                    eventStore.addEvent(eventSessionId, event)
                  }
                }
              }
            }
            log.info(`[watcher-cb] sent to ${sentCount} clients (total clientSessions=${clientSessions.size})`)
            if (filtered.length > 0) {
              const lastEvent = filtered[filtered.length - 1]
              // Scan entire batch for last meaningful title (not just final event)
              for (let i = filtered.length - 1; i >= 0; i--) {
                if (filtered[i].title && isMeaningfulTitle(filtered[i].title)) {
                  sessionLastTitle.set(sid, filtered[i].title)
                  // Update session map title for recovery
                  const existing = sessionClaudeMap.get(sid)
                  if (existing) { existing.lastTitle = filtered[i].title; saveSessionMap() }
                  break
                }
              }
              const activityMsg = JSON.stringify(buildSessionActivityPayload(sid, lastEvent))
              // Only broadcast activity to clients that are connected (scoped)
              for (const [client, csid] of clientSessions) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(activityMsg)
                }
              }
            }

            // Track activity for progress interception
            const hasToolEvents = filtered.some(e =>
              e.type === "file_edit" || e.type === "file_create" || e.type === "command_run"
            )
            progressInterceptor.onData(sid, hasToolEvents)
          }

          // Each session gets its own watcher. claimedJsonlFiles prevents two watchers
          // from watching the same file. No need to kill other sessions' watchers.

          log.info(`[attach] watcherExists=${sessionJsonlWatchers.has(session.id)} session.id=${session.id} agentId=${agentId}`)
          if (!sessionJsonlWatchers.has(session.id)) {
            const sid = session.id
            const baseCb = makeWatcherCallback(sid)
            // Wrap callback to capture Claude session ID from JSONL watcher path
            const cb = (events: AgentEvent[]) => {
              baseCb(events)
              // Try to extract Claude session ID from watcher's JSONL path
              if (agentId === "claude" && watcher && (watcher as any).jsonlPath) {
                const jsonlFile = ((watcher as any).jsonlPath as string).split(/[/\\]/).pop()?.replace(/\.jsonl$/, "")
                if (jsonlFile && !sessionClaudeMap.has(sid)) {
                  updateSessionMapping(sid, jsonlFile, projectId, sessionLastTitle.get(sid))
                  log.info(`[session-map] Mapped ${sid} → Claude session ${jsonlFile}`)
                }
              }
            }
            let watcher: { stop(): void; rescan?(): void; buildResumeOptions?(): AgentEvent | null; [key: string]: any } | null = null

            // Use sessionProject.cwd (may be worktree path) — this is where Claude Code runs
            const claudeSessionId = msg.claudeSessionId as string | undefined
            if (agentId === "claude") {
              // Skip JSONL replay for recoverable/resumed sessions — persisted events
              // will be replayed separately (avoids sending events twice + faster attach).
              const skipReplay = !!requestedSessionId
              watcher = new JsonlWatcher(sessionProject.cwd, cb, claudeSessionId, skipReplay)
              log.info(`[attach] JsonlWatcher created for cwd=${sessionProject.cwd} claudeSessionId=${claudeSessionId || "none"} skipReplay=${skipReplay}`)
            } else if (agentId === "codex") {
              watcher = new CodexWatcher(sessionProject.cwd, cb)
            } else if (agentId === "gemini") {
              watcher = new GeminiWatcher(sessionProject.cwd, cb)
            }

            if (watcher) {
              (watcher as any).start()
              // Only rescan for genuinely resumed sessions (PTY already existed),
              // NOT for new sessions that happen to have a requestedSessionId.
              if (alreadyExisted && !claudeSessionId && (watcher as any).rescan) {
                log.info(`[attach] Calling rescan() for resumed session (no claudeSessionId)`)
                ;(watcher as any).rescan()
              }
              sessionJsonlWatchers.set(sid, watcher)
              log.info(`[attach] Session watcher started for ${agentId} session ${sid}`)
            } else {
              log.warn(`[attach] No watcher created for agentId=${agentId}`)
            }
          }

          // Create new EventStore session when project changes (or first attach)
          // Without this, switching projects on the same WS reuses the old EventStore
          // session, causing events from project B to be stored under project A.
          const prevEventSessionId = clientEventSessions.get(ws)
          const needNewEventSession = !prevEventSessionId
            || (() => {
              const prev = eventStore.getSession(prevEventSessionId)
              return prev && prev.projectId !== projectId
            })()
          if (needNewEventSession) {
            if (prevEventSessionId) eventStore.endSession(prevEventSessionId)
            const eventSessionId = eventStore.startSession(projectId, agentId)
            clientEventSessions.set(ws, eventSessionId)
          }

          // Send capped scrollback (~80KB) instead of full history
          const scrollback = sessions.getRecentScrollback(session.id)
          if (scrollback) {
            ws.send(JSON.stringify({ type: "scrollback", data: scrollback }))
          }

          // Replay stored events for any session the user is opening (live or recoverable).
          // For live sessions, events are in memory (fast). For recoverable, loaded from disk.
          // The app needs this to populate the events panel when navigating into a session.
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
              // Replay all events including waiting decision_requests.
              // Only filter out stale decisions that have a later tool call (meaning user already responded).
              const lastToolIdx = storedEvents.reduce((max, e, i) =>
                (e.type === "file_edit" || e.type === "file_create" || e.type === "command_run") ? i : max, -1)
              const replayEvents = storedEvents.filter((e, i) => {
                // Keep non-decision events
                if (e.type !== "decision_request" || e.status !== "waiting") return true
                // Keep waiting decisions that are AFTER the last tool call (still pending)
                return i > lastToolIdx
              })
              if (replayEvents.length > 0) {
                ws.send(JSON.stringify({ type: "events_replay", events: replayEvents }))
              }
            } else {
              // Fallback: no persisted events found (daemon restart + debounce didn't flush).
              // Force JSONL watcher to replay history from the actual JSONL file on disk.
              // Without this, the frontend shows empty events ("等待 Agent 活動...").
              const w = sessionJsonlWatchers.get(session.id)
              if (w && typeof (w as any).forceReplay === "function") {
                log.info(`[attach] events_replay: no persisted events — falling back to JSONL forceReplay`)
                ;(w as any).forceReplay()
              } else {
                log.warn(`[attach] events_replay: no persisted events and no watcher for JSONL fallback`)
              }
            }
          }

          ws.send(JSON.stringify({ type: "attached", sessionId: session.id, projectName: project.name, agentId, resumed: alreadyExisted, worktreeBranch }))
          captureCliEvent("cli_session_created", { agentId, projectId, resumed: alreadyExisted })

          // For recoverable sessions (daemon restarted, PTY gone but events persisted):
          // auto-resume only when the client marks this attach as a real session resume.
          // The app flips this on after the first successful attach so reconnects can
          // recover existing sessions without treating brand-new launches as recoverable.
          // Safety: 10s cooldown between resume operations to prevent resource exhaustion.
          // Store launch settings for crash recovery (recoverable sessions too)
          if (agentId !== "terminal") {
            sessionLaunchSettings.set(session.id, { agentId, settings: normalizedSettings, projectId: sessionProject.id })
          }

          const isRecoverable = requestedSessionId && !alreadyExisted && agentId !== "terminal" && msg.isAgentResume
          if (isRecoverable) {
            const now = Date.now()
            const RESUME_COOLDOWN_MS = 5_000
            if (now - lastResumeTime < RESUME_COOLDOWN_MS) {
              log.warn(`[attach] Resume cooldown: skipped ${session.id} (${Math.round((RESUME_COOLDOWN_MS - (now - lastResumeTime)) / 1000)}s remaining)`)
            } else {
              lastResumeTime = now
              // Suppress crash detection while agent boots after resume
              restartGrace.set(session.id, now)
              crashPending.delete(session.id)
              const claudeId = (msg.claudeSessionId as string) || sessionClaudeMap.get(requestedSessionId)?.claudeSessionId
              const launch = buildAgentLaunch(agentId, normalizedSettings, {
                projectId: sessionProject.id,
                port: PORT,
                continueSession: agentId === "claude",
                resumeSessionId: agentId === "claude" ? claudeId : undefined,
              })
              setTimeout(() => {
                try {
                  sessions.write(session.id, `${launch.command}\r`)
                  log.info(`[attach] Recoverable session auto-resume (${agentId}): ${launch.command}`)
                } catch (err: any) {
                  log.error(`[attach] Auto-resume PTY write failed: ${err.message}`)
                  try { ws.send(JSON.stringify({ type: "session_error", sessionId: session.id, error: "Resume failed" })) } catch {}
                }
              }, 1500)
            }
          }

          // Auto-restart agent when re-attaching to a crashed session.
          // Only attempt once per session — if restartGrace is already set, we already tried.
          if (alreadyExisted && crashedSessions.has(session.id) && agentId !== "terminal" && !restartGrace.has(session.id)) {
            const now = Date.now()
            const RESUME_COOLDOWN_MS = 5_000
            if (now - lastResumeTime >= RESUME_COOLDOWN_MS) {
              lastResumeTime = now
              crashedSessions.delete(session.id)
              crashPending.delete(session.id)
              restartGrace.set(session.id, now)
              crashRestartCount.set(session.id, (crashRestartCount.get(session.id) || 0) + 1)
              const launchInfo = sessionLaunchSettings.get(session.id)
              const restartAgentId = launchInfo?.agentId || agentId
              const settings = launchInfo?.settings || normalizedSettings
              const projectId = launchInfo?.projectId || sessionProject.id

              const launch = buildAgentLaunch(restartAgentId, settings, {
                projectId,
                port: PORT,
                continueSession: restartAgentId === "claude",
                resumeSessionId: restartAgentId === "claude" ? sessionClaudeMap.get(session.id)?.claudeSessionId : undefined,
              })
              if (launch.command) {
                setTimeout(() => {
                  try {
                    sessions.write(session.id, `${launch.command}\r`)
                    log.info(`[CRASH-AUTO-RESUME] Auto-restarting ${restartAgentId} in session ${session.id.slice(0, 8)}: ${launch.command}`)
                  } catch (err: any) {
                    log.error(`[CRASH-AUTO-RESUME] PTY write failed: ${err.message}`)
                  }
                }, 1500)
                const autoLoc = getSessionLocale(session.id, sessionLaunchSettings)
                const restartEvent: AgentEvent = {
                  id: `auto_restart_${Date.now()}`,
                  timestamp: Date.now(),
                  type: "info",
                  status: "in_progress",
                  title: ct("crash.autoResuming", autoLoc, { agent: restartAgentId }),
                }
                ws.send(JSON.stringify({ type: "event", event: restartEvent }))
              }
            } else {
              log.warn(`[CRASH-AUTO-RESUME] Cooldown: skipped ${session.id.slice(0, 8)}`)
            }
          }

          // For new sessions: auto-install agent if not found, then inject rules prompt.
          // Skip injection when resuming (requestedSessionId means user chose to resume an existing session —
          // the agent already has context from the previous conversation).
          if (!alreadyExisted && !requestedSessionId && agentId !== "terminal") {
            // --- Auto-install agent binary if missing ---
            const installInfo = AGENT_INSTALL_INFO[agentId]
            if (installInfo) {
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

            // --- Auto-start agent with settings from frontend ---
            // Bypass confirmation is handled client-side (App dialog) before settings.bypass is sent.
            // If bypass=true arrives here, the user already confirmed via the App confirmation dialog.
            // Store launch settings for crash recovery / restart
            sessionLaunchSettings.set(session.id, { agentId, settings: normalizedSettings, projectId: sessionProject.id })
            const launch = buildAgentLaunch(agentId, normalizedSettings, { projectId: sessionProject.id, port: PORT })
            if (launch.command) {
              setTimeout(() => {
                sessions.write(session.id, `${launch.command}\r`)
                log.info(`[attach] Agent auto-start: ${launch.command}`)
              }, 1500)
            }

            // --- Ensure rules.md exists (+ PRD API section if needed), then inject ---
            ensureRulesFile(sessionProject.cwd)
            ensurePrdApiSection(sessionProject.cwd, PORT, sessionProject.id)
            const rulesPath = getRulesPath(sessionProject.cwd)
            const memoryPath = getMemoryPath(sessionProject.cwd)
            const hasRules = existsSync(rulesPath)
            const hasMemory = existsSync(memoryPath)

            // Standards injection is opt-in — users can run validation manually from the Standards page.
            // Standards prompt file can be generated via POST /api/standards/generate-prompt if needed.

            {
              let attempts = 0
              const pollAgent = setInterval(() => {
                attempts++
                const sb = sessions.getScrollback(session.id) || ""
                const agentReady =
                  /[\u276f]\s*$/.test(sb) ||           // ❯ prompt (Claude Code)
                  /Claude Code/i.test(sb) ||            // Claude Code banner
                  /Tips:/i.test(sb) ||                  // Claude Code tips
                  /OpenAI\s+Codex/i.test(sb) ||         // Codex banner
                  /aider\s+v\d/i.test(sb) ||            // Aider banner
                  /Gemini\s+CLI/i.test(sb) ||           // Gemini CLI banner
                  /Cursor\s+Agent|agent>/i.test(sb)     // Cursor Agent

                if (!agentReady && attempts < 150) return  // poll every 200ms, max 30s
                clearInterval(pollAgent)

                if (!agentReady) {
                  log.warn(`Agent prompt not detected after 30s for session ${session.id}, skipping rules injection`)
                  return
                }

                // Build short instruction pointing agent to rules + memory files
                const parts: string[] = []
                if (hasRules) parts.push("讀取 .agentrune/rules.md（行為規範）")
                if (hasMemory) {
                  parts.push("讀取 .agentrune/agentlore.md（專案記憶）")
                } else {
                  parts.push("建立 .agentrune/agentlore.md（專案記憶），先 mkdir -p .agentrune，再掃描專案產生初始內容")
                }
                const instruction = `請先${parts.join("，然後")}，完成後再開始工作。`

                // Notify APP: initialization started (lock input)
                const initEvent: AgentEvent = {
                  id: `init_${Date.now()}`,
                  timestamp: Date.now(),
                  type: "info",
                  status: "in_progress",
                  title: "初始化中…",
                  detail: hasRules || hasMemory
                    ? `正在載入 ${[hasRules && "rules.md", hasMemory && "agentlore.md"].filter(Boolean).join(", ")}`
                    : "正在建立 agentlore.md…",
                }
                for (const [client, csid] of clientSessions) {
                  if (csid === session.id && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: "event", event: initEvent }))
                    client.send(JSON.stringify({ type: "init_status", phase: "injecting" }))
                  }
                }
                const list = sessionRecentEvents.get(session.id)
                if (list) list.push(initEvent)

                // Write text first, then send Enter separately (Claude Code TUI needs \r)
                sessions.write(session.id, instruction)
                setTimeout(() => {
                  sessions.write(session.id, "\r")
                }, 150)
                log.info(`Rules instruction injected for session ${session.id} (rules: ${hasRules}, memory: ${hasMemory})`)

                // Poll for agent to finish processing injection (prompt reappears)
                let doneAttempts = 0
                const pollDone = setInterval(() => {
                  doneAttempts++
                  const sb2 = sessions.getScrollback(session.id) || ""
                  // Check if agent returned to prompt after injection
                  const lines = sb2.split("\n").filter(l => l.trim())
                  const lastLine = lines[lines.length - 1] || ""
                  const backToPrompt = /[\u276f\u203a>$%#]\s*$/.test(lastLine)
                  if (!backToPrompt && doneAttempts < 300) return // poll every 500ms, max 2.5min
                  clearInterval(pollDone)

                  // Send init_done event
                  const doneEvent: AgentEvent = {
                    id: `init_done_${Date.now()}`,
                    timestamp: Date.now(),
                    type: "info",
                    status: "completed",
                    title: "初始化完成",
                  }
                  for (const [client, csid] of clientSessions) {
                    if (csid === session.id && client.readyState === WebSocket.OPEN) {
                      client.send(JSON.stringify({ type: "event", event: doneEvent }))
                      client.send(JSON.stringify({ type: "init_status", phase: "done" }))
                    }
                  }
                  const list2 = sessionRecentEvents.get(session.id)
                  if (list2) {
                    // Update the in_progress init event to completed
                    const idx = list2.findIndex(e => e.id === initEvent.id)
                    if (idx !== -1) list2[idx] = { ...list2[idx], status: "completed", title: "初始化完成" }
                    list2.push(doneEvent)
                  }
                  log.info(`Init done for session ${session.id} (after ${doneAttempts * 500}ms)`)
                }, 500)
              }, 200)
            }
          }
          break
        }

        case "input": {
          const sessionId = clientSessions.get(ws)
          if (sessionId) {
            let inputStr = msg.data as string
            const inlineImages = msg.images as string[] | undefined

            // ─── Agent crash: handle special actions ───
            if (inputStr.startsWith("__restart_agent__")) {
              const crashInfo = crashedSessions.get(sessionId)
              if (crashInfo) {
                crashedSessions.delete(sessionId)
                crashPending.delete(sessionId)
                restartGrace.set(sessionId, Date.now())
                crashRestartCount.set(sessionId, (crashRestartCount.get(sessionId) || 0) + 1)
                // Parse agentId from suffix: __restart_agent__claude → "claude"
                const rawRestartAgent = inputStr.replace("__restart_agent__", "").trim()
                const restartAgentId = isLaunchAgentId(rawRestartAgent) ? rawRestartAgent : null
                const launchInfo = sessionLaunchSettings.get(sessionId)
                // Use explicitly selected agent, fall back to saved launch settings, then default to "claude"
                const agentId = restartAgentId || launchInfo?.agentId || "claude"
                const settings = launchInfo?.settings || normalizeAgentSettings()
                const projectId = launchInfo?.projectId || sessions.get(sessionId)?.project.id

                const launch = buildAgentLaunch(agentId, settings, {
                  projectId,
                  port: PORT,
                  continueSession: agentId === "claude",
                  resumeSessionId: agentId === "claude" ? sessionClaudeMap.get(sessionId)?.claudeSessionId : undefined,
                })
                if (launch.command) {
                  sessions.write(sessionId, `${launch.command}\r`)
                  log.info(`[CRASH-RESTART] Restarting ${agentId} in session ${sessionId.slice(0, 8)}: ${launch.command}`)
                  // Update launch settings to reflect the new agent choice
                  if (projectId) sessionLaunchSettings.set(sessionId, { agentId, settings, projectId })
                  const restartLoc = getSessionLocale(sessionId, sessionLaunchSettings)
                  const restartEvent: AgentEvent = {
                    id: `restart_${Date.now()}`,
                    timestamp: Date.now(),
                    type: "info",
                    status: "in_progress",
                    title: ct("crash.restarting", restartLoc, { agent: agentId }),
                  }
                  ws.send(JSON.stringify({ type: "event", event: restartEvent }))
                } else {
                  log.warn(`[CRASH-RESTART] Unknown agent "${agentId}" for session ${sessionId.slice(0, 8)}`)
                  ws.send(JSON.stringify({ type: "session_error", sessionId, error: `Unknown agent: ${agentId}. Please start a new session.` }))
                }
              }
              break
            }
            if (inputStr.startsWith("__close_session__")) {
              crashedSessions.delete(sessionId)
              sessions.kill(sessionId)
              break
            }
            if (inputStr.startsWith("__dismiss_crash__")) {
              crashedSessions.delete(sessionId)
              break
            }

            // ─── Agent crash: block normal input if agent is dead ───
            if (crashedSessions.has(sessionId)) {
              const crashInfo = crashedSessions.get(sessionId)!
              log.warn(`[CRASH-BLOCK] Blocking input to crashed session ${sessionId.slice(0, 8)} — agent not running`)
              // Only send crash notification once — don't spam on every keystroke
              if (!crashInfo.notified) {
                crashInfo.notified = true
                const loc = getSessionLocale(sessionId, sessionLaunchSettings)
                const blockEvent: AgentEvent = {
                  id: `crash_block_${Date.now()}`,
                  timestamp: Date.now(),
                  type: "decision_request",
                  status: "waiting",
                  title: ct("crash.title", loc),
                  detail: ct("crash.detail", loc),
                  decision: {
                    options: buildCrashRestartOptions(loc),
                  },
                }
                ws.send(JSON.stringify({ type: "event", event: blockEvent }))
              }
              break
            }

            // If images are attached, save to disk and append paths to input text
            if (inlineImages && inlineImages.length > 0) {
              const session = sessions.get(sessionId)
              const cwd = session?.project.cwd || homedir()
              const uploadDir = join(cwd, ".agentrune", "uploads")
              mkdirSync(uploadDir, { recursive: true })
              const savedPaths: string[] = []
              for (const imgData of inlineImages) {
                try {
                  const base64Data = imgData.replace(/^data:image\/\w+;base64,/, "")
                  const ext = imgData.match(/^data:image\/(\w+)/)?.[1] || "png"
                  const filePath = join(uploadDir, `${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`)
                  writeFileSync(filePath, Buffer.from(base64Data, "base64"))
                  savedPaths.push(filePath)
                  log.info(`[input] saved inline image: ${filePath}`)
                } catch (err) {
                  log.error(`[input] failed to save inline image: ${err}`)
                }
              }
              if (savedPaths.length > 0) {
                // Strip trailing \r, append image paths, re-add \r
                const hasTrailingR = inputStr.endsWith("\r")
                const baseText = hasTrailingR ? inputStr.slice(0, -1) : inputStr
                const imagePaths = savedPaths.join(" ")
                const withImages = baseText.trim()
                  ? `${baseText} [Attached images — please read these files:] ${imagePaths}`
                  : `[Attached images — please read these files:] ${imagePaths}`
                inputStr = hasTrailingR ? withImages + "\r" : withImages
              }
            }

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
                log.info(`Injected /${cmdMatch[1]} command ready for session ${sessionId}`)
                break
              }
            }

            // Direct write — client sends text and \r as separate WS messages
            // (500ms delay on client side for Claude Code TUI to process text)
            sessions.write(sessionId, inputStr)
          }
          break
        }

        // Send input to a specific session by ID (for batch operations)
        case "session_input": {
          const targetId = msg.sessionId as string
          const inputStr = msg.data as string
          // Security: verify the requesting client owns this session (prevent cross-session injection)
          const clientOwnedSid = clientSessions.get(ws)
          if (targetId && inputStr && sessions.get(targetId) && (clientOwnedSid === targetId || isLocal)) {
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

        case "skill_confirm": {
          const automationId = msg.automationId as string
          const action = (msg.action as "approve" | "approve_and_trust" | "deny") || "deny"
          if (automationId) {
            const resolved = automationManager.resolveConfirmation(automationId, action)
            log.info(`[WS] skill_confirm: automationId=${automationId} action=${action} resolved=${resolved}`)
            ws.send(JSON.stringify({ type: "confirmation_ack", automationId, resolved }))
          }
          break
        }

        case "bypass_confirm": {
          // Automation bypass confirmation (interactive session bypass is confirmed client-side)
          const automationId = msg.automationId as string
          if (automationId) {
            const action = (msg.action as "approve" | "approve_and_trust" | "deny") || "deny"
            const resolved = automationManager.resolveConfirmation(automationId, action)
            log.info(`[WS] bypass_confirm: automationId=${automationId} action=${action} resolved=${resolved}`)
            ws.send(JSON.stringify({ type: "confirmation_ack", automationId, resolved }))
          }
          break
        }

        case "reauth_resolve": {
          const automationId = msg.automationId as string
          const action = (msg.action as "approve" | "deny") || "deny"
          const noExpiry = msg.noExpiry === true
          if (automationId) {
            automationManager.resolveReauth(automationId, action, { noExpiry }).then(result => {
              ws.send(JSON.stringify({ type: "reauth_ack", automationId, ...result }))
            }).catch(() => {
              ws.send(JSON.stringify({ type: "reauth_ack", automationId, success: false, message: "Reauth resolution failed" }))
            })
            log.info(`[WS] reauth_resolve: automationId=${automationId} action=${action} noExpiry=${noExpiry}`)
          }
          break
        }

        case "phase_gate_response": {
          const automationId = msg.automationId as string
          const action = msg.action as string
          const validActions = ["proceed", "proceed_with_instructions", "retry", "retry_with_instructions", "abort"]
          if (automationId && action && validActions.includes(action)) {
            const resolved = automationManager.resolvePhaseGate(automationId, {
              automationId,
              action: action as any,
              instructions: (msg.instructions as string) || undefined,
            })
            log.info(`[WS] phase_gate_response: automationId=${automationId} action=${action} resolved=${resolved}`)
            ws.send(JSON.stringify({ type: "phase_gate_ack", automationId, resolved }))
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
          // Security: validate session ID format (alphanumeric + underscore + hyphen only)
          if (!/^[a-zA-Z0-9_-]+$/.test(targetSid)) {
            ws.send(JSON.stringify({ type: "error", message: "Invalid session ID format" }))
            break
          }
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
            const nodeArgs = [binPath, "watch", "--session", targetSid, "--port", String(PORT)]
            const { spawn: spawnChild } = childProcess
            let child
            if (process.platform === "win32") {
              try {
                child = spawnChild("wt", ["--title", "AgentRune Watch", "cmd", "/c", "node", ...nodeArgs], { detached: true, stdio: "ignore" })
              } catch {
                child = spawnChild("cmd", ["/c", "start", "AgentRune Watch", "cmd", "/c", "node", ...nodeArgs], { detached: true, stdio: "ignore" })
              }
            } else {
              // macOS/Linux
              child = spawnChild("node", nodeArgs, { detached: true, stdio: "ignore" })
            }
            child.unref()
            child.on("error", () => watchedSessions.delete(targetSid))
            ws.send(JSON.stringify({ type: "watch_started", sessionId: targetSid }))
          } catch (err: any) {
            log.error(`Failed to spawn watch: ${err.message}`)
            watchedSessions.delete(targetSid)
            ws.send(JSON.stringify({ type: "error", message: "Failed to open watch terminal" }))
          }
          break
        }

        case "store_event": {
          // Client-side events (e.g. user messages) persisted to server for replay
          const storeSid = msg.sessionId as string
          const storeEvt = msg.event as AgentEvent | undefined
          const clientOwnedSession = clientSessions.get(ws)
          if (!storeSid || !storeEvt || (!isLocal && clientOwnedSession !== storeSid)) break
          // Validate event structure
          if (typeof storeEvt.id !== "string" || typeof storeEvt.type !== "string") break
          // Only allow client-originating event types (prevent spoofing server-generated events)
          const ALLOWED_CLIENT_EVENTS = new Set(["user_message", "user_decision", "note", "image_preview"])
          if (!ALLOWED_CLIENT_EVENTS.has(storeEvt.type)) break
          // Cap field sizes to prevent memory/disk abuse
          if (storeEvt.title && typeof storeEvt.title === "string" && storeEvt.title.length > 500) storeEvt.title = storeEvt.title.slice(0, 500)
          if (storeEvt.detail && typeof storeEvt.detail === "string" && storeEvt.detail.length > 5000) storeEvt.detail = storeEvt.detail.slice(0, 5000)
          const list = sessionRecentEvents.get(storeSid)
          if (list) {
            list.push(storeEvt)
            if (list.length > 200) list.splice(0, list.length - 200)
            persistEvents(storeSid, list)
          } else {
            const newList = [storeEvt]
            sessionRecentEvents.set(storeSid, newList)
            persistEvents(storeSid, newList)
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
                      before = execFileSync("git", ["show", `HEAD:${arg}`], { cwd: resumeProject.cwd, encoding: "utf-8", timeout: 3000 })
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
          const rawName = (msg.name as string) || `snap-${Date.now()}`
          const name = rawName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64)
          const s = sessions.get(sid)
          if (!s) { ws.send(JSON.stringify({ type: "snapshot_result", success: false, message: "Session not found" })); break }
          try {

            const tag = `agentrune/snapshot/${sid.slice(0, 12)}/${name}`
            execFileSync("git", ["tag", "-f", tag], { cwd: s.project.cwd, stdio: "pipe", timeout: 5000 })
            ws.send(JSON.stringify({ type: "snapshot_result", success: true, tag, message: `Snapshot "${name}" created` }))
          } catch (err) {
            log.error(`[snapshot/create] ${err instanceof Error ? err.message : err}`)
            ws.send(JSON.stringify({ type: "snapshot_result", success: false, message: "Snapshot creation failed" }))
          }
          break
        }

        case "snapshot_list": {
          const sid = msg.sessionId as string
          const s = sessions.get(sid)
          if (!s) { ws.send(JSON.stringify({ type: "snapshot_list_result", snapshots: [] })); break }
          try {

            const prefix = `agentrune/snapshot/${sid.slice(0, 12)}/`
            const raw = execFileSync("git", ["tag", "-l", `${prefix}*`, "--sort=-creatordate"], { cwd: s.project.cwd, encoding: "utf-8", timeout: 5000 })
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
          if (!/^agentrune\/snapshot\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(tag)) { ws.send(JSON.stringify({ type: "snapshot_result", success: false, message: "Invalid snapshot tag" })); break }
          try {
            execFileSync("git", ["checkout", tag, "--", "."], { cwd: s.project.cwd, stdio: "pipe", timeout: 10000 })
            ws.send(JSON.stringify({ type: "snapshot_result", success: true, message: `Restored to "${tag}"` }))
          } catch (err) {
            log.error(`[snapshot/restore] ${err instanceof Error ? err.message : err}`)
            ws.send(JSON.stringify({ type: "snapshot_result", success: false, message: "Snapshot restore failed" }))
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
              const testOut = execFileSync("npm", ["test", "--", "--passWithNoTests"], { cwd: project.cwd, encoding: "utf-8", timeout: 30000, stdio: "pipe" })
              const passMatch = testOut.match(/(\d+) passed/)
              const failMatch = testOut.match(/(\d+) failed/)
              health.tests = { passed: passMatch ? parseInt(passMatch[1]) : 0, failed: failMatch ? parseInt(failMatch[1]) : 0, raw: testOut.slice(-500) }
            } catch { health.tests = null }

            // Security audit
            try {
              const auditOut = execFileSync("npm", ["audit", "--json"], { cwd: project.cwd, encoding: "utf-8", timeout: 30000, stdio: "pipe" })
              const audit = JSON.parse(auditOut || "{}")
              health.security = { vulnerabilities: audit.metadata?.vulnerabilities?.total || 0, details: audit.metadata?.vulnerabilities }
            } catch { health.security = null }

            // Outdated packages
            try {
              const outdatedOut = execFileSync("npm", ["outdated", "--json"], { cwd: project.cwd, encoding: "utf-8", timeout: 30000, stdio: "pipe" })
              const outdated = JSON.parse(outdatedOut || "{}")
              health.outdated = { count: Object.keys(outdated).length, packages: Object.entries(outdated).slice(0, 10).map(([name, info]: [string, any]) => ({ name, current: info.current, wanted: info.wanted, latest: info.latest })) }
            } catch { health.outdated = null }

            ws.send(JSON.stringify({ type: "health_result", health }))
          } catch (err) {
            log.error(`[health/scan] ${err instanceof Error ? err.message : err}`)
            ws.send(JSON.stringify({ type: "health_result", error: "Health scan failed" }))
          }
          break
        }

        // ─── Agent Swarm (inter-session messaging) ────────────
        case "swarm_ask": {
          const fromSid = msg.fromSessionId as string
          const toSid = msg.toSessionId as string
          const question = msg.question as string
          if (!fromSid || !toSid || !question) break
          // Security: verify the requesting client owns the fromSession (prevent cross-session injection)
          const swarmOwnerSid = clientSessions.get(ws)
          if (!isLocal && swarmOwnerSid !== fromSid) {
            ws.send(JSON.stringify({ type: "swarm_sent", error: "Not authorized: you don't own the source session" }))
            break
          }
          // Verify both sessions belong to the same project
          const fromSession = sessions.get(fromSid)
          const toSession = sessions.get(toSid)
          if (!fromSession || !toSession) {
            ws.send(JSON.stringify({ type: "swarm_sent", error: "Target session not found" }))
            break
          }
          if (fromSession.project.id !== toSession.project.id) {
            ws.send(JSON.stringify({ type: "swarm_sent", error: "Cross-project swarm not allowed" }))
            break
          }
          // Sanitize question: strip control characters
          const sanitizedQ = question.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 2000)
          sessions.write(toSid, `\n[來自其他 Session ${fromSid.slice(0, 8)} 的提問] ${sanitizedQ}\n請回答後 report_progress，在 summary 開頭加上 [回覆 ${fromSid.slice(0, 8)}]\n`)
          ws.send(JSON.stringify({ type: "swarm_sent", toSessionId: toSid, message: `Question sent to ${toSid.slice(0, 8)}` }))
          break
        }

        // ─── API Key Management ──────────────────────────────
        case "save_api_key": {
          const envVar = msg.envVar as string
          const value = msg.value as string
          if (!envVar || !value) { ws.send(JSON.stringify({ type: "api_key_result", success: false, message: "Missing envVar or value" })); break }
          if (!ALLOWED_ENV_KEYS.has(envVar)) { ws.send(JSON.stringify({ type: "api_key_result", success: false, message: `Key "${envVar}" is not allowed` })); break }
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
            log.error(`[vault/save-key] ${err instanceof Error ? err.message : err}`)
            ws.send(JSON.stringify({ type: "api_key_result", success: false, message: "Failed to save key" }))
          }
          break
        }

        case "delete_api_key": {
          const envVar = msg.envVar as string
          if (!envVar) break
          if (!ALLOWED_ENV_KEYS.has(envVar)) { ws.send(JSON.stringify({ type: "api_key_result", success: false, message: `Key "${envVar}" is not allowed` })); break }
          try {
            deleteVaultKey(envVar)
            ws.send(JSON.stringify({ type: "api_key_result", success: true, deleted: true }))
          } catch (err) {
            log.error(`[vault/delete-key] ${err instanceof Error ? err.message : err}`)
            ws.send(JSON.stringify({ type: "api_key_result", success: false, message: "Failed to delete key" }))
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

        // Restart current session with new settings (e.g. bypass toggle)
        // Kills old PTY, creates new one with updated command flags
        case "restart_session": {
          const currentSid = clientSessions.get(ws)
          if (!currentSid) break
          const currentSession = sessions.get(currentSid)
          if (!currentSession) break
          const restartProject = currentSession.project
          const restartAgentId = currentSession.agentId
          // Kill old session
          sessions.kill(currentSid)
          // Clean up watchers
          const oldWatcher = sessionJsonlWatchers.get(currentSid)
          if (oldWatcher) { oldWatcher.stop(); sessionJsonlWatchers.delete(currentSid) }
          sessionEngines.delete(currentSid)
          sessionRecentEvents.delete(currentSid)
          // Create new session (command will be regenerated from current APP settings)
          const restartCfg = loadConfig()
          const restartVaultKeys = loadVaultKeys({
            autoSaveKeysPath: (msg.autoSaveKeysPath as string) || undefined,
            vaultPath: restartCfg.vaultPath || undefined,
            keyVaultPath: restartCfg.keyVaultPath || undefined,
          })
          const newSid = `${restartProject.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const newSession = sessions.create(restartProject, restartAgentId, newSid, restartVaultKeys)
          clientSessions.set(ws, newSession.id)
          progressInterceptor.trackSession(newSession.id)
          const newEngine = new ParseEngine(restartAgentId, restartProject.id, restartProject.cwd)
          sessionEngines.set(newSession.id, newEngine)
          sessionRecentEvents.set(newSession.id, [])
          clientEngines.set(ws, newEngine)
          ws.send(JSON.stringify({
            type: "session_restarted",
            sessionId: newSession.id,
            agentId: restartAgentId,
          }))
          log.info(`Session restarted: ${currentSid} → ${newSession.id} (${restartAgentId})`)
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
    // Debug: log when decision_request events are produced
    const decisionEvents = events.filter(e => e.type === "decision_request")
    if (decisionEvents.length > 0) {
      log.info(`[PTY-EVENTS] decision_request found! count=${decisionEvents.length} titles=${decisionEvents.map(e=>e.title).join(",")}`)
    }

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
        if (e.type === "decision_request") {
          const opts = e.decision?.options || []
          const hasArrowKeys = opts.some((o: any) => /\x1b\[/.test(o.input || ""))
          const onlyNumberHotkeys = opts.length > 0 && opts.every((o: any) => isPlainNumberDecisionInput(o.input))
          // Keep yes/no/a prompts from Codex/Cursor, but still block plain numeric menus that
          // come from output heuristics instead of real approval UIs.
          if (!hasArrowKeys && onlyNumberHotkeys) return false
          // Dedup: don't re-emit if same title exists within last 5 seconds
          const recent = sessionRecentEvents.get(sessionId) || []
          const hasSame = recent.some(r =>
            r.type === "decision_request" && r.title === e.title
            && (e.timestamp - r.timestamp) < 5000
          )
          return !hasSame
        }
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
      let authUrlMatch = stripped.match(/https?:\/\/[^\s)>"']+(?:login|auth|oauth|callback|device|activate|verify|consent|accounts|signin)[^\s)>"']*/i)
        // Also catch generic "open this URL" / "visit this URL" patterns
        || (/(open|visit|go to|navigate|copy|paste)\s+(this\s+)?(url|link)/i.test(stripped) && stripped.match(/https?:\/\/[^\s)>"']+/))
      // Filter out daemon's own auth endpoints (localhost/LAN /api/auth/*)
      if (authUrlMatch && /\/api\/auth\/(check|pair|device|cloud|new-code|totp)/i.test(authUrlMatch[0])) {
        authUrlMatch = null
      }
      // Also detect API key prompts (e.g. "Enter your API key", "ANTHROPIC_API_KEY not set")
      // Skip when JSONL watcher is active — agent already authenticated, any mention
      // of "API key" in output is the agent's response text, not a real CLI prompt.
      const jsonlActive = sessionJsonlWatchers.has(sessionId)
      const isApiKeyPrompt = !authUrlMatch && !jsonlActive && /(?:api.?key|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|CURSOR_API_KEY|OPENROUTER_API_KEY).*(?:not set|not found|missing|required|enter|provide|set the)/i.test(stripped)

      // For auth URLs, also skip if JSONL watcher is active UNLESS the URL looks like
      // a genuine third-party login (not the agent's own auth)
      if (authUrlMatch && jsonlActive) {
        authUrlMatch = null  // agent already running = not a startup auth prompt
      }

      if (authUrlMatch || isApiKeyPrompt) {
        const authUrl = authUrlMatch ? authUrlMatch[0].replace(/[.,;:!?]+$/, "") : ""
        const authEventId = `auth_${sessionId}_${Date.now()}`
        // Dedup: URL-based — same URL only emits once per session (cleared on tool call interaction)
        const dedupKey = authUrl || "api_key_prompt"
        const lastKey = authDedup.get(sessionId)
        if (dedupKey !== lastKey) {
          authDedup.set(sessionId, dedupKey)
          const options: { label: string; input: string; style: "primary" | "danger" | "default" }[] = []
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
          // Remove any parse-engine TUI menu events from this batch — auth URL
          // detection takes priority so login prompts aren't shown as generic menus
          events = events.filter(e => e.type !== "decision_request" || /^(Login|API Key) required$/.test(e.title || ""))
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

    // ─── PRD auto-detection ───
    // When agent outputs <prd_output>...</prd_output>, parse and save as PrdItem
    for (const evt of events) {
      const text = evt.detail || evt.title || ""
      const prdMatch = text.match(/<prd_output>([\s\S]*?)<\/prd_output>/)
      if (prdMatch) {
        try {
          const parsed = JSON.parse(prdMatch[1].trim())
          const sess = sessions.get(sessionId)
          if (sess) {
            const projectId = sess.project.id.replace(/[^a-zA-Z0-9_-]/g, "_")
            const prdDir = join(homedir(), ".agentrune", "prd", projectId)
            try { mkdirSync(prdDir, { recursive: true }) } catch { /* ok */ }
            const prdId = `prd_${Date.now()}`
            const newPrd: PrdItem = {
              id: prdId,
              title: parsed.goal || "New PRD",
              priority: (parsed.priority as PrdPriority) || "p1",
              status: "active",
              goal: parsed.goal || "",
              decisions: parsed.decisions || [],
              approaches: parsed.approaches || [],
              scope: parsed.scope || { included: [], excluded: [] },
              tasks: (parsed.tasks || []).map((t: any, i: number) => ({
                id: t.id || i + 1,
                title: t.title || "",
                description: t.description || "",
                status: "pending" as const,
                priority: t.priority as PrdPriority | undefined,
                dependsOn: t.dependsOn || [],
              })),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }
            writeFileSync(join(prdDir, `${prdId}.json`), JSON.stringify(newPrd, null, 2))
            log.info(`[PRD] Auto-detected and saved: ${prdId} — "${newPrd.title}"`)
            // Notify all clients
            const prdNotif = JSON.stringify({ type: "prd_generated", projectId: sess.project.id, prdId })
            for (const [client] of clientSessions) {
              if (client.readyState === WebSocket.OPEN) client.send(prdNotif)
            }
          }
        } catch { /* invalid JSON, skip */ }
      }
    }

    // ─── Agent crash detection ───
    // Detect when the agent process exited and the PTY fell back to a shell prompt.
    // This prevents user messages from being sent to PowerShell/bash instead of the agent.
    {
      const currentSession = sessions.get(sessionId)
      const sessionAgentId = currentSession?.agentId
      // Skip crash detection during restart grace period (30s after agent restart/resume)
      const graceStart = restartGrace.get(sessionId)
      const inGracePeriod = graceStart && (Date.now() - graceStart) < 30_000
      if (graceStart && !inGracePeriod) restartGrace.delete(sessionId) // cleanup expired
      // Skip crash detection if:
      // 1. JSONL had activity in the last 10s (agent is actively processing)
      // 2. A command_run is in progress (agent ran a tool, shell prompts are expected)
      const lastActivity = lastJsonlActivity.get(sessionId)
      const jsonlJustActive = lastActivity && (Date.now() - lastActivity) < 10_000
      const toolStart = pendingToolUse.get(sessionId)
      const toolInProgress = toolStart && (Date.now() - toolStart) < 600_000 // expire after 10min
      if (toolStart && !toolInProgress) pendingToolUse.delete(sessionId)
      if (sessionAgentId && sessionAgentId !== "terminal" && !crashedSessions.has(sessionId) && !inGracePeriod && !jsonlJustActive && !toolInProgress) {
        const stripped = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
        // Check for shell prompt patterns — only match the last non-empty line to avoid false positives
        const lastLine = stripped.split("\n").filter(Boolean).pop()?.trim() || ""
        const isShellPrompt = /^PS\s+[A-Z]:\\[^>]*>\s*$/.test(lastLine)                          // PowerShell
          || /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+[:\s].*\$\s*$/.test(lastLine)                     // bash user@host:~$
          || /^bash-\d+.*[$#]\s*$/.test(lastLine)                                                 // bash version prompt
        // Only trigger if session has been alive >10s (avoid false positive during startup)
        // AND agent was actively running (JSONL watcher created, or scrollback shows agent banner)
        const sessionAge = Date.now() - (currentSession?.createdAt || Date.now())
        const agentWasRunning = sessionJsonlWatchers.has(sessionId) || sessionAge > 15000
        // Also check for error patterns that indicate the user's message went to the shell
        const hasShellError = /CommandNotFoundException|command not found|not recognized as|is not recognized/i.test(stripped)

        if (agentWasRunning && (hasShellError || isShellPrompt)) {
          // Debounce: require shell prompt to appear in 2 consecutive checks (3s window)
          // But if we see a shell error (CommandNotFoundException), trigger immediately
          const pendingTime = crashPending.get(sessionId)
          if (hasShellError || (pendingTime && Date.now() - pendingTime < 3000)) {
            const restartAttempts = crashRestartCount.get(sessionId) || 0
            // If we already restarted and agent exited again, mark silently (no notification loop)
            const alreadyRestarted = restartAttempts > 0
            crashedSessions.set(sessionId, { detectedAt: Date.now(), agentId: sessionAgentId, notified: alreadyRestarted })
            crashPending.delete(sessionId)
            log.warn(`[CRASH-DETECT] Agent "${sessionAgentId}" exited in session ${sessionId.slice(0, 8)}${alreadyRestarted ? " (post-restart, silent)" : ""}`)
            if (alreadyRestarted) {
              // Don't spam notifications — agent exits after resume are expected
              // (e.g., Claude resumed a completed conversation and exited normally)
            } else {
            // Push notification for session crash
            const crashDetectedAt = Date.now()
            const alCfg2 = cfg.agentlore
            if (alCfg2 && shouldSendCrashPush(crashPushCooldown.get(sessionId), crashDetectedAt)) {
              const lastTitle = sessionLastTitle.get(sessionId) || sessionAgentId
              crashPushCooldown.set(sessionId, crashDetectedAt)
              sendPushNotification(alCfg2, `${sessionAgentId} crashed`, lastTitle, {
                sessionId,
                type: "session_crashed",
              }).catch(() => {})
            } else if (alCfg2) {
              log.dim(`[CRASH-DETECT] Suppressed duplicate crash push for ${sessionId.slice(0, 8)}`)
            }
            // Emit crash event to clients
            const agentLabel = sessionAgentId.charAt(0).toUpperCase() + sessionAgentId.slice(1)
            const loc = getSessionLocale(sessionId, sessionLaunchSettings)
            const crashEvent: AgentEvent = {
              id: `crash_${sessionId}_${Date.now()}`,
              timestamp: Date.now(),
              type: "decision_request",
              status: "waiting",
              title: ct("crash.exited", loc, { agent: agentLabel }),
              detail: ct("crash.exitedDetail", loc),
              decision: {
                options: buildCrashRestartOptions(loc),
              },
            }
            events.push(crashEvent)
            crashedSessions.get(sessionId)!.notified = true
            } // end else (first crash, not post-restart)
          } else if (!pendingTime) {
            // First detection — start debounce
            crashPending.set(sessionId, Date.now())
          }
        } else {
          // Agent is alive — clear any pending crash detection
          crashPending.delete(sessionId)
        }
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
      // Scan entire batch for last meaningful title (not just final event)
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].title && isMeaningfulTitle(events[i].title)) {
          sessionLastTitle.set(sessionId, events[i].title)
          break
        }
      }
      const activityMsg = JSON.stringify(buildSessionActivityPayload(sessionId, lastEvent))
      for (const [client] of clientSessions) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(activityMsg)
        }
      }
    }
  })

  sessions.on("exit", (sessionId: string) => {
    captureCliEvent("cli_session_ended", { sessionId: sessionId.slice(0, 20) })

    // Push notification for session exit
    const alCfg = cfg.agentlore
    if (alCfg) {
      const title = sessionLastTitle.get(sessionId) || "Session ended"
      sendPushNotification(alCfg, "Session ended", title, {
        sessionId,
        type: "session_ended",
      }).catch(() => {})
    }

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
    authDedup.delete(sessionId)
    crashedSessions.delete(sessionId)
    crashPending.delete(sessionId)
    restartGrace.delete(sessionId)
    crashRestartCount.delete(sessionId)
    crashPushCooldown.delete(sessionId)
    lastJsonlActivity.delete(sessionId)
    pendingToolUse.delete(sessionId)
    sessionLaunchSettings.delete(sessionId)

    // Mark session as closed (persisted to disk) so it won't appear as recoverable.
    // Only sessions active when daemon crashed (not in this list) are recoverable.
    closedSessionIds.add(sessionId)
    persistClosedSessions()

    for (const [client, sid] of clientSessions) {
      if (sid === sessionId && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "exit", sessionId }))
      }
    }
  })

  // --- Start listening ---

  server.listen(PORT, "127.0.0.1", async () => {
    log.success(`AgentRune running at http://localhost:${PORT}`)
    const localIp = getLocalIp()
    if (localIp !== "127.0.0.1") {
      log.info(`LAN: http://${localIp}:${PORT}`)
    }

    // Start Cloudflare Tunnel for remote access
    // Use object so heartbeat closure always reads latest URL
    const tunnelState = { url: undefined as string | undefined }
    // Expose tunnel URL globally for /api/daemon-info endpoint
    const updateGlobalTunnelUrl = (url?: string) => { (globalThis as any).__agentrune_tunnel_url__ = url || null }
    try {
      const { startTunnel } = await import("./tunnel.js")
      const tunnel = await startTunnel(PORT)
      tunnelState.url = tunnel.url
      updateGlobalTunnelUrl(tunnel.url)
      log.info(`Remote access: ${tunnelState.url}`)
      // Auto-update AgentLore when tunnel restarts with new URL
      tunnel.onRestart = (newUrl: string) => {
        tunnelState.url = newUrl
        updateGlobalTunnelUrl(newUrl)
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
      // Retry tunnel in background — never crash the daemon
      const retryTunnel = async (attempt: number): Promise<void> => {
        try {
          if (attempt > 3) { log.warn(`Tunnel retry exhausted after ${attempt} attempts, staying LAN-only (background recovery active)`); return }
          // Check Cloudflare rate limit first
          const { checkCloudflareRateLimit } = await import("./tunnel.js")
          const waitSeconds = await checkCloudflareRateLimit()
          const delay = waitSeconds > 0 ? waitSeconds : 120  // Use Retry-After or default 2min
          log.dim(`Tunnel retry ${attempt} in ${delay}s${waitSeconds > 0 ? " (from Retry-After)" : ""}...`)
          setTimeout(async () => {
            try {
              // Re-check rate limit right before attempt
              const preWait = await checkCloudflareRateLimit()
              if (preWait > 0) {
                log.dim(`Still rate limited, retrying in ${preWait}s...`)
                retryTunnel(attempt).catch((e) => log.warn(`[Tunnel] retry error: ${e.message}`))
                return
              }
              const { startTunnel } = await import("./tunnel.js")
              const tunnel = await startTunnel(PORT)
              tunnelState.url = tunnel.url
              updateGlobalTunnelUrl(tunnel.url)
              log.info(`Tunnel recovered (attempt ${attempt}): ${tunnel.url}`)
              tunnel.onRestart = (newUrl: string) => {
                tunnelState.url = newUrl
                updateGlobalTunnelUrl(newUrl)
                log.info(`Tunnel URL changed: ${newUrl}`)
                const agentloreConfig = config.agentlore
                if (agentloreConfig) {
                  const cloudTokenPath = join(getConfigDir(), "cloud-token")
                  const cloudToken = existsSync(cloudTokenPath) ? readFileSync(cloudTokenPath, "utf-8").trim() : ""
                  if (cloudToken) agentloreHeartbeat(agentloreConfig.token, agentloreConfig.deviceId, PORT, cloudToken, newUrl)
                }
              }
              server.on("close", () => tunnel.stop())
            } catch (retryErr: any) {
              log.dim(`Tunnel retry ${attempt} failed: ${retryErr.message}`)
              retryTunnel(attempt + 1).catch((e) => log.warn(`[Tunnel] retry error: ${e.message}`))
            }
          }, delay * 1000)
        } catch (outerErr: any) {
          // Safety net: if even the retry setup fails, log and give up gracefully
          log.warn(`[Tunnel] retry setup error (staying LAN-only): ${outerErr.message}`)
        }
      }
      retryTunnel(1).catch((e) => log.warn(`[Tunnel] retry error: ${e.message}`))

      // Background recovery: if fast retries all fail, keep trying every 10 min
      // Checks Cloudflare health (429 + 500) before attempting — won't get banned
      const bgRecoveryTimer = setInterval(async () => {
        if (tunnelState.url) { clearInterval(bgRecoveryTimer); return } // already recovered
        try {
          const { checkCloudflareRateLimit, startTunnel: bgStartTunnel } = await import("./tunnel.js")
          const wait = await checkCloudflareRateLimit() // returns >0 for 429 AND 500
          if (wait > 0) { log.dim(`[Tunnel] Background recovery skipped — Cloudflare unavailable (wait ${wait}s)`); return }
          log.info("[Tunnel] Background recovery attempt...")
          const tunnel = await bgStartTunnel(PORT)
          tunnelState.url = tunnel.url
          updateGlobalTunnelUrl(tunnel.url)
          log.info(`[Tunnel] Background recovery succeeded: ${tunnel.url}`)
          tunnel.onRestart = (newUrl: string) => {
            tunnelState.url = newUrl
            updateGlobalTunnelUrl(newUrl)
            log.info(`Tunnel URL changed: ${newUrl}`)
            const agentloreConfig = config.agentlore
            if (agentloreConfig) {
              const cloudTokenPath = join(getConfigDir(), "cloud-token")
              const cloudToken = existsSync(cloudTokenPath) ? readFileSync(cloudTokenPath, "utf-8").trim() : ""
              if (cloudToken) agentloreHeartbeat(agentloreConfig.token, agentloreConfig.deviceId, PORT, cloudToken, newUrl)
            }
          }
          server.on("close", () => tunnel.stop())
          clearInterval(bgRecoveryTimer)
        } catch (bgErr: any) {
          log.dim(`[Tunnel] Background recovery failed: ${bgErr.message?.slice(0, 100)}`)
        }
      }, 10 * 60 * 1000) // every 10 minutes
    }

    // CLI telemetry — init with deviceId and fire cli_started
    const agentloreConfig = config.agentlore
    if (agentloreConfig) {
      initCliTelemetry(agentloreConfig.deviceId)
      captureCliEvent("cli_started", { port: PORT, platform: process.platform })
    }

    // AgentLore heartbeat
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
      sessionTokens.set(cloudToken, "") // Cloud token — not IP-bound (server-side use only)
      await agentloreHeartbeat(agentloreConfig.token, agentloreConfig.deviceId, PORT, cloudToken, tunnelState.url)
      setInterval(() => agentloreHeartbeat(agentloreConfig.token, agentloreConfig.deviceId, PORT, cloudToken, tunnelState.url), 2 * 60 * 1000)
    }
  })

  return { server, automationManager }
}
