// tunnel.ts
// Manages a Cloudflare Quick Tunnel for remote access.
// Quick tunnels require no account: `cloudflared tunnel --url http://localhost:PORT`
// The tunnel URL is parsed from cloudflared output and registered with AgentLore.

import { spawn, execFileSync } from "node:child_process"
import {
  chmodSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { arch, homedir, platform } from "node:os"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { log } from "../shared/logger.js"

const STATE_DIR = join(homedir(), ".agentrune")
const BIN_DIR = join(STATE_DIR, "bin")
const QUICK_TUNNEL_API_URL = "https://api.trycloudflare.com/tunnel"
const TRY_CLOUDFLARE_HOSTNAME = /^[a-z0-9-]+\.trycloudflare\.com$/i
const TUNNEL_URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 40 * 60
const TRANSIENT_API_ERROR_WAIT_SECONDS = 5 * 60
const MAX_RATE_LIMIT_WAIT_SECONDS = 6 * 60 * 60

function tunnelStateFile(port?: number): string {
  const suffix = port ? `-${port}` : ""
  return join(STATE_DIR, `tunnel${suffix}.json`)
}

const TUNNEL_STATE_FILE_LEGACY = join(STATE_DIR, "tunnel.json")
const RATE_LIMIT_STATE_FILE = join(STATE_DIR, "tunnel-rate-limit.json")

interface TunnelState {
  pid: number
  url: string
  startedAt: number
}

interface RateLimitState {
  until: number
  updatedAt: number
  reason: string
}

function unrefStream(stream: NodeJS.ReadableStream | null | undefined): void {
  const maybeUnref = stream as NodeJS.ReadableStream & { unref?: () => void }
  maybeUnref.unref?.()
}

function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
}

function isStatePathUnsafe(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function unlinkIfExists(path: string): void {
  try {
    unlinkSync(path)
  } catch {}
}

function writeStateJson(path: string, payload: unknown): void {
  try {
    if (isStatePathUnsafe(path)) {
      log.warn(`[Tunnel] Refusing to write symlink state file: ${path}`)
      return
    }
    ensureStateDir()
    writeFileSync(path, JSON.stringify(payload))
    try { chmodSync(path, 0o600) } catch {}
  } catch {}
}

function readStateText(path: string): string | null {
  if (!existsSync(path)) return null
  if (isStatePathUnsafe(path)) {
    log.warn(`[Tunnel] Ignoring symlink state file: ${path}`)
    unlinkIfExists(path)
    return null
  }
  try {
    return readFileSync(path, "utf-8")
  } catch {
    return null
  }
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return null
}

function clampWaitSeconds(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.ceil(value), MAX_RATE_LIMIT_WAIT_SECONDS)
}

function isQuickTunnelUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return url.protocol === "https:"
      && TRY_CLOUDFLARE_HOSTNAME.test(url.hostname)
      && (!url.pathname || url.pathname === "/")
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}

function saveTunnelState(pid: number, url: string, port?: number): void {
  const normalizedPid = parsePositiveInt(pid)
  if (!normalizedPid || !isQuickTunnelUrl(url)) return
  writeStateJson(tunnelStateFile(port), {
    pid: normalizedPid,
    url,
    startedAt: Date.now(),
  } satisfies TunnelState)
}

function readTunnelState(path: string): TunnelState | null {
  const raw = readStateText(path)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TunnelState>
    const pid = parsePositiveInt(parsed.pid)
    if (!pid || !isQuickTunnelUrl(parsed.url)) return null
    return {
      pid,
      url: parsed.url,
      startedAt: parsePositiveInt(parsed.startedAt) ?? Date.now(),
    }
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  const normalizedPid = parsePositiveInt(pid)
  if (!normalizedPid) return false
  try {
    if (platform() === "win32") {
      const out = execFileSync("tasklist", ["/FI", `PID eq ${normalizedPid}`, "/NH"], {
        encoding: "utf-8",
        timeout: 5000,
        windowsHide: true,
      })
      return out.includes(String(normalizedPid))
    }
    process.kill(normalizedPid, 0)
    return true
  } catch {
    return false
  }
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    return clampWaitSeconds(Number.parseInt(trimmed, 10), DEFAULT_RATE_LIMIT_WAIT_SECONDS)
  }
  const retryAt = Date.parse(trimmed)
  if (Number.isNaN(retryAt)) return null
  return clampWaitSeconds((retryAt - Date.now()) / 1000, DEFAULT_RATE_LIMIT_WAIT_SECONDS)
}

let rateLimitedUntil = 0

