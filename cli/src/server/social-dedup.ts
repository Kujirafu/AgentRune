import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getConfigDir } from "../shared/config.js"
import type { SocialPlatform } from "./social-types.js"

const HISTORY_FILE = "social-post-history.json"
const LEGACY_MOLTBOOK_HISTORY_FILE = "moltbook-history.json"
const HISTORY_VERSION = 2
const MAX_ENTRIES_PER_PLATFORM = 200
const MAX_COOLDOWNS = 8
const DEFAULT_DUPLICATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_PLATFORM_COOLDOWN_MS = 30 * 60 * 1000
const DEFAULT_PROMPT_LIMIT = 5
const MAX_EXCERPT_LENGTH = 140

interface SocialPostHistoryStore {
  version: number
  posts: SocialPostHistoryEntry[]
  cooldowns: SocialPublishCooldownEntry[]
}

export interface SocialPostHistoryEntry {
  platform: SocialPlatform
  text: string
  title?: string
  normalizedText: string
  fingerprint: string
  publishedAt: number
  postId?: string
  source?: string
  reason?: string
  recordType?: string
  recordTitle?: string
  recordMetrics?: string
}

export interface RememberSocialPostRequest {
  platform: SocialPlatform
  text: string
  title?: string
  publishedAt?: number
  postId?: string
  source?: string
  reason?: string
  recordType?: string
  recordTitle?: string
  recordMetrics?: string
}

export interface RememberSocialPostResult {
  success: boolean
  stored: boolean
  entry?: SocialPostHistoryEntry
  error?: string
}

export interface FindDuplicateSocialPostRequest {
  platform: SocialPlatform
  text: string
  title?: string
  now?: number
  withinMs?: number
}

export interface SocialDuplicateMatch extends SocialPostHistoryEntry {
  ageMs: number
}

export interface SocialPublishCooldownEntry {
  platform: SocialPlatform
  reason: string
  createdAt: number
  expiresAt: number
  source?: string
  error?: string
  statusCode?: number
  retryAfterMs?: number
}

export interface RememberSocialPublishCooldownRequest {
  platform: SocialPlatform
  reason: string
  createdAt?: number
  cooldownMs?: number
  expiresAt?: number
  source?: string
  error?: string
  statusCode?: number
  retryAfterMs?: number
}

export interface SocialPublishCooldownResult {
  success: boolean
  stored: boolean
  entry?: SocialPublishCooldownEntry
  error?: string
}

export interface ClearSocialPublishCooldownResult {
  success: boolean
  cleared: boolean
  error?: string
}

interface LegacyMoltbookItem {
  action?: string
  title?: string
  text?: string
  author?: string
  post_id?: string
  comment_id?: string
  remote_id?: string
  created_at?: string
  source?: string
}

