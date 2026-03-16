// tunnel.ts
// Manages a Cloudflare Quick Tunnel for remote access.
// Quick tunnels require no account — just `cloudflared tunnel --url http://localhost:PORT`
// The tunnel URL is parsed from stderr output and registered with AgentLore.

import { spawn, execFileSync, execSync } from "node:child_process"
import { existsSync, mkdirSync, createWriteStream, chmodSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { homedir, platform, arch } from "node:os"
import { pipeline } from "node:stream/promises"
import { log } from "../shared/logger.js"

const BIN_DIR = join(homedir(), ".agentrune", "bin")
/** Per-port tunnel state file — prevents port 3456/3457 from overwriting each other */
function tunnelStateFile(port?: number): string {
  const suffix = port ? `-${port}` : ""
  return join(homedir(), ".agentrune", `tunnel${suffix}.json`)
}
// Legacy: still check old path for backward compat on first reuse
const TUNNEL_STATE_FILE_LEGACY = join(homedir(), ".agentrune", "tunnel.json")

interface TunnelState {
  pid: number
  url: string
  startedAt: number
}

/** Save tunnel state so daemon restarts can reuse the existing cloudflared */
function saveTunnelState(pid: number, url: string, port?: number): void {
  try {
    writeFileSync(tunnelStateFile(port), JSON.stringify({ pid, url, startedAt: Date.now() } satisfies TunnelState))
  } catch {}
}

/** Check if a process is alive by PID */
function isProcessAlive(pid: number): boolean {
  try {
    if (platform() === "win32") {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: "utf-8", timeout: 5000 })
      return out.includes(String(pid))
    }
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Try to reuse an existing cloudflared process from a previous daemon session */
async function tryReuseExisting(localPort: number): Promise<{ url: string; pid: number } | null> {
  // Check port-specific state file first, then legacy
  const stateFile = existsSync(tunnelStateFile(localPort)) ? tunnelStateFile(localPort)
    : existsSync(TUNNEL_STATE_FILE_LEGACY) ? TUNNEL_STATE_FILE_LEGACY
    : null
  if (!stateFile) return null
  try {
    const raw = readFileSync(stateFile, "utf-8")
    const state: TunnelState = JSON.parse(raw)
    if (!state.pid || !state.url) return null

    // Check if cloudflared process is still alive
    if (!isProcessAlive(state.pid)) {
      log.dim(`Previous cloudflared (PID ${state.pid}) is dead — will start new one`)
      try { unlinkSync(stateFile) } catch {}
      return null
    }

    // Process is alive — verify the tunnel URL is actually reachable
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(`${state.url}/api/auth/check`, { signal: controller.signal })
      clearTimeout(timeout)
      // Even 401/403 means cloudflared is routing traffic — that's good
      if (res.status < 500) {
        log.info(`Reusing existing cloudflared (PID ${state.pid}): ${state.url}`)
        return { url: state.url, pid: state.pid }
      }
    } catch {
      // URL not reachable — BUT the process might just need time to reconnect
      // since the local daemon just restarted. Give it a pass if process is alive.
      log.info(`Reusing existing cloudflared (PID ${state.pid}): ${state.url} (URL check pending — local daemon just started)`)
      return { url: state.url, pid: state.pid }
    }

    return null
  } catch {
    try { unlinkSync(stateFile) } catch {}
    return null
  }
}

// Rate limit tracking — shared across restart attempts
let rateLimitedUntil = 0

/**
 * Check Cloudflare Quick Tunnel API for rate limiting.
 * Returns seconds to wait (0 if not rate limited).
 */
export async function checkCloudflareRateLimit(): Promise<number> {
  // If we already know we're rate limited, return remaining time
  const now = Date.now()
  if (rateLimitedUntil > now) {
    return Math.ceil((rateLimitedUntil - now) / 1000)
  }
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch("https://api.trycloudflare.com/tunnel", {
      method: "HEAD",
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after")
      const seconds = retryAfter ? parseInt(retryAfter, 10) : 300
      const wait = isNaN(seconds) ? 300 : seconds
      rateLimitedUntil = Date.now() + wait * 1000
      log.warn(`Cloudflare rate limited — Retry-After: ${wait}s`)
      return wait
    }
    // Not rate limited — clear any stale state
    rateLimitedUntil = 0
    return 0
  } catch {
    // Can't reach API — don't block, let cloudflared try
    return 0
  }
}