function applyRateLimit(waitSeconds: number, reason: string): number {
  const wait = clampWaitSeconds(waitSeconds, DEFAULT_RATE_LIMIT_WAIT_SECONDS)
  rateLimitedUntil = Date.now() + wait * 1000
  writeStateJson(RATE_LIMIT_STATE_FILE, {
    until: rateLimitedUntil,
    updatedAt: Date.now(),
    reason,
  } satisfies RateLimitState)
  return wait
}

function clearRateLimitState(): void {
  rateLimitedUntil = 0
  unlinkIfExists(RATE_LIMIT_STATE_FILE)
}

function loadRateLimitState(): void {
  if (rateLimitedUntil > Date.now()) return
  const raw = readStateText(RATE_LIMIT_STATE_FILE)
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as Partial<RateLimitState>
    const until = parsePositiveInt(parsed.until)
    if (until && until > Date.now()) {
      rateLimitedUntil = until
      return
    }
  } catch {}
  clearRateLimitState()
}

function getRateLimitRemainingSeconds(): number {
  loadRateLimitState()
  const remainingMs = rateLimitedUntil - Date.now()
  if (remainingMs <= 0) {
    if (rateLimitedUntil > 0) clearRateLimitState()
    return 0
  }
  return Math.ceil(remainingMs / 1000)
}

function extractCloudflareBackoff(message: string): { waitSeconds: number; reason: string } | null {
  const retryAfterMatch = message.match(/retry-after[:=\s]+(\d+)/i) || message.match(/wait\s+(\d+)s/i)
  if (retryAfterMatch) {
    return {
      waitSeconds: clampWaitSeconds(Number.parseInt(retryAfterMatch[1], 10), DEFAULT_RATE_LIMIT_WAIT_SECONDS),
      reason: "cloudflared-429",
    }
  }
  if (/error code:\s*1015/i.test(message) || /429 Too Many Requests/i.test(message)) {
    return {
      waitSeconds: DEFAULT_RATE_LIMIT_WAIT_SECONDS,
      reason: "cloudflared-429",
    }
  }
  if (
    /status_code\s*=\s*"?(5\d\d)/i.test(message)
    || /(?:500|502|503)\s+(?:Internal Server Error|Bad Gateway|Service Unavailable)/i.test(message)
  ) {
    return {
      waitSeconds: TRANSIENT_API_ERROR_WAIT_SECONDS,
      reason: "cloudflared-5xx",
    }
  }
  return null
}

async function tryReuseExisting(localPort: number): Promise<{ url: string; pid: number } | null> {
  const stateFile = existsSync(tunnelStateFile(localPort)) ? tunnelStateFile(localPort)
    : existsSync(TUNNEL_STATE_FILE_LEGACY) ? TUNNEL_STATE_FILE_LEGACY
    : null
  if (!stateFile) return null

  const state = readTunnelState(stateFile)
  if (!state) {
    unlinkIfExists(stateFile)
    return null
  }

  if (!isProcessAlive(state.pid)) {
    log.dim(`Previous cloudflared (PID ${state.pid}) is dead - will start new one`)
    unlinkIfExists(stateFile)
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`${state.url}/api/auth/check`, { signal: controller.signal })
    if (res.status < 500) {
      log.info(`Reusing existing cloudflared (PID ${state.pid}): ${state.url}`)
      return { url: state.url, pid: state.pid }
    }
  } catch {
    log.info(`Reusing existing cloudflared (PID ${state.pid}): ${state.url} (URL check pending - local daemon just started)`)
    return { url: state.url, pid: state.pid }
  } finally {
    clearTimeout(timeout)
  }

  return null
}

export async function checkCloudflareRateLimit(): Promise<number> {
  const cachedWait = getRateLimitRemainingSeconds()
  if (cachedWait > 0) return cachedWait

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(QUICK_TUNNEL_API_URL, {
      method: "GET",
      signal: controller.signal,
    })
    if (res.status === 429) {
      const wait = applyRateLimit(
        parseRetryAfterSeconds(res.headers.get("retry-after")) ?? DEFAULT_RATE_LIMIT_WAIT_SECONDS,
        "api-429",
      )
      log.warn(`Cloudflare rate limited - Retry-After: ${wait}s`)
      return wait
    }
    if (res.status >= 500) {
      const wait = applyRateLimit(TRANSIENT_API_ERROR_WAIT_SECONDS, `api-${res.status}`)
      log.warn(`Cloudflare API error (${res.status}) - waiting ${wait}s before retry`)
      return wait
    }
    clearRateLimitState()
    return 0
  } catch {
    return 0
  } finally {
    clearTimeout(timeout)
  }
}

