// commands/start.ts
import { spawn } from "node:child_process"
import { writeFileSync, existsSync } from "node:fs"
import { getPidFile, loadConfig, saveConfig } from "../shared/config.js"
import { log } from "../shared/logger.js"

export async function startCommand(opts: { port?: string; foreground?: boolean }) {
  const port = parseInt(opts.port || "3456")

  if (opts.foreground) {
    // Run server in foreground
    const { createServer } = await import("../server/ws-server.js")
    createServer(port)
    return
  }

  // Daemon mode: spawn detached child
  const pidFile = getPidFile()
  if (existsSync(pidFile)) {
    log.warn("Daemon PID file exists -- server may already be running. Use `agentrune status` to check.")
  }

  const child = spawn(process.execPath, [
    ...process.argv.slice(1, 2), // the script path
    "start",
    "--foreground",
    "--port", String(port),
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })

  if (child.pid) {
    writeFileSync(pidFile, String(child.pid))
    child.unref()
    log.success(`AgentRune daemon started (PID: ${child.pid}, port: ${port})`)
  } else {
    log.error("Failed to start daemon")
  }
}
