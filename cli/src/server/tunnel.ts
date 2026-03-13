// tunnel.ts
// Manages a Cloudflare Quick Tunnel for remote access.
// Quick tunnels require no account — just `cloudflared tunnel --url http://localhost:PORT`
// The tunnel URL is parsed from stderr output and registered with AgentLore.

import { spawn, execSync } from "node:child_process"
import { existsSync, mkdirSync, createWriteStream, chmodSync } from "node:fs"
import { join } from "node:path"
import { homedir, platform, arch } from "node:os"
import { pipeline } from "node:stream/promises"
import { log } from "../shared/logger.js"

const BIN_DIR = join(homedir(), ".agentrune", "bin")

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
    const cmd = platform() === "win32" ? "where cloudflared" : "which cloudflared"
    const result = execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0]
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

export async function startTunnel(localPort: number): Promise<TunnelHandle> {
  let binPath = findCloudflared()
  if (!binPath) {
    binPath = await downloadCloudflared()
  }

  const { url, proc } = await launchOnce(binPath, localPort)

  let stopped = false
  let currentProc = proc
  let restarting = false

  const handle: TunnelHandle = {
    url,
    stop: () => {
      stopped = true
      if (healthCheckTimer) clearInterval(healthCheckTimer)
      try { currentProc.kill() } catch {}
    },
  }

  const doRestart = async () => {
    if (stopped || restarting) return
    restarting = true
    try { currentProc.kill() } catch {}
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (stopped) return
      try {
        const result = await launchOnce(binPath!, localPort)
        handle.url = result.url
        currentProc = result.proc
        watchExit(result.proc)
        log.info(`Tunnel restarted: ${result.url}`)
        if (handle.onRestart) handle.onRestart(result.url)
        restarting = false
        return
      } catch (err: any) {
        log.warn(`Tunnel restart attempt ${attempt}/3 failed: ${err.message}`)
        if (attempt < 3) await new Promise(r => setTimeout(r, 10000))
      }
    }
    log.error("Tunnel restart failed after 3 attempts")
    restarting = false
  }

  // Auto-restart on exit (unless manually stopped)
  const watchExit = (p: ReturnType<typeof spawn>) => {
    p.on("exit", (code) => {
      if (stopped) return
      log.warn(`Tunnel exited (code ${code}) — restarting in 3s...`)
      setTimeout(doRestart, 3000)
    })
  }
  watchExit(proc)

  // Health check function — verify tunnel URL is reachable
  const runHealthCheck = async () => {
    if (stopped || restarting || !handle.url) return
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(`${handle.url}/api/auth/check`, { signal: controller.signal })
      clearTimeout(timeout)
      if (res.ok) return // healthy
      log.warn(`Tunnel health check failed: HTTP ${res.status} — restarting tunnel`)
    } catch (err: any) {
      log.warn(`Tunnel health check failed: ${err.message} — restarting tunnel`)
    }
    doRestart()
  }

  // First check after 15s — catch dead-on-arrival tunnel URLs early
  setTimeout(runHealthCheck, 15_000)
  // Then every 60s
  const healthCheckTimer = setInterval(runHealthCheck, 60_000)

  return handle
}