function getCloudflaredInfo(): { url: string; binName: string } {
  const os = platform()
  const machineArch = arch()
  if (os === "win32") {
    return {
      url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
      binName: "cloudflared.exe",
    }
  }
  if (os === "darwin") {
    const suffix = machineArch === "arm64" ? "darwin-arm64" : "darwin-amd64"
    return {
      url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${suffix}`,
      binName: "cloudflared",
    }
  }
  const suffix = machineArch === "arm64" ? "linux-arm64" : "linux-amd64"
  return {
    url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${suffix}`,
    binName: "cloudflared",
  }
}

function findCloudflared(): string | null {
  const { binName } = getCloudflaredInfo()
  const localPath = join(BIN_DIR, binName)
  if (existsSync(localPath)) return localPath

  try {
    const bin = platform() === "win32" ? "where" : "which"
    const result = execFileSync(bin, ["cloudflared"], {
      encoding: "utf-8",
      windowsHide: true,
    }).trim().split(/\r?\n/)[0]
    if (result && existsSync(result)) return result
  } catch {}

  return null
}

async function downloadCloudflared(): Promise<string> {
  ensureStateDir()
  if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true })

  const { url, binName } = getCloudflaredInfo()
  const dest = join(BIN_DIR, binName)
  if (isStatePathUnsafe(dest)) {
    throw new Error(`Refusing to overwrite symlinked cloudflared binary: ${dest}`)
  }

  log.info("Downloading cloudflared...")
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`)
  const ws = createWriteStream(dest)
  await pipeline(res.body as any, ws)

  if (platform() !== "win32") {
    try { chmodSync(dest, 0o755) } catch {}
  }

  log.info(`cloudflared installed - ${dest}`)
  return dest
}

export interface TunnelHandle {
  url: string
  stop: () => void
  onRestart?: (newUrl: string) => void
}

function launchOnce(binPath: string, localPort: number): Promise<{ url: string; proc: ReturnType<typeof spawn> }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binPath, [
      "tunnel",
      "--url",
      `http://localhost:${localPort}`,
      "--no-autoupdate",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: true,
    })

    let resolved = false
    let stderr = ""
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        proc.kill()
        reject(new Error(`Tunnel startup timeout (30s). stderr: ${stderr.slice(-500)}`))
      }
    }, 30000)

    const tryResolve = (text: string) => {
      if (resolved) return
      const match = text.match(TUNNEL_URL_REGEX) || stderr.match(TUNNEL_URL_REGEX)
      if (!match) return

      resolved = true
      clearTimeout(timeout)
      log.info(`Tunnel ready: ${match[0]}`)
      proc.unref()
      unrefStream(proc.stdout)
      unrefStream(proc.stderr)
      resolve({ url: match[0], proc })
    }

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      tryResolve(text)
    })

    proc.stdout.on("data", (chunk: Buffer) => {
      tryResolve(chunk.toString())
    })

    proc.on("error", (err) => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      reject(new Error(`Failed to start cloudflared: ${err.message}`))
    })

    proc.on("exit", (code) => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      reject(new Error(`cloudflared exited with code ${code}. stderr: ${stderr.slice(-500)}`))
    })
  })
}

function isPortListening(port: number): boolean {
  const normalizedPort = parsePositiveInt(port)
  if (!normalizedPort) return false

  try {
    const output = execFileSync("netstat", ["-ano"], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    })
    return output.split(/\r?\n/).some((line) => {
      const columns = line.trim().split(/\s+/)
      if (columns.length < 4) return false
      const localAddress = columns[1] ?? ""
      return localAddress.endsWith(`:${normalizedPort}`) && columns.some((column) => /LISTEN/i.test(column))
    })
  } catch {
    return false
  }
}

export function cleanupOrphanTunnels(activePort: number): void {
  if (!existsSync(STATE_DIR)) return

  try {
    const files = readdirSync(STATE_DIR).filter((file) => /^tunnel-\d+\.json$/.test(file))
    for (const file of files) {
      const portMatch = file.match(/^tunnel-(\d+)\.json$/)
      if (!portMatch) continue

      const port = Number.parseInt(portMatch[1], 10)
      if (port === activePort) continue

      const fullPath = join(STATE_DIR, file)
      const state = readTunnelState(fullPath)
      if (!state) {
        unlinkIfExists(fullPath)
        continue
      }

      if (isProcessAlive(state.pid) && !isPortListening(port)) {
        log.info(`[Tunnel] Killing orphan cloudflared PID ${state.pid} (port ${port} daemon is down)`)
        try {
          if (platform() === "win32") {
            execFileSync("taskkill", ["/F", "/PID", String(state.pid)], {
              stdio: "ignore",
              windowsHide: true,
            })
          } else {
            process.kill(state.pid, "SIGTERM")
          }
        } catch {}
      }

      unlinkIfExists(fullPath)
    }

    if (existsSync(TUNNEL_STATE_FILE_LEGACY)) {
      const legacyState = readTunnelState(TUNNEL_STATE_FILE_LEGACY)
      if (!legacyState || !isProcessAlive(legacyState.pid)) {
        unlinkIfExists(TUNNEL_STATE_FILE_LEGACY)
      }
    }
  } catch {}
}

