// commands/stop.ts
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs"
import { join } from "node:path"
import { getPidFile, getConfigDir } from "../shared/config.js"
import { log } from "../shared/logger.js"

/** Stop marker file — tells sibling daemon NOT to auto-restart this port */
export function getStopMarker(port: number): string {
  return join(getConfigDir(), `stop-${port}.marker`)
}

export async function stopCommand(opts?: { port?: string }) {
  const port = opts?.port ? parseInt(opts.port) : undefined
  const resolvedPort = port || 3456
  const pidFile = getPidFile(port)

  // Write stop marker so sibling daemon won't auto-restart
  const marker = getStopMarker(resolvedPort)
  writeFileSync(marker, String(Date.now()))

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
