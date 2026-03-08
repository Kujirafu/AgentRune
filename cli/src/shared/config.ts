// shared/config.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

export interface Config {
  port: number
  vaultPath?: string  // Obsidian vault path for shared memory (e.g. "C:/Users/me/Obsidian/MyVault")
  keyVaultPath?: string  // Path to key vault directory containing markdown files with API keys
  agentlore?: {
    token: string
    deviceId: string
  }
}

const DEFAULT_CONFIG: Config = {
  port: 3456,
}

export function getConfigDir(): string {
  const dir = join(homedir(), ".agentrune")
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json")
}

export function loadConfig(): Config {
  const dir = getConfigDir()
  const path = getConfigPath()
  let config: Config = { ...DEFAULT_CONFIG }

  // Load main config
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"))
      config = { ...config, ...raw }
    } catch { /* ignore */ }
  }

  // Load AgentLore credentials from agentlore.json (written by `agentrune login`)
  if (!config.agentlore) {
    const alPath = join(dir, "agentlore.json")
    if (existsSync(alPath)) {
      try {
        const al = JSON.parse(readFileSync(alPath, "utf-8"))
        if (al.token && al.deviceId) {
          config.agentlore = { token: al.token, deviceId: al.deviceId }
        }
      } catch { /* ignore */ }
    }
  }

  return config
}

export function saveConfig(config: Config): void {
  const path = getConfigPath()
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2))
}

export function getPidFile(): string {
  return join(getConfigDir(), "daemon.pid")
}
