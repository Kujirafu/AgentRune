import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir, hostname, networkInterfaces } from "node:os"
import { randomBytes } from "node:crypto"
import open from "open"

const CONFIG_DIR = join(homedir(), ".agentrune")
const CONFIG_PATH = join(CONFIG_DIR, "agentlore.json")

const AGENTLORE_BASE = "https://agentlore.vercel.app"

interface AgentLoreConfig {
  deviceId: string
  token: string
}

export async function initAgentLore(PORT: number): Promise<AgentLoreConfig | null> {
  // Return existing config if already paired
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as AgentLoreConfig
    } catch {
      // Corrupted config — re-pair
    }
  }

  // First run: start link flow
  const deviceId = randomBytes(16).toString("hex")
  const deviceHostname = hostname()

  let res: Response
  try {
    res = await fetch(`${AGENTLORE_BASE}/api/agentrune/link/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, hostname: deviceHostname, port: PORT }),
    })
  } catch {
    console.log("  ✗ AgentLore: cannot reach server — skipping")
    return null
  }

  if (!res.ok) {
    console.log("  ✗ AgentLore: link/start failed")
    return null
  }

  const { data } = (await res.json()) as { data: { code: string; verifyUrl: string } }

  console.log(`\n  ✦ AgentLore 配對`)
  console.log(`  請在瀏覽器完成授權：${data.verifyUrl}\n`)

  // Auto-open browser
  open(data.verifyUrl).catch(() => {})

  const token = await pollUntilAuthorized(data.code, deviceId)
  if (!token) {
    console.log("  ✗ AgentLore 授權逾時，請重新執行\n")
    return null
  }

  const config: AgentLoreConfig = { deviceId, token }
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  console.log("  ✓ AgentLore 配對成功\n")
  return config
}

async function pollUntilAuthorized(code: string, deviceId: string): Promise<string | null> {
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    try {
      const r = await fetch(
        `${AGENTLORE_BASE}/api/agentrune/link/poll?code=${code}&deviceId=${deviceId}`
      )
      const { data } = (await r.json()) as { data: { status: string; token?: string } }
      if (data.status === "authorized" && data.token) return data.token
      if (data.status === "expired") return null
    } catch {
      // Network error — keep polling
    }
  }
  return null
}

export async function registerDevice(
  config: AgentLoreConfig,
  localIp: string,
  PORT: number,
  certFingerprint?: string
) {
  try {
    const res = await fetch(`${AGENTLORE_BASE}/api/agentrune/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: config.deviceId,
        localIp,
        port: PORT,
        platform: process.platform,
        certFingerprint,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string; limit?: number; plan?: string }
      if (err.error === "device_limit_reached") {
        console.log(`  ✗ AgentLore: 已達裝置上限 (${err.limit}台 / ${err.plan} 方案)`)
      }
      return
    }

    const { data } = (await res.json()) as { data: { mcpConfig: object } }
    writeMcpConfig(data.mcpConfig)
  } catch {
    // Heartbeat failure is non-fatal
  }
}

function writeMcpConfig(mcpConfig: object) {
  const settingsPath = join(homedir(), ".claude", "settings.json")
  try {
    let existing: Record<string, unknown> = {}
    if (existsSync(settingsPath)) {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>
    }
    const mcpServers = (mcpConfig as { mcpServers: Record<string, unknown> }).mcpServers
    const existingServers = existing.mcpServers as Record<string, unknown> | undefined
    if (!existingServers?.agentlore) {
      existing.mcpServers = { ...existingServers, ...mcpServers }
      mkdirSync(join(homedir(), ".claude"), { recursive: true })
      writeFileSync(settingsPath, JSON.stringify(existing, null, 2))
      console.log("  ✓ AgentLore MCP 已設定於 ~/.claude/settings.json")
    }
  } catch {
    // Non-fatal
  }
}

export function getLocalIp(): string {
  const nets = Object.values(networkInterfaces()).flat()
  return nets.find((n) => n && n.family === "IPv4" && !n.internal)?.address ?? "127.0.0.1"
}
