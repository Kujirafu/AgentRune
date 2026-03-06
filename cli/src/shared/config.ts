// shared/config.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

export interface Config {
  port: number
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
  const path = getConfigPath()
  if (!existsSync(path)) return { ...DEFAULT_CONFIG }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"))
    return { ...DEFAULT_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: Config): void {
  const path = getConfigPath()
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2))
}

export function getPidFile(): string {
  return join(getConfigDir(), "daemon.pid")
}
