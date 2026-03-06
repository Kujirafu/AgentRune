// commands/status.ts
import { readFileSync, existsSync } from "node:fs"
import { getPidFile, loadConfig } from "../shared/config.js"
import { log } from "../shared/logger.js"

export async function statusCommand() {
  // Check daemon
  const pidFile = getPidFile()
  if (existsSync(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim())
    try {
      process.kill(pid, 0) // Check if process exists
      log.success(`Daemon running (PID: ${pid})`)
    } catch {
      log.warn(`Daemon not running (stale PID file for PID: ${pid})`)
    }
  } else {
    log.info("Daemon not running")
  }

  // Check AgentLore login
  const config = loadConfig()
  if (config.agentlore) {
    log.success(`AgentLore: logged in (deviceId: ${config.agentlore.deviceId.slice(0, 8)}...)`)
  } else {
    log.info("AgentLore: not logged in (run `agentrune login`)")
  }

  // Show config
  log.dim(`  Port: ${config.port}`)
}
