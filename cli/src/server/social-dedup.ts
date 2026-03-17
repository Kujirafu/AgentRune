import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getConfigDir } from "../shared/config.js"
import type { SocialPublishPlatform } from "./social-publisher.js"

const HISTORY_FILE = "social-post-history.json"
const HISTORY_VERSION = 1
const MAX_ENTRIES_PER_PLATFORM = 200
const DEFAULT_DUPLICATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_PROMPT_LIMIT = 5
const MAX_EXCERPT_LENGTH = 140

interface SocialPostHistoryStore {
  version: number
  posts: SocialPostHistoryEntry[]
}

export interface SocialPostHistoryEntry {
  platform: SocialPublishPlatform
  text: string
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
  platform: SocialPublishPlatform
  text: string
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
  platform: SocialPublishPlatform
  text: string
  now?: number
  withinMs?: number
}

export interface SocialDuplicateMatch extends SocialPostHistoryEntry {
  ageMs: number
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
  const normalized = normalizeSocialPostText(request.text)
  if (!normalized) return null

  const now = request.now ?? Date.now()
  const withinMs = request.withinMs ?? DEFAULT_DUPLICATE_WINDOW_MS
  const fingerprint = computeSocialPostFingerprint(request.text)

  for (const entry of loadHistory().posts) {
    if (entry.platform !== request.platform) continue
    const ageMs = now - entry.publishedAt
    if (ageMs < 0 || ageMs > withinMs) continue
    if (entry.fingerprint !== fingerprint) continue
    return { ...entry, ageMs }
  }

  return null
}

export function rememberSocialPost(request: RememberSocialPostRequest): RememberSocialPostResult {
  const text = request.text.trim()
  const normalizedText = normalizeSocialPostText(text)
  if (!normalizedText) {
    return { success: false, stored: false, error: "Cannot store empty social post text" }
  }

  try {
    const publishedAt = request.publishedAt ?? Date.now()
    const fingerprint = computeSocialPostFingerprint(text)
    const store = loadHistory()
    const existing = store.posts.find((entry) =>
      entry.platform === request.platform && (
        (request.postId && entry.postId === request.postId) ||
        (entry.fingerprint === fingerprint && Math.abs(entry.publishedAt - publishedAt) < 60_000)
      )
    )

    if (existing) {
      return { success: true, stored: false, entry: existing }
    }

    const entry: SocialPostHistoryEntry = {
      platform: request.platform,
      text,
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

    saveHistory({
      version: HISTORY_VERSION,
      posts: [...keptPlatformPosts, ...otherPosts].sort((a, b) => b.publishedAt - a.publishedAt),
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

export function buildRecentSocialPostPromptContext(
  platform: SocialPublishPlatform,
  limit = DEFAULT_PROMPT_LIMIT,
): string | null {
  const posts = loadHistory().posts
    .filter((entry) => entry.platform === platform)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, limit)

  if (posts.length === 0) return null

  return [
    `[Recent ${platformLabel(platform)} Posts]`,
    "AgentRune already published these posts recently and will block duplicate or trivially reformatted text.",
    ...posts.map((entry) => {
      const parts = [
        formatPromptTimestamp(entry.publishedAt),
        entry.recordType,
        entry.recordTitle,
      ].filter(Boolean)
      const heading = parts.length > 0 ? parts.join(" | ") : formatPromptTimestamp(entry.publishedAt)
      return `- ${heading}\n  Excerpt: ${buildExcerpt(entry.text)}`
    }),
    "If your best candidate is materially the same as one of the above, emit the skip marker instead of the post marker.",
  ].join("\n")
}

export function formatSocialDuplicateMatch(match: SocialDuplicateMatch): string {
  const parts = [
    formatPromptTimestamp(match.publishedAt),
    match.recordType,
    match.recordTitle,
    match.postId ? `post ${match.postId}` : undefined,
  ].filter(Boolean)

  return parts.join(" | ") || formatPromptTimestamp(match.publishedAt)
}

function loadHistory(): SocialPostHistoryStore {
  const filePath = getHistoryFilePath()
  if (!existsSync(filePath)) {
    return { version: HISTORY_VERSION, posts: [] }
  }

  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw) as Partial<SocialPostHistoryStore>
    const posts = Array.isArray(parsed.posts) ? parsed.posts.filter(isValidHistoryEntry) : []
    return {
      version: typeof parsed.version === "number" ? parsed.version : HISTORY_VERSION,
      posts,
    }
  } catch {
    return { version: HISTORY_VERSION, posts: [] }
  }
}

function saveHistory(store: SocialPostHistoryStore): void {
  const filePath = getHistoryFilePath()
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

function getHistoryFilePath(): string {
  return join(getConfigDir(), HISTORY_FILE)
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

function normalizeOptional(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function buildExcerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim()
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

function platformLabel(platform: SocialPublishPlatform): string {
  if (platform === "threads") return "Threads"
  return platform
}
