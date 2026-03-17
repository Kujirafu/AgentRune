// commands/restart.ts — Restart all daemons (or a specific port)
// Default: restarts BOTH 3456 (release) and 3457 (dev)
import { existsSync } from "node:fs"
import { createConnection } from "node:net"
import { getPidFile } from "../shared/config.js"
import { log } from "../shared/logger.js"
import { killProcessTree } from "../shared/process-tree.js"
import { readStateFile, unlinkStateFile } from "../shared/state-file.js"
import { getStopMarker } from "./stop.js"
import { startCommand } from "./start.js"

const ALL_PORTS = [3456, 3457]

/** Wait until a port is free (max retries) */
async function waitPortFree(port: number, maxWait = 5000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    const inUse = await new Promise<boolean>((resolve) => {
      const sock = createConnection({ port, host: "127.0.0.1" })
      sock.once("connect", () => { sock.destroy(); resolve(true) })
      sock.once("error", () => resolve(false))
      sock.setTimeout(500, () => { sock.destroy(); resolve(false) })
    })
    if (!inUse) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

/** Check if a port is listening */
async function isPortUp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" })
    sock.once("connect", () => { sock.destroy(); resolve(true) })
    sock.once("error", () => resolve(false))
    sock.setTimeout(2000, () => { sock.destroy(); resolve(false) })
  })
}

/** Kill daemon by PID file + clear stop marker */
async function killPort(port: number): Promise<void> {
  const pidFile = getPidFile(port)
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readStateFile(pidFile).trim())
      if (!Number.isFinite(pid) || pid <= 0) {
        log.warn(`  Port ${port}: invalid PID in file, skipping kill`)
        unlinkStateFile(pidFile)
        return
      }
      killProcessTree(pid)
      unlinkStateFile(pidFile)
      log.info(`  Port ${port}: killed PID ${pid}`)
    } catch {
      log.warn(`  Port ${port}: stale PID file removed`)
      try { unlinkStateFile(pidFile) } catch {}
    }
  } else {
    log.dim(`  Port ${port}: no PID file`)
  }

  // Also clear stop marker so start won't be blocked
  const marker = getStopMarker(port)
  if (existsSync(marker)) {
    try { unlinkStateFile(marker) } catch {}
  }
}

export async function restartCommand(opts?: { port?: string }) {
  const parsedPort = opts?.port ? parseInt(opts.port) : NaN
  if (opts?.port && (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535)) {
    log.error(`Invalid port: ${opts.port} (must be 1-65535)`)
    return
  }
  const ports = opts?.port ? [parsedPort] : ALL_PORTS

  log.info(`Restarting daemon${ports.length > 1 ? "s" : ""}: ${ports.join(", ")}`)

  // ─── Phase 1: Stop all target daemons ─────────────────────────
  log.info("\n[1/3] Stopping...")
  for (const port of ports) {
    await killPort(port)
  }

  // ─── Phase 2: Wait for ports to free ──────────────────────────
  log.info("\n[2/3] Waiting for ports to free...")
  for (const port of ports) {
    const freed = await waitPortFree(port)
    if (!freed) {
      log.warn(`  Port ${port}: still in use after timeout — start will force-kill`)
    } else {
      log.dim(`  Port ${port}: free`)
    }
  }

  // ─── Phase 3: Start all daemons ───────────────────────────────
  log.info("\n[3/3] Starting...")
  for (const port of ports) {
    await startCommand({ port: String(port) })
  }

  // ─── Verify ───────────────────────────────────────────────────
  // Wait a moment for servers to bind
  await new Promise(r => setTimeout(r, 2000))

  log.info("\nVerifying...")
  let allOk = true
  for (const port of ports) {
    const up = await isPortUp(port)
    if (up) {
      log.success(`  Port ${port}: running`)
    } else {
      log.error(`  Port ${port}: NOT responding`)
      allOk = false
    }
  }

  if (allOk) {
    log.success(`\nAll daemon${ports.length > 1 ? "s" : ""} restarted successfully`)
  } else {
    log.warn("\nSome daemons failed to start — check ~/.agentrune/daemon.log")
  }
}
