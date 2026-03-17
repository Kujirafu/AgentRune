// shared/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
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

const KEY_VAULT_DIRNAME = "金鑰庫"

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
      const raw = readFileSync(path, "utf-8")
      const parsed = parseConfigText(raw)
      if (parsed) {
        config = { ...config, ...parsed.config }
        if (parsed.recovered) saveConfig(config)
      }
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
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2))
}

export function getPidFile(port?: number): string {
  const suffix = port && port !== 3456 ? `-${port}` : ""
  return join(getConfigDir(), `daemon${suffix}.pid`)
}

export function recoverConfigFromText(raw: string): Partial<Config> | null {
  const recovered: Partial<Config> = {}
  const portMatch = raw.match(/"port"\s*:\s*(\d+)/)
  const port = portMatch ? Number.parseInt(portMatch[1], 10) : NaN
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    recovered.port = port
  }

  const vaultPath = extractPathLikeValue(raw, "vaultPath")
  if (vaultPath) recovered.vaultPath = vaultPath

  const keyVaultPath = extractPathLikeValue(raw, "keyVaultPath")
  if (keyVaultPath) recovered.keyVaultPath = repairRecoveredKeyVaultPath(keyVaultPath)

  return Object.keys(recovered).length > 0 ? recovered : null
}

function parseConfigText(raw: string): { config: Partial<Config>; recovered: boolean } | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Config>
    return { config: parsed, recovered: false }
  } catch {
    const recovered = recoverConfigFromText(raw)
    if (!recovered) return null
    return { config: recovered, recovered: true }
  }
}

function extractPathLikeValue(raw: string, key: "vaultPath" | "keyVaultPath"): string | undefined {
  const strict = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\r\\n]+)"`))
  const loose = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^\\r\\n}]*)`))
  const candidate = (strict?.[1] || loose?.[1] || "").trim()
  if (!candidate) return undefined

  const normalized = candidate
    .replace(/[",]+$/, "")
    .replace(/\s+$/, "")
    .replace(/^~/, homedir())

  return normalized || undefined
}

function repairRecoveredKeyVaultPath(input: string): string {
  if (existsSync(input)) return input

  const normalized = input.replace(/[\\/]+$/, "")
  if (existsSync(normalized)) return normalized

  const parent = dirname(normalized)
  const fallback = join(parent, KEY_VAULT_DIRNAME)
  if (existsSync(fallback)) return fallback

  return normalized
}