export async function startTunnel(localPort: number): Promise<TunnelHandle> {
  cleanupOrphanTunnels(localPort)

  let binPath = findCloudflared()
  if (!binPath) {
    binPath = await downloadCloudflared()
  }

  let stopped = false
  let restarting = false
  let currentProc: ReturnType<typeof spawn> | null = null

  const existing = await tryReuseExisting(localPort)

  let initialUrl: string
  if (existing) {
    initialUrl = existing.url
  } else {
    const preCheckWait = await checkCloudflareRateLimit()
    if (preCheckWait > 0) {
      throw new Error(`Cloudflare unavailable (wait ${preCheckWait}s) - skipping tunnel launch`)
    }

    const result = await launchOnce(binPath, localPort)
    initialUrl = result.url
    currentProc = result.proc
    saveTunnelState(result.proc.pid!, result.url, localPort)
  }

  let healthCheckTimer: NodeJS.Timeout | null = null

  const handle: TunnelHandle = {
    url: initialUrl,
    stop: () => {
      stopped = true
      if (healthCheckTimer) clearInterval(healthCheckTimer)
    },
  }

  const doRestart = async () => {
    try {
      if (stopped || restarting) return
      restarting = true

      if (currentProc) {
        try { currentProc.kill() } catch {}
        currentProc = null
      }

      for (let attempt = 1; attempt <= 3; attempt++) {
        if (stopped) return

        const waitSeconds = await checkCloudflareRateLimit()
        if (waitSeconds > 0) {
          log.dim(`Cloudflare rate limited, waiting ${waitSeconds}s before attempt ${attempt}...`)
          await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
          if (stopped) return
        }

        try {
          const result = await launchOnce(binPath!, localPort)
          handle.url = result.url
          currentProc = result.proc
          saveTunnelState(result.proc.pid!, result.url, localPort)
          watchExit(result.proc)
          log.info(`Tunnel restarted: ${result.url}`)
          if (handle.onRestart) handle.onRestart(result.url)
          restarting = false
          return
        } catch (err: any) {
          log.warn(`Tunnel restart attempt ${attempt}/3 failed: ${err.message}`)
          const backoff = extractCloudflareBackoff(String(err?.message ?? ""))
          if (backoff) {
            const wait = applyRateLimit(backoff.waitSeconds, backoff.reason)
            log.dim(`[Tunnel] Applying Cloudflare cooldown from cloudflared output: ${wait}s`)
          }
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 10000))
        }
      }

      log.error("Tunnel restart failed after 3 attempts - daemon continues in LAN-only mode")
      restarting = false
    } catch (err: any) {
      log.error(`[Tunnel] doRestart unexpected error (daemon continues): ${err.message}`)
      restarting = false
    }
  }

  const watchExit = (proc: ReturnType<typeof spawn>) => {
    proc.on("exit", (code) => {
      if (stopped) return
      log.warn(`Tunnel exited (code ${code}) - restarting in 3s...`)
      setTimeout(() => doRestart().catch((err) => log.error(`[Tunnel] Exit restart failed: ${err.message}`)), 3000)
    })
  }

  if (currentProc) {
    watchExit(currentProc)
  }

  const runHealthCheck = async () => {
    if (stopped || restarting || !handle.url) return

    const waitSeconds = getRateLimitRemainingSeconds()
    if (waitSeconds > 0) {
      log.dim(`Skipping health check - Cloudflare rate limited for ${waitSeconds}s`)
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const res = await fetch(`${handle.url}/api/auth/check`, { signal: controller.signal })
      if (res.ok) return

      if (!currentProc && res.status >= 500) {
        log.dim(`Reused tunnel returned ${res.status} - may need time for daemon to start`)
        return
      }

      log.warn(`Tunnel health check failed: HTTP ${res.status} - restarting tunnel`)
    } catch (err: any) {
      if (!currentProc) {
        log.dim(`Reused tunnel health check failed: ${err.message} - will retry`)
        return
      }
      log.warn(`Tunnel health check failed: ${err.message} - restarting tunnel`)
    } finally {
      clearTimeout(timeout)
    }

    doRestart().catch((err) => log.error(`[Tunnel] Health-check restart failed: ${err.message}`))
  }

  setTimeout(runHealthCheck, 15_000)
  healthCheckTimer = setInterval(runHealthCheck, 60_000)

  return handle
}