function getCloudflaredInfo(): { url: string; binName: string } {
  const os = platform()
  const a = arch()
  if (os === "win32") {
    return {
      url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
      binName: "cloudflared.exe",
    }
  }
  if (os === "darwin") {
    const suffix = a === "arm64" ? "darwin-arm64" : "darwin-amd64"
    return {
      url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${suffix}`,
      binName: "cloudflared",
    }
  }
  // Linux
  const suffix = a === "arm64" ? "linux-arm64" : "linux-amd64"
  return {
    url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${suffix}`,
    binName: "cloudflared",
  }
}

function findCloudflared(): string | null {
  // Check our own bin dir first
  const { binName } = getCloudflaredInfo()
  const localPath = join(BIN_DIR, binName)
  if (existsSync(localPath)) return localPath

  // Check system PATH
  try {
    const bin = platform() === "win32" ? "where" : "which"
    const result = execFileSync(bin, ["cloudflared"], { encoding: "utf-8" }).trim().split("\n")[0]
    if (result && existsSync(result)) return result
  } catch {}

  return null
}

async function downloadCloudflared(): Promise<string> {
  if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true })
  const { url, binName } = getCloudflaredInfo()
  const dest = join(BIN_DIR, binName)

  log.info(`Downloading cloudflared...`)
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`)
  const ws = createWriteStream(dest)
  await pipeline(res.body as any, ws)

  if (platform() !== "win32") {
    try { chmodSync(dest, 0o755) } catch {}
  }

  log.info(`cloudflared installed → ${dest}`)
  return dest
}

export interface TunnelHandle {
  url: string           // e.g. https://xxx-yyy.trycloudflare.com
  stop: () => void
  /** Called when tunnel restarts with a new URL */
  onRestart?: (newUrl: string) => void
}

/** Launch a single cloudflared process and resolve when URL is ready */
function launchOnce(binPath: string, localPort: number): Promise<{ url: string; proc: ReturnType<typeof spawn> }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binPath, [
      "tunnel", "--url", `http://localhost:${localPort}`,
      "--no-autoupdate",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // Detach cloudflared so it survives daemon restarts (new process group).
      // safe-restart.sh uses tree-kill (/T) which kills daemon's process tree,
      // but detached processes are in their own group and survive.
      detached: true,
    })

    let resolved = false
    let stderr = ""
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        proc.kill()
        reject(new Error("Tunnel startup timeout (30s). stderr: " + stderr.slice(-500)))
      }
    }, 30000)

    const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

    const tryResolve = (text: string) => {
      if (resolved) return
      const match = text.match(urlRegex) || stderr.match(urlRegex)
      if (match) {
        resolved = true
        clearTimeout(timeout)
        log.info(`Tunnel ready: ${match[0]}`)
        // Unref so daemon can exit without waiting for detached cloudflared
        proc.unref()
        if (proc.stdout) proc.stdout.unref()
        if (proc.stderr) proc.stderr.unref()
        resolve({ url: match[0], proc })
      }
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
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(new Error(`Failed to start cloudflared: ${err.message}`))
      }
    })

    proc.on("exit", (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(new Error(`cloudflared exited with code ${code}. stderr: ${stderr.slice(-500)}`))
      }
    })
  })
}

/**
 * Kill orphan cloudflared processes from other ports.
 * E.g., if port 3456 daemon is down but its cloudflared (detached) still lives,
 * we clean it up to free Cloudflare connection quota.
 */
export function cleanupOrphanTunnels(activePort: number): void {
  const stateDir = join(homedir(), ".agentrune")
  if (!existsSync(stateDir)) return
  try {
    const files = readdirSync(stateDir).filter(f => /^tunnel-\d+\.json$/.test(f))
    for (const file of files) {
      const portMatch = file.match(/^tunnel-(\d+)\.json$/)
      if (!portMatch) continue
      const port = parseInt(portMatch[1], 10)
      if (port === activePort) continue // don't touch our own tunnel

      const fullPath = join(stateDir, file)
      try {
        const state: TunnelState = JSON.parse(readFileSync(fullPath, "utf-8"))
        if (state.pid && isProcessAlive(state.pid)) {
          // Check if that port's daemon is actually running
          try {
            const netstatOut = execSync(`netstat -ano | findstr ":${port}.*LISTEN"`, { encoding: "utf-8", timeout: 5000 })
            if (netstatOut.trim()) continue // daemon on that port is alive, leave tunnel alone
          } catch {
            // netstat found nothing — daemon is dead, kill the orphan cloudflared
          }
          log.info(`[Tunnel] Killing orphan cloudflared PID ${state.pid} (port ${port} daemon is down)`)
          try {
            execFileSync("taskkill", ["/F", "/PID", String(state.pid)], { stdio: "ignore", windowsHide: true })
          } catch {}
        }
        // Clean up state file either way
        try { unlinkSync(fullPath) } catch {}
      } catch {}
    }
    // Also clean legacy tunnel.json if it exists and has a dead process
    if (existsSync(TUNNEL_STATE_FILE_LEGACY)) {
      try {
        const state: TunnelState = JSON.parse(readFileSync(TUNNEL_STATE_FILE_LEGACY, "utf-8"))
        if (!state.pid || !isProcessAlive(state.pid)) {
          unlinkSync(TUNNEL_STATE_FILE_LEGACY)
        }
      } catch {
        try { unlinkSync(TUNNEL_STATE_FILE_LEGACY) } catch {}
      }
    }
  } catch {}
}

