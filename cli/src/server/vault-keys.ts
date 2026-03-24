// server/vault-keys.ts
// Parse secrets from markdown vault files and expose only allowlisted names.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { log } from "../shared/logger.js"
import { isEncrypted, readEncryptedFile, writeEncryptedFile } from "./crypto.js"

const KEY_VAULT_DIRNAME = "金鑰庫"

/** Escape string for safe use in RegExp constructor */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
const MARKDOWN_SECRET_REGEX = /###\s+([^\n`]+?)\s*\r?\n```\r?\n([\s\S]*?)\r?\n```/g

// Only inject API-style keys into PTY sessions.
const API_KEY_PATTERNS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENCLAW_API_KEY",
  "AGENTLORE_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "REPLICATE_API_TOKEN",
  "COHERE_API_KEY",
  "XAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
]

export interface VaultSecretLoadOptions {
  autoSaveKeysPath?: string
  vaultPath?: string
  keyVaultPath?: string
}

export function loadVaultKeys(opts: VaultSecretLoadOptions): Record<string, string> {
  const keys = loadNamedVaultSecrets(opts, API_KEY_PATTERNS)
  const count = Object.keys(keys).length
  if (count > 0) {
    log.info(`Loaded ${count} API keys from vault`)
  }
  return keys
}

export function loadNamedVaultSecrets(
  opts: VaultSecretLoadOptions,
  allowedNames: string[],
): Record<string, string> {
  const wanted = new Set(allowedNames)
  const secrets: Record<string, string> = {}

  for (const dir of getVaultSecretDirs(opts)) {
    Object.assign(secrets, loadSecretsFromDir(dir, wanted))
  }

  return secrets
}

export function getVaultSecretDirs(opts: VaultSecretLoadOptions): string[] {
  const dirs: string[] = []
  const addDir = (value?: string) => {
    if (!value) return
    const resolved = value.replace(/^~/, homedir())
    if (!dirs.includes(resolved)) dirs.push(resolved)
  }

  addDir(opts.keyVaultPath)
  addDir(opts.autoSaveKeysPath)
  if (opts.vaultPath) addDir(join(opts.vaultPath.replace(/^~/, homedir()), "AgentLore", KEY_VAULT_DIRNAME))
  addDir(join(homedir(), ".agentrune", "secrets"))

  return dirs
}

function loadSecretsFromDir(dir: string, wanted: Set<string>): Record<string, string> {
  if (!existsSync(dir)) return {}

  const secrets: Record<string, string> = {}
  for (const file of safeReadDir(dir)) {
    if (!file.endsWith(".md")) continue
    const filePath = join(dir, file)
    const content = readSecretFile(filePath)
    if (!content) continue
    Object.assign(secrets, parseMarkdownSecrets(content, wanted))
    maybeEncryptLocalSecretFile(dir, filePath, content, file)
  }

  return secrets
}

function safeReadDir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function readSecretFile(filePath: string): string | null {
  try {
    return readEncryptedFile(filePath)
  } catch {
    try {
      return readFileSync(filePath, "utf-8")
    } catch {
      return null
    }
  }
}

function maybeEncryptLocalSecretFile(dir: string, filePath: string, content: string, file: string): void {
  if (!dir.includes(".agentrune")) return

  try {
    const raw = readFileSync(filePath, "utf-8")
    if (!isEncrypted(raw)) {
      writeEncryptedFile(filePath, content)
      log.info(`Migrated ${file} to encrypted storage`)
    }
  } catch {
    // Ignore migration failures; reading already succeeded.
  }
}

function parseMarkdownSecrets(content: string, wanted: Set<string>): Record<string, string> {
  const secrets: Record<string, string> = {}
  MARKDOWN_SECRET_REGEX.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = MARKDOWN_SECRET_REGEX.exec(content)) !== null) {
    const name = normalizeSecretHeading(match[1])
    if (!wanted.has(name)) continue

    const value = match[2].trim()
    if (!value || value.includes("...")) continue
    secrets[name] = value
  }

  return secrets
}

function normalizeSecretHeading(rawName: string): string {
  return rawName.replace(/\s+\(.*?\)\s*$/, "").trim()
}

/** Default vault directory for saving keys from the app */
function getDefaultVaultDir(): string {
  return join(homedir(), ".agentrune", "secrets")
}

/**
 * Save an API key to ~/.agentrune/secrets/keys.md
 * Updates existing entry or appends new one.
 */
export function saveVaultKey(envVar: string, value: string): void {
  const dir = getDefaultVaultDir()
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, "keys.md")

  let content = ""
  if (existsSync(filePath)) {
    content = readEncryptedFile(filePath) || "# AgentRune API Keys\n"
  } else {
    content = "# AgentRune API Keys\n"
  }

  const safeVar = escapeRegex(envVar)
  const entryRegex = new RegExp(`### ${safeVar}\\s*\\n\`\`\`\\n[\\s\\S]*?\\n\`\`\``, "g")
  const newEntry = `### ${envVar}\n\`\`\`\n${value.trim()}\n\`\`\``

  if (entryRegex.test(content)) {
    entryRegex.lastIndex = 0
    content = content.replace(entryRegex, newEntry)
  } else {
    content = content.trimEnd() + `\n\n${newEntry}\n`
  }

  writeEncryptedFile(filePath, content)
  log.info(`Saved API key: ${envVar}`)
}

/**
 * Delete an API key from ~/.agentrune/secrets/keys.md
 */
export function deleteVaultKey(envVar: string): void {
  const filePath = join(getDefaultVaultDir(), "keys.md")
  if (!existsSync(filePath)) return

  let content = readEncryptedFile(filePath)
  if (!content) return
  const safeVar2 = escapeRegex(envVar)
  const entryRegex = new RegExp(`\\n*### ${safeVar2}\\s*\\n\`\`\`\\n[\\s\\S]*?\\n\`\`\``, "g")
  content = content.replace(entryRegex, "")
  writeEncryptedFile(filePath, content)
  log.info(`Deleted API key: ${envVar}`)
}

/**
 * List all saved keys (names only, for display).
 */
export function listVaultKeyNames(): string[] {
  return Object.keys(loadVaultKeys({}))
}
