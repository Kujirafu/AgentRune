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
}

export async function startTunnel(localPort: number): Promise<TunnelHandle> {
  let binPath = findCloudflared()
  if (!binPath) {
    binPath = await downloadCloudflared()
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(binPath!, [
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

    // cloudflared prints the tunnel URL to stderr like:
    // INF +----------------------------+
    // INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
    // INF |  https://xxx-yyy-zzz.trycloudflare.com                                                    |
    // INF +----------------------------+
    // Or in newer versions: INF Registered tunnel connection ... url=https://...
    const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      if (!resolved) {
        const match = text.match(urlRegex) || stderr.match(urlRegex)
        if (match) {
          resolved = true
          clearTimeout(timeout)
          const tunnelUrl = match[0]
          log.info(`Tunnel ready: ${tunnelUrl}`)
          resolve({
            url: tunnelUrl,
            stop: () => {
              try { proc.kill() } catch {}
            },
          })
        }
      }
    })

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      if (!resolved) {
        const match = text.match(urlRegex)
        if (match) {
          resolved = true
          clearTimeout(timeout)
          log.info(`Tunnel ready: ${match[0]}`)
          resolve({
            url: match[0],
            stop: () => { try { proc.kill() } catch {} },
          })
        }
      }
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
      } else {
        log.warn(`Tunnel process exited (code ${code})`)
      }
    })
  })
}
