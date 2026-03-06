// commands/login.ts
import { hostname } from "node:os"
import { loadConfig, saveConfig } from "../shared/config.js"
import { log } from "../shared/logger.js"

const AGENTLORE_BASE = "https://agentlore.vercel.app"

export async function loginCommand() {
  const config = loadConfig()

  if (config.agentlore) {
    log.info("Already logged in. Run `agentrune logout` first to re-authenticate.")
    return
  }

  const deviceHostname = hostname()

  // Step 1: Start link flow
  let res: Response
  try {
    res = await fetch(`${AGENTLORE_BASE}/api/agentrune/link/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname: deviceHostname, port: config.port }),
    })
  } catch {
    log.error("Cannot reach AgentLore server")
    return
  }

  if (!res.ok) {
    log.error("link/start failed")
    return
  }

  const { data } = (await res.json()) as { data: { code: string; verifyUrl: string } }

  log.info(`Open this URL to authorize:`)
  console.log(`\n  ${data.verifyUrl}\n`)

  // Step 2: Try to open browser
  try {
    const open = (await import("open")).default
    await open(data.verifyUrl)
    log.dim("  (Browser opened)")
  } catch {
    log.dim("  (Could not open browser -- open the URL manually)")
  }

  // Step 3: Poll for authorization
  log.info("Waiting for authorization...")

  const deviceId = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const r = await fetch(
        `${AGENTLORE_BASE}/api/agentrune/link/poll?code=${data.code}&deviceId=${deviceId}`
      )
      const { data: pollData } = (await r.json()) as { data: { status: string; token?: string } }
      if (pollData.status === "authorized" && pollData.token) {
        config.agentlore = { token: pollData.token, deviceId }
        saveConfig(config)
        log.success("Logged in to AgentLore!")
        return
      }
      if (pollData.status === "expired") {
        log.error("Authorization expired. Please try again.")
        return
      }
    } catch {
      // Network error -- keep polling
    }
  }

  log.error("Authorization timed out.")
}