export async function startTunnel(localPort: number): Promise<TunnelHandle> {
  // Clean up orphan cloudflared from dead daemons on other ports
  cleanupOrphanTunnels(localPort)

  let binPath = findCloudflared()
  if (!binPath) {
    binPath = await downloadCloudflared()
  }

  let stopped = false
  let restarting = false
  let currentProc: ReturnType<typeof spawn> | null = null

  // Try to reuse an existing cloudflared process (survives daemon restarts)
  const existing = await tryReuseExisting(localPort)

  let initialUrl: string
  if (existing) {
    // Reuse — no new cloudflared spawned, no Cloudflare rate limit risk
    initialUrl = existing.url
  } else {
    // Launch fresh cloudflared
    const result = await launchOnce(binPath, localPort)
    initialUrl = result.url
    currentProc = result.proc
    saveTunnelState(result.proc.pid!, result.url, localPort)
  }

  const handle: TunnelHandle = {
    url: initialUrl,
    stop: () => {
      stopped = true
      if (healthCheckTimer) clearInterval(healthCheckTimer)
      // Don't kill cloudflared on stop — let it survive for next daemon start.
      // Only clean up if this is a full shutdown (not a restart).
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
        // Check rate limit before each attempt
        const waitSeconds = await checkCloudflareRateLimit()
        if (waitSeconds > 0) {
          log.dim(`Cloudflare rate limited, waiting ${waitSeconds}s before attempt ${attempt}...`)
          await new Promise(r => setTimeout(r, waitSeconds * 1000))
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
          // Parse cloudflared stderr for rate limit hints
          const retryMatch = err.message?.match(/retry.after[:\s]*(\d+)/i)
          if (retryMatch) {
            rateLimitedUntil = Date.now() + parseInt(retryMatch[1], 10) * 1000
          }
          if (attempt < 3) await new Promise(r => setTimeout(r, 10000))
        }
      }
      log.error("Tunnel restart failed after 3 attempts — daemon continues in LAN-only mode")
      restarting = false
    } catch (err: any) {
      // Safety net: never let tunnel restart crash the daemon
      log.error(`[Tunnel] doRestart unexpected error (daemon continues): ${err.message}`)
      restarting = false
    }
  }

  // Auto-restart on exit (unless manually stopped)
  const watchExit = (p: ReturnType<typeof spawn>) => {
    p.on("exit", (code) => {
      if (stopped) return
      log.warn(`Tunnel exited (code ${code}) — restarting in 3s...`)
      setTimeout(() => doRestart().catch((err) => log.error(`[Tunnel] Exit restart failed: ${err.message}`)), 3000)
    })
  }

  // Only watch exit if we spawned a new process (reused ones are unmanaged)
  if (currentProc) {
    watchExit(currentProc)
  }

  // Health check function — verify tunnel URL is reachable
  const runHealthCheck = async () => {
    if (stopped || restarting || !handle.url) return
    // Skip health check if rate limited — don't trigger restart that will also be blocked
    if (rateLimitedUntil > Date.now()) {
      log.dim(`Skipping health check — Cloudflare rate limited for ${Math.ceil((rateLimitedUntil - Date.now()) / 1000)}s`)
      return
    }
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(`${handle.url}/api/auth/check`, { signal: controller.signal })
      clearTimeout(timeout)
      if (res.ok) return // healthy
      // For reused tunnels, a 502/503 right after daemon restart is expected
      // (cloudflared routes to localhost but daemon hasn't started yet)
      // Only restart tunnel if it's consistently failing
      if (!currentProc && res.status >= 500) {
        log.dim(`Reused tunnel returned ${res.status} — may need time for daemon to start`)
        return
      }
      log.warn(`Tunnel health check failed: HTTP ${res.status} — restarting tunnel`)
    } catch (err: any) {
      // For reused tunnels, don't immediately restart on health check failure
      if (!currentProc) {
        log.dim(`Reused tunnel health check failed: ${err.message} — will retry`)
        return
      }
      log.warn(`Tunnel health check failed: ${err.message} — restarting tunnel`)
    }
    doRestart().catch((err) => log.error(`[Tunnel] Health-check restart failed: ${err.message}`))
  }

  // First check after 15s — catch dead-on-arrival tunnel URLs early
  setTimeout(runHealthCheck, 15_000)
  // Then every 60s
  const healthCheckTimer = setInterval(runHealthCheck, 60_000)

  return handle
}
