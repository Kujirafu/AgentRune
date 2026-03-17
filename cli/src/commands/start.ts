// commands/start.ts
import { spawn, execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createConnection } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { getPidFile, getConfigDir, loadConfig, saveConfig } from "../shared/config.js"
import { log } from "../shared/logger.js"
import { killProcessTree } from "../shared/process-tree.js"
import { openStateFileForAppend, readStateFile, unlinkStateFile, writeStateFile } from "../shared/state-file.js"

function findListeningPid(port: number): number | null {
  const portSuffix = `:${port}`

  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano"], {
        encoding: "utf-8",
        windowsHide: true,
      })
      for (const line of out.split(/\r?\n/)) {
        const columns = line.trim().split(/\s+/)
        if (columns.length < 4) continue
        const localAddress = columns[1] ?? ""
        const pid = Number.parseInt(columns[columns.length - 1] ?? "", 10)
        if (localAddress.endsWith(portSuffix) && columns.some((column) => /LISTEN/i.test(column)) && Number.isInteger(pid) && pid > 0) {
          return pid
        }
      }
      return null
    }

    const out = execFileSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf-8",
    }).trim()
    const pid = Number.parseInt(out.split(/\r?\n/)[0] ?? "", 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/** Check if a port is in use, and kill the occupying process if requested */
async function ensurePortFree(port: number): Promise<void> {
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

  log.warn(`Port ${port} is in use ??killing old process...`)
  const pid = findListeningPid(port)
  if (!pid) return

  killProcessTree(pid)
  await new Promise((resolve) => setTimeout(resolve, 1000))
  log.info(`Killed old process (PID: ${pid})`)
}

export async function startCommand(opts: { port?: string; foreground?: boolean }) {
  const port = parseInt(opts.port || "3456")

  if (opts.foreground) {
    const { createServer } = await import("../server/ws-server.js")
    const { automationManager } = createServer(port)
    setupSelfHealing(automationManager)
    return
  }

  const { getStopMarker } = await import("./stop.js")
  const marker = getStopMarker(port)
  if (existsSync(marker)) unlinkStateFile(marker)

  await ensurePortFree(port)

  const pidFile = getPidFile(port)
  if (existsSync(pidFile)) {
    try {
      const oldPid = parseInt(readStateFile(pidFile).trim())
      killProcessTree(oldPid)
    } catch {}
    unlinkStateFile(pidFile)
  }

  const logFile = join(getConfigDir(), "daemon.log")
  const logFd = openStateFileForAppend(logFile)

  const __filename = fileURLToPath(import.meta.url)
  const distBin = join(__filename, "..", "bin.js")
  const srcBin = join(__filename, "..", "..", "bin.ts")
  const binScript = existsSync(distBin) ? distBin : srcBin

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
    "--port",
    String(port),
  ], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    cwd: process.cwd(),
  })

  if (child.pid) {
    writeStateFile(pidFile, String(child.pid))
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
  })

  process.on("unhandledRejection", (reason: any) => {
    const msg = reason?.message || String(reason)
    log.error(`[Self-heal] Unhandled rejection: ${msg}`)
  })

  process.on("exit", (code) => {
    log.error(`[Self-heal] Process exiting with code ${code} (memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB)`)
    if (automationManager) {
      automationManager.killAllRunning()
    }
  })

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