export function normalizeSocialPostText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/gi, (url) => url.replace(/[/?#]+$/g, ""))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

export function computeSocialPostFingerprint(text: string): string {
  const normalized = normalizeSocialPostText(text)
  return createHash("sha256").update(normalized || text.trim()).digest("hex")
}

export function findDuplicateSocialPost(request: FindDuplicateSocialPostRequest): SocialDuplicateMatch | null {
  const normalized = normalizeSocialPostPayload(request.platform, request.text, request.title)
  if (!normalized) return null

  const now = request.now ?? Date.now()
  const withinMs = request.withinMs ?? DEFAULT_DUPLICATE_WINDOW_MS
  const fingerprint = computeSocialPostFingerprintForPayload(request.platform, request.text, request.title)

  for (const entry of loadPlatformHistory(request.platform)) {
    const ageMs = now - entry.publishedAt
    if (ageMs < 0 || ageMs > withinMs) continue
    if (entry.fingerprint !== fingerprint) continue
    return { ...entry, ageMs }
  }

  return null
}

export function rememberSocialPost(request: RememberSocialPostRequest): RememberSocialPostResult {
  const title = request.title?.trim()
  const text = request.text.trim()
  const normalizedText = normalizeSocialPostPayload(request.platform, text, title)
  if (!normalizedText) {
    return { success: false, stored: false, error: "Cannot store empty social post text" }
  }

  try {
    const publishedAt = request.publishedAt ?? Date.now()
    const fingerprint = computeSocialPostFingerprintForPayload(request.platform, text, title)
    const store = loadSystemHistory()
    const existing = loadPlatformHistory(request.platform).find((entry) =>
      (request.postId && entry.postId === request.postId) ||
      (entry.fingerprint === fingerprint && Math.abs(entry.publishedAt - publishedAt) < 60_000)
    )

    if (existing) {
      return { success: true, stored: false, entry: existing }
    }

    const entry: SocialPostHistoryEntry = {
      platform: request.platform,
      text,
      title: title || undefined,
      normalizedText,
      fingerprint,
      publishedAt,
      postId: normalizeOptional(request.postId),
      source: normalizeOptional(request.source),
      reason: normalizeOptional(request.reason),
      recordType: normalizeOptional(request.recordType),
      recordTitle: normalizeOptional(request.recordTitle),
      recordMetrics: normalizeOptional(request.recordMetrics),
    }

    const platformPosts = store.posts
      .filter((item) => item.platform === request.platform)
      .sort((a, b) => b.publishedAt - a.publishedAt)
    const otherPosts = store.posts.filter((item) => item.platform !== request.platform)
    const keptPlatformPosts = [entry, ...platformPosts].slice(0, MAX_ENTRIES_PER_PLATFORM)

    saveSystemHistory({
      version: HISTORY_VERSION,
      posts: [...keptPlatformPosts, ...otherPosts].sort((a, b) => b.publishedAt - a.publishedAt),
      cooldowns: pruneCooldowns(store.cooldowns, publishedAt),
    })

    if (entry.platform === "moltbook") {
      try {
        appendLegacyMoltbookHistory(entry)
      } catch {
        // Best-effort compatibility with legacy Moltbook scripts.
      }
    }

    return { success: true, stored: true, entry }
  } catch (err) {
    return {
      success: false,
      stored: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function getActiveSocialPublishCooldown(
  platform: SocialPlatform,
  now = Date.now(),
): SocialPublishCooldownEntry | null {
  return loadSystemHistory()
    .cooldowns
    .filter((entry) => entry.platform === platform && entry.expiresAt > now)
    .sort((a, b) => b.expiresAt - a.expiresAt)[0] || null
}

export function rememberSocialPublishCooldown(
  request: RememberSocialPublishCooldownRequest,
): SocialPublishCooldownResult {
  const reason = request.reason.trim()
  if (!reason) {
    return { success: false, stored: false, error: "Cooldown reason is required" }
  }

  const createdAt = request.createdAt ?? Date.now()
  const cooldownMs = request.expiresAt
    ? Math.max(1, request.expiresAt - createdAt)
    : Math.max(1, request.cooldownMs ?? request.retryAfterMs ?? DEFAULT_PLATFORM_COOLDOWN_MS)
  const expiresAt = request.expiresAt ?? (createdAt + cooldownMs)

  try {
    const store = loadSystemHistory()
    const entry: SocialPublishCooldownEntry = {
      platform: request.platform,
      reason,
      createdAt,
      expiresAt,
      source: normalizeOptional(request.source),
      error: normalizeOptional(request.error)?.slice(0, 200),
      statusCode: typeof request.statusCode === "number" ? request.statusCode : undefined,
      retryAfterMs: typeof request.retryAfterMs === "number" ? request.retryAfterMs : undefined,
    }

    const cooldowns = pruneCooldowns([
      entry,
      ...store.cooldowns.filter((item) => item.platform !== request.platform),
    ], createdAt)

    saveSystemHistory({
      version: HISTORY_VERSION,
      posts: store.posts,
      cooldowns,
    })

    return { success: true, stored: true, entry }
  } catch (err) {
    return {
      success: false,
      stored: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function clearSocialPublishCooldown(platform: SocialPlatform): ClearSocialPublishCooldownResult {
  try {
    const store = loadSystemHistory()
    const cooldowns = store.cooldowns.filter((entry) => entry.platform !== platform)
    if (cooldowns.length === store.cooldowns.length) {
      return { success: true, cleared: false }
    }

    saveSystemHistory({
      version: HISTORY_VERSION,
      posts: store.posts,
      cooldowns,
    })

    return { success: true, cleared: true }
  } catch (err) {
    return {
      success: false,
      cleared: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function buildRecentSocialPostPromptContext(
  platform: SocialPlatform,
  limit = DEFAULT_PROMPT_LIMIT,
): string | null {
  const posts = loadPlatformHistory(platform)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, limit)

  if (posts.length === 0) return null

  return [
    `[Recent ${platformLabel(platform)} Posts]`,
    "AgentRune already published these posts recently and will block duplicate or trivially reformatted text.",
    ...posts.map((entry) => {
      const heading = [
        formatPromptTimestamp(entry.publishedAt),
        entry.recordType,
        entry.recordTitle || entry.title,
      ].filter(Boolean).join(" | ") || formatPromptTimestamp(entry.publishedAt)
      return `- ${heading}\n  Excerpt: ${buildExcerpt(entry)}`
    }),
    "If your best candidate is materially the same as one of the above, emit the skip marker instead of the post marker.",
  ].join("\n")
}

export function formatSocialDuplicateMatch(match: SocialDuplicateMatch): string {
  const parts = [
    formatPromptTimestamp(match.publishedAt),
    match.recordType,
    match.recordTitle || match.title,
    match.postId ? `post ${match.postId}` : undefined,
  ].filter(Boolean)

  return parts.join(" | ") || formatPromptTimestamp(match.publishedAt)
}

export function formatSocialPublishCooldown(entry: SocialPublishCooldownEntry, now = Date.now()): string {
  const remainingMs = Math.max(0, entry.expiresAt - now)
  const remainingMinutes = Math.ceil(remainingMs / 60_000)
  const remainingLabel = remainingMinutes >= 60
    ? `${Math.ceil(remainingMinutes / 60)}h remaining`
    : `${remainingMinutes}m remaining`
  return `${formatPromptTimestamp(entry.expiresAt)} | ${remainingLabel}`
}

function composeSocialPostBody(platform: SocialPlatform, text: string, title?: string): string {
  if (platform === "moltbook" && title?.trim()) {
    return `${title.trim()}\n\n${text}`
  }
  return text
}

function normalizeSocialPostPayload(platform: SocialPlatform, text: string, title?: string): string {
  return normalizeSocialPostText(composeSocialPostBody(platform, text, title))
}

function computeSocialPostFingerprintForPayload(platform: SocialPlatform, text: string, title?: string): string {
  return computeSocialPostFingerprint(composeSocialPostBody(platform, text, title))
}

function loadSystemHistory(): SocialPostHistoryStore {
  const filePath = getSystemHistoryFilePath()
  if (!existsSync(filePath)) {
    return { version: HISTORY_VERSION, posts: [], cooldowns: [] }
  }

  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw) as Partial<SocialPostHistoryStore>
    const posts = Array.isArray(parsed.posts) ? parsed.posts.filter(isValidHistoryEntry) : []
    const cooldowns = Array.isArray(parsed.cooldowns)
      ? sanitizeCooldowns(parsed.cooldowns.filter(isValidCooldownEntry))
      : []
    return {
      version: typeof parsed.version === "number" ? parsed.version : HISTORY_VERSION,
      posts,
      cooldowns,
    }
  } catch {
    return { version: HISTORY_VERSION, posts: [], cooldowns: [] }
  }
}

function loadPlatformHistory(platform: SocialPlatform): SocialPostHistoryEntry[] {
  const systemPosts = loadSystemHistory().posts.filter((entry) => entry.platform === platform)
  if (platform !== "moltbook") return systemPosts
  return dedupeHistoryEntries([...systemPosts, ...loadLegacyMoltbookHistory()])
}

function saveSystemHistory(store: SocialPostHistoryStore): void {
  const filePath = getSystemHistoryFilePath()
  mkdirSync(getConfigDir(), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.tmp`
  try {
    writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8")
    renameSync(tmpPath, filePath)
  } catch (err) {
    try { unlinkSync(tmpPath) } catch {}
    throw err
  }
}

function getSystemHistoryFilePath(): string {
  return join(getConfigDir(), HISTORY_FILE)
}

function getLegacyMoltbookHistoryFilePath(): string {
  return join(getConfigDir(), LEGACY_MOLTBOOK_HISTORY_FILE)
}

function loadLegacyMoltbookHistory(): SocialPostHistoryEntry[] {
  const filePath = getLegacyMoltbookHistoryFilePath()
  if (!existsSync(filePath)) return []

  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw) as { items?: LegacyMoltbookItem[] }
    const items = Array.isArray(parsed.items) ? parsed.items : []
    return items
      .map(mapLegacyMoltbookItem)
      .filter((entry): entry is SocialPostHistoryEntry => Boolean(entry))
  } catch {
    return []
  }
}

function mapLegacyMoltbookItem(item: LegacyMoltbookItem): SocialPostHistoryEntry | null {
  const text = item.text?.trim() || ""
  const title = item.title?.trim() || undefined
  const normalizedText = normalizeSocialPostPayload("moltbook", text, title)
  const createdAt = Date.parse(item.created_at || "")
  if (!normalizedText || Number.isNaN(createdAt)) return null

  return {
    platform: "moltbook",
    text,
    title,
    normalizedText,
    fingerprint: computeSocialPostFingerprintForPayload("moltbook", text, title),
    publishedAt: createdAt,
    postId: normalizeOptional(item.post_id || item.remote_id || item.comment_id),
    source: normalizeOptional(item.source),
    recordType: normalizeOptional(item.action),
    recordTitle: title,
  }
}

function appendLegacyMoltbookHistory(entry: SocialPostHistoryEntry): void {
  const filePath = getLegacyMoltbookHistoryFilePath()
  const rawItems = loadRawLegacyMoltbookItems()
  const exists = rawItems.some((item) => {
    const samePostId = entry.postId && normalizeOptional(item.post_id || item.remote_id) === entry.postId
    const sameFingerprint = computeSocialPostFingerprintForPayload("moltbook", item.text || "", item.title || undefined) === entry.fingerprint
    const sameMinute = Math.abs(Date.parse(item.created_at || "") - entry.publishedAt) < 60_000
    return Boolean(samePostId || (sameFingerprint && sameMinute))
  })

  if (exists) return

  rawItems.push({
    action: "new_post",
    title: entry.title,
    text: entry.text,
    author: "agentrune",
    post_id: entry.postId,
    remote_id: entry.postId,
    created_at: new Date(entry.publishedAt).toISOString(),
    source: entry.source || "agentrune",
  })

  mkdirSync(getConfigDir(), { recursive: true })
  const payload = { version: 1, items: rawItems.slice(-1000) }
  const tmpPath = `${filePath}.${process.pid}.tmp`
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf-8")
  renameSync(tmpPath, filePath)
}

function loadRawLegacyMoltbookItems(): LegacyMoltbookItem[] {
  const filePath = getLegacyMoltbookHistoryFilePath()
  if (!existsSync(filePath)) return []

  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw) as { items?: LegacyMoltbookItem[] }
    return Array.isArray(parsed.items) ? parsed.items : []
  } catch {
    return []
  }
}

function dedupeHistoryEntries(entries: SocialPostHistoryEntry[]): SocialPostHistoryEntry[] {
  const seen = new Set<string>()
  const result: SocialPostHistoryEntry[] = []

  for (const entry of entries.sort((a, b) => b.publishedAt - a.publishedAt)) {
    const key = `${entry.platform}:${entry.postId || entry.fingerprint}:${Math.floor(entry.publishedAt / 60_000)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(entry)
  }

  return result
}

function pruneCooldowns(
  entries: SocialPublishCooldownEntry[],
  now = Date.now(),
): SocialPublishCooldownEntry[] {
  return sanitizeCooldowns(entries)
    .filter((entry) => entry.expiresAt > now)
}

function sanitizeCooldowns(entries: SocialPublishCooldownEntry[]): SocialPublishCooldownEntry[] {
  return entries
    .filter((entry) => Number.isFinite(entry.createdAt) && Number.isFinite(entry.expiresAt))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_COOLDOWNS)
}

function isValidHistoryEntry(value: unknown): value is SocialPostHistoryEntry {
  if (!value || typeof value !== "object") return false
  const entry = value as Partial<SocialPostHistoryEntry>
  return (
    typeof entry.platform === "string" &&
    typeof entry.text === "string" &&
    typeof entry.normalizedText === "string" &&
    typeof entry.fingerprint === "string" &&
    typeof entry.publishedAt === "number"
  )
}

function isValidCooldownEntry(value: unknown): value is SocialPublishCooldownEntry {
  if (!value || typeof value !== "object") return false
  const entry = value as Partial<SocialPublishCooldownEntry>
  return (
    typeof entry.platform === "string" &&
    typeof entry.reason === "string" &&
    typeof entry.createdAt === "number" &&
    typeof entry.expiresAt === "number"
  )
}

function normalizeOptional(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function buildExcerpt(entry: SocialPostHistoryEntry): string {
  const compact = composeSocialPostBody(entry.platform, entry.text, entry.title).replace(/\s+/g, " ").trim()
  if (compact.length <= MAX_EXCERPT_LENGTH) return compact
  return `${compact.slice(0, MAX_EXCERPT_LENGTH - 3)}...`
}

function formatPromptTimestamp(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp))
  } catch {
    return new Date(timestamp).toISOString()
  }
}

function platformLabel(platform: SocialPlatform): string {
  if (platform === "threads") return "Threads"
  if (platform === "moltbook") return "Moltbook"
  return platform
}
