// commands/stop.ts
import { readFileSync, unlinkSync, existsSync } from "node:fs"
import { getPidFile } from "../shared/config.js"
import { log } from "../shared/logger.js"

export async function stopCommand(opts?: { port?: string }) {
  const port = opts?.port ? parseInt(opts.port) : undefined
  const pidFile = getPidFile(port)
  if (!existsSync(pidFile)) {
    log.warn("No daemon running (PID file not found)")
    return
  }

  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim())
    process.kill(pid)
    unlinkSync(pidFile)
    log.success(`Daemon stopped (PID: ${pid})`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    // If process doesn't exist, clean up PID file
    if (message.includes("ESRCH")) {
      unlinkSync(pidFile)
      log.warn("Daemon was not running (stale PID file removed)")
    } else {
      log.error(`Failed to stop daemon: ${message}`)
    }
  }
}
