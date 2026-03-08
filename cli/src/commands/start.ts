// commands/start.ts
import { spawn, execSync } from "node:child_process"
import { writeFileSync, readFileSync, existsSync, openSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { createConnection } from "node:net"
import { getPidFile, getConfigDir, loadConfig, saveConfig } from "../shared/config.js"
import { log } from "../shared/logger.js"

/** Check if a port is in use, and kill the occupying process if requested */
async function ensurePortFree(port: number): Promise<void> {
  const inUse = await new Promise<boolean>((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" })
    sock.once("connect", () => { sock.destroy(); resolve(true) })
    sock.once("error", () => resolve(false))
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false) })
  })

  if (!inUse) return

  log.warn(`Port ${port} is in use — killing old process...`)
  // On Windows, find PID using netstat
  try {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTEN`, { encoding: "utf-8" })
    const match = out.match(/LISTENING\s+(\d+)/)
    if (match) {
      const pid = parseInt(match[1])
      try { process.kill(pid); } catch {}
      // Wait a bit for port to free up
      await new Promise(r => setTimeout(r, 1000))
      log.info(`Killed old process (PID: ${pid})`)
    }
  } catch {
    // netstat might not find it, try POSIX approach
    try {
      execSync(`kill $(lsof -t -i:${port}) 2>/dev/null || true`, { encoding: "utf-8" })
      await new Promise(r => setTimeout(r, 1000))
    } catch {}
  }
}

export async function startCommand(opts: { port?: string; foreground?: boolean }) {
  const port = parseInt(opts.port || "3456")

  if (opts.foreground) {
    // Run server in foreground
    const { createServer } = await import("../server/ws-server.js")
    createServer(port)
    return
  }

  // Kill any stale process on the port before starting
  await ensurePortFree(port)

  // Clean up stale PID file
  const pidFile = getPidFile()
  if (existsSync(pidFile)) {
    try {
      const oldPid = parseInt(readFileSync(pidFile, "utf-8").trim())
      try { process.kill(oldPid); } catch {} // kill old daemon if alive
    } catch {}
    unlinkSync(pidFile)
  }

  // Log daemon output to file for debugging crashes
  const logFile = join(getConfigDir(), "daemon.log")
  const logFd = openSync(logFile, "a")

  // Propagate execArgv (e.g. tsx --require/--import loaders) so daemon child can run .ts
  const child = spawn(process.execPath, [
    ...process.execArgv,
    ...process.argv.slice(1, 2), // the script path
    "start",
    "--foreground",
    "--port", String(port),
  ], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    cwd: process.cwd(),
  })

  if (child.pid) {
    writeFileSync(pidFile, String(child.pid))
    child.unref()
    log.success(`AgentRune daemon started (PID: ${child.pid}, port: ${port})`)
  } else {
    log.error("Failed to start daemon")
  }
}
