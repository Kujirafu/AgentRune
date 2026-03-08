// server/vault-keys.ts
// Parse API keys from key vault markdown files and return as env vars
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { log } from "../shared/logger.js"

// Known API key env var patterns — only inject these (not random markdown headers)
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

/**
 * Parse a markdown file for env var key-value pairs.
 * Expects format:
 *   ### ENV_VAR_NAME
 *   ```
 *   value-here
 *   ```
 */
function parseMarkdownKeys(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const regex = /###\s+(\w+)\s*\n```\n([\s\S]*?)\n```/g
  let match
  while ((match = regex.exec(content)) !== null) {
    const name = match[1].trim()
    const value = match[2].trim()
    // Only include known API key patterns, skip placeholders
    if (API_KEY_PATTERNS.includes(name) && value && !value.includes("...") && value.length > 10) {
      result[name] = value
    }
  }
  return result
}

/**
 * Load API keys from a vault directory.
 * Reads all .md files in the directory and extracts key-value pairs.
 */
function loadKeysFromDir(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {}
  const keys: Record<string, string> = {}
  try {
    const files = readdirSync(dir).filter(f => f.endsWith(".md"))
    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), "utf-8")
        const parsed = parseMarkdownKeys(content)
        Object.assign(keys, parsed)
      } catch {}
    }
  } catch {}
  return keys
}

/**
 * Load API keys from all configured vault locations.
 * Priority: keyVaultPath > autoSaveKeysPath > vaultPath/AgentLore/金鑰庫 > ~/.agentrune/secrets
 */
export function loadVaultKeys(opts: {
  autoSaveKeysPath?: string
  vaultPath?: string
  keyVaultPath?: string
}): Record<string, string> {
  const keys: Record<string, string> = {}

  // 1. Direct key vault path (highest priority)
  if (opts.keyVaultPath) {
    const resolved = opts.keyVaultPath.replace(/^~/, homedir())
    Object.assign(keys, loadKeysFromDir(resolved))
  }

  // 2. Check autoSaveKeysPath (user-configured secrets directory)
  if (opts.autoSaveKeysPath) {
    const resolved = opts.autoSaveKeysPath.replace(/^~/, homedir())
    Object.assign(keys, loadKeysFromDir(resolved))
  }

  // 3. Check Obsidian vault 金鑰庫 directory
  if (opts.vaultPath) {
    const vaultKeysDir = join(opts.vaultPath, "AgentLore", "金鑰庫")
    Object.assign(keys, loadKeysFromDir(vaultKeysDir))
  }

  // 4. Check default ~/.agentrune/secrets as fallback
  const defaultDir = join(homedir(), ".agentrune", "secrets")
  Object.assign(keys, loadKeysFromDir(defaultDir))

  const count = Object.keys(keys).length
  if (count > 0) {
    log.info(`Loaded ${count} API keys from vault: ${Object.keys(keys).join(", ")}`)
  }

  return keys
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
    content = readFileSync(filePath, "utf-8")
  } else {
    content = "# AgentRune API Keys\n"
  }

  // Check if this env var already exists — replace it
  const entryRegex = new RegExp(`### ${envVar}\\s*\\n\`\`\`\\n[\\s\\S]*?\\n\`\`\``, "g")
  const newEntry = `### ${envVar}\n\`\`\`\n${value.trim()}\n\`\`\``

  if (entryRegex.test(content)) {
    content = content.replace(entryRegex, newEntry)
  } else {
    content = content.trimEnd() + `\n\n${newEntry}\n`
  }

  writeFileSync(filePath, content, "utf-8")
  log.info(`Saved API key: ${envVar}`)
}

/**
 * Delete an API key from ~/.agentrune/secrets/keys.md
 */
export function deleteVaultKey(envVar: string): void {
  const filePath = join(getDefaultVaultDir(), "keys.md")
  if (!existsSync(filePath)) return

  let content = readFileSync(filePath, "utf-8")
  const entryRegex = new RegExp(`\\n*### ${envVar}\\s*\\n\`\`\`\\n[\\s\\S]*?\\n\`\`\``, "g")
  content = content.replace(entryRegex, "")
  writeFileSync(filePath, content, "utf-8")
  log.info(`Deleted API key: ${envVar}`)
}

/**
 * List all saved keys (names only, for display).
 */
export function listVaultKeyNames(): string[] {
  const keys = loadVaultKeys({})
  return Object.keys(keys)
}
