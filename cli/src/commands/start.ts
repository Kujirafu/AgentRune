// commands/start.ts
import { spawn, execSync } from "node:child_process"
import { writeFileSync, readFileSync, existsSync, openSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { createConnection } from "node:net"
import { fileURLToPath } from "node:url"
import { getPidFile, getConfigDir, loadConfig, saveConfig } from "../shared/config.js"
import { log } from "../shared/logger.js"

/** Check if a port is in use, and kill the occupying process if requested */
async function ensurePortFree(port: number): Promise<void> {
  // Validate port is a safe integer in valid range
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port number: ${port}`)
  }

  const inUse = await new Promise<boolean>((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" })
    sock.once("connect", () => { sock.destroy(); resolve(true) })
    sock.once("error", () => resolve(false))
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false) })
  })

  if (!inUse) return

  log.warn(`Port ${port} is in use — killing old process...`)
  const portStr = String(port)
  // On Windows, find PID using netstat (safe: port validated as integer above)
  try {
    const out = execSync(`netstat -ano | findstr :${portStr} | findstr LISTEN`, { encoding: "utf-8" })
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
      execSync(`kill $(lsof -t -i:${portStr}) 2>/dev/null || true`, { encoding: "utf-8" })
      await new Promise(r => setTimeout(r, 1000))
    } catch {}
  }
}

export async function startCommand(opts: { port?: string; foreground?: boolean }) {
  const port = parseInt(opts.port || "3456")

  if (opts.foreground) {
    // Run server in foreground with self-healing
    const { createServer } = await import("../server/ws-server.js")
    const { automationManager } = createServer(port)
    setupSelfHealing(automationManager)
    return
  }

  // Clear stop marker (signal sibling it's OK to auto-restart us again)
  const { getStopMarker } = await import("./stop.js")
  const marker = getStopMarker(port)
  if (existsSync(marker)) unlinkSync(marker)

  // Kill any stale process on the port before starting
  await ensurePortFree(port)

  // Clean up stale PID file
  const pidFile = getPidFile(port)
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

  // Resolve entry point from this file's location
  // In compiled mode (dist/), use bin.js; in dev mode (tsx), use bin.ts
  const __filename = fileURLToPath(import.meta.url)
  const distBin = join(__filename, "..", "bin.js")
  const srcBin = join(__filename, "..", "..", "bin.ts")
  const binScript = existsSync(distBin) ? distBin : srcBin
  // Only propagate --import flag (e.g. tsx/esm), not -e or script content
  const loaderArgs: string[] = []
  for (let i = 0; i < process.execArgv.length; i++) {
    if (process.execArgv[i] === "--import" && process.execArgv[i + 1]) {
      loaderArgs.push("--import", process.execArgv[i + 1])
      i++
    }
  }
  const child = spawn(process.execPath, [
    ...loaderArgs,
    binScript,
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

/** Self-healing: catch uncaught errors so the server process doesn't crash */
function setupSelfHealing(automationManager?: import("../server/automation-manager.js").AutomationManager) {
  process.on("uncaughtException", (err) => {
    log.error(`[Self-heal] Uncaught exception: ${err.message}`)
    if (err.stack) log.dim(err.stack)
    // Don't exit — let the server keep running
  })
  process.on("unhandledRejection", (reason: any) => {
    const msg = reason?.message || String(reason)
    log.error(`[Self-heal] Unhandled rejection: ${msg}`)
    // Don't exit — let the server keep running
  })
  // Log exit reason — helps diagnose silent daemon deaths
  process.on("exit", (code) => {
    log.error(`[Self-heal] Process exiting with code ${code} (memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB)`)
  })

  // Graceful shutdown: save automation state before exit
  const shutdown = async (signal: string) => {
    log.warn(`[Self-heal] Received ${signal}`)
    if (automationManager) {
      await automationManager.gracefulShutdown()
    }
    process.exit(0)
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
}
