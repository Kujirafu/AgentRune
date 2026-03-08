// commands/logout.ts
import { loadConfig, saveConfig } from "../shared/config.js"
import { log } from "../shared/logger.js"

export async function logoutCommand() {
  const config = loadConfig()

  if (!config.agentlore) {
    log.info("Not logged in.")
    return
  }

  delete config.agentlore
  saveConfig(config)
  log.success("Logged out from AgentLore.")
}
