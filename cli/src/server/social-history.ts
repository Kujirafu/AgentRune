import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { loadConfig } from "../shared/config.js"
import type { SocialPlatform } from "./social-types.js"

const THREADS_MATERIALS_FILE = "Threads素材庫.md"
const MATERIALS_FOLDER = "社群"
const MARKDOWN_TABLE_DIVIDER_RE = /^\|?[\s:|-]+\|[\s|:.-]*$/

export interface SocialHistoryRecordRequest {
  platform: SocialPlatform
  recordType?: string
  recordTitle?: string
  recordMetrics?: string
}

export interface SocialHistoryRecordResult {
  success: boolean
  skipped?: boolean
  path?: string
  error?: string
}

export function recordPublishedSocialPost(request: SocialHistoryRecordRequest): SocialHistoryRecordResult {
  if (request.platform === "threads") {
    return recordThreadsHistory(request)
  }

  if (request.platform === "moltbook") {
    return {
      success: true,
      skipped: true,
    }
  }

  return {
    success: false,
    error: "Unsupported social history platform",
  }
}

function recordThreadsHistory(request: SocialHistoryRecordRequest): SocialHistoryRecordResult {
  const recordType = sanitizeCell(request.recordType)
  const recordTitle = sanitizeCell(request.recordTitle)
  const recordMetrics = sanitizeCell(request.recordMetrics) || "-"

  if (!recordType || !recordTitle) {
    return {
      success: false,
      error: "Threads publish metadata missing recordType or recordTitle",
    }
  }

  const filePath = resolveThreadsMaterialsPath()
  if (!filePath) {
    return {
      success: false,
      error: "Threads materials library path not configured",
    }
  }

  const date = formatLocalMonthDay(new Date())
  const row = `| ${date} | ${recordType} | ${recordTitle} | ${recordMetrics} |`

  const raw = readFileSync(filePath, "utf-8")
  if (raw.includes(row)) {
    return {
      success: true,
      skipped: true,
      path: filePath,
    }
  }

  const updated = insertRowIntoThreadsHistory(raw, row)
  if (updated === raw) {
    return {
      success: false,
      error: "Threads materials library table not found",
      path: filePath,
    }
  }

  writeFileSync(filePath, updated, "utf-8")
  return {
    success: true,
    path: filePath,
  }
}

function resolveThreadsMaterialsPath(): string | null {
  const cfg = loadConfig()
  if (cfg.vaultPath) {
    const direct = join(cfg.vaultPath, "AgentLore", MATERIALS_FOLDER, THREADS_MATERIALS_FILE)
    if (existsSync(direct)) return direct
  }

  if (cfg.keyVaultPath) {
    const agentLoreDir = dirname(cfg.keyVaultPath)
    const sibling = join(agentLoreDir, MATERIALS_FOLDER, THREADS_MATERIALS_FILE)
    if (existsSync(sibling)) return sibling
  }

  return null
}

function insertRowIntoThreadsHistory(raw: string, row: string): string {
  const lines = raw.split(/\r?\n/)
  const tableHeaderIndex = lines.findIndex((line, index) => {
    if (!line.trim().startsWith("|")) return false
    const divider = lines[index + 1]
    return typeof divider === "string" && MARKDOWN_TABLE_DIVIDER_RE.test(divider.trim())
  })
  if (tableHeaderIndex < 0 || tableHeaderIndex + 1 >= lines.length) return raw

  let insertIndex = tableHeaderIndex + 2
  while (insertIndex < lines.length && lines[insertIndex].trim().startsWith("|")) {
    insertIndex += 1
  }

  lines.splice(insertIndex, 0, row)
  return lines.join("\n")
}

function sanitizeCell(value?: string): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim().replace(/\r?\n+/g, " ").replace(/\|/g, "｜")
  return trimmed || undefined
}

function formatLocalMonthDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${month}-${day}`
}
