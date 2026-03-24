import crypto from "node:crypto"
import { loadConfig } from "../shared/config.js"
import { log } from "../shared/logger.js"
import { loadNamedVaultSecrets } from "./vault-keys.js"
import type { SocialPlatform } from "./social-types.js"

export type SocialPublishPlatform = SocialPlatform

export interface SocialPublishRequest {
  platform: SocialPublishPlatform
  text: string
  title?: string
  submolt?: string
  source?: string
  reason?: string
}

export interface SocialPublishResult {
  success: boolean
  platform: SocialPublishPlatform
  postId?: string
  error?: string
  statusCode?: number
  retryAfterMs?: number
  cooldownMs?: number
  cooldownReason?: string
}

const THREADS_MAX_LENGTH = 500
const MOLTBOOK_BASE_URL = "https://www.moltbook.com"
const X_API_URL = "https://api.twitter.com/2/tweets"
const X_THREAD_DELAY_MS = 3000
const X_CTA_DELAY_MS = 10000
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000
const DEFAULT_TEMP_FAILURE_COOLDOWN_MS = 10 * 60 * 1000

const ARTICLE_STOPWORDS = new Set(["a", "an"])
const SINGLE_NUMBER_NEUTRAL_WORDS = new Set(["what", "is", "the", "please", "give", "me", "just", "value"])
const SINGLE_NUMBER_CONTEXT_KEYWORDS = new Set([
  "answer",
  "code",
  "digit",
  "enter",
  "equals",
  "equal",
  "result",
  "solve",
  "sum",
  "plus",
  "minus",
  "subtract",
  "times",
  "multiply",
  "multiplied",
  "divide",
  "divided",
  "double",
  "doubles",
  "doubling",
  "doubled",
  "twice",
  "triple",
  "triples",
  "tripling",
  "tripled",
  "half",
  "halves",
  "halved",
  "halving",
])
const PLUS_KEYWORDS = new Set(["plus", "add", "added", "sum"])
const MINUS_KEYWORDS = new Set(["minus", "subtract", "subtracted", "less", "from"])
const TIMES_KEYWORDS = new Set(["times", "multiply", "multiplied", "product"])
const DIVIDE_KEYWORDS = new Set(["divide", "divided", "over"])
const WORD_TO_NUM: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
}

const TENS_VALUES = new Set([20, 30, 40, 50, 60, 70, 80, 90])
const DOUBLE_KEYWORDS = new Set(["doubling", "doubled", "double", "doubles", "twice", "two-fold", "twofold"])
const TRIPLE_KEYWORDS = new Set(["tripling", "tripled", "triple", "three-fold", "threefold"])
const HALF_KEYWORDS = new Set(["halving", "halved", "half", "halves"])
const NUMBER_WORDS = Object.keys(WORD_TO_NUM)

export async function publishSocialPost(request: SocialPublishRequest): Promise<SocialPublishResult> {
  if (request.platform === "threads") {
    return publishThreadsPost(request)
  }

  if (request.platform === "moltbook") {
    return publishMoltbookPost(request)
  }

  if (request.platform === "x") {
    return publishXPost(request)
  }

  return {
    success: false,
    platform: request.platform,
    error: "Unsupported social platform",
  }
}

function validateText(platform: SocialPublishPlatform, text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return "Post text is empty"
  if (platform === "threads" && trimmed.length > THREADS_MAX_LENGTH) {
    return `Threads post exceeds ${THREADS_MAX_LENGTH} characters`
  }
  return null
}

function validateMoltbookPost(title: string, text: string): string | null {
  if (!title.trim()) return "Moltbook post title is empty"
  return validateText("moltbook", text)
}

async function publishThreadsPost(request: SocialPublishRequest): Promise<SocialPublishResult> {
  const error = validateText("threads", request.text)
  if (error) {
    return { success: false, platform: "threads", error }
  }

  const cfg = loadConfig()
  const secrets = loadNamedVaultSecrets({
    vaultPath: cfg.vaultPath,
    keyVaultPath: cfg.keyVaultPath,
  }, ["THREADS_USER_ID", "THREADS_ACCESS_TOKEN"])

  const userId = secrets.THREADS_USER_ID?.trim()
  const accessToken = secrets.THREADS_ACCESS_TOKEN?.trim()
  if (!userId || !accessToken) {
    return { success: false, platform: "threads", error: "Threads credentials not available in key vault" }
  }

  const createRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "TEXT",
      text: request.text.trim(),
      access_token: accessToken,
    }),
  })

  const createData = await safeJson(createRes)
  if (!createRes.ok || createData.error) {
    return buildApiFailure("threads", createRes.status, createData, createRes.headers)
  }

  const creationId = typeof createData.id === "string" ? createData.id : ""
  if (!creationId) {
    return { success: false, platform: "threads", error: "Threads container id missing" }
  }

  await new Promise((resolve) => setTimeout(resolve, 2500))

  const publishRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: creationId,
      access_token: accessToken,
    }),
  })

  const publishData = await safeJson(publishRes)
  if (!publishRes.ok || publishData.error) {
    return buildApiFailure("threads", publishRes.status, publishData, publishRes.headers)
  }

  const postId = typeof publishData.id === "string" ? publishData.id : ""
  if (!postId) {
    return { success: false, platform: "threads", error: "Threads publish response missing post id" }
  }

  return {
    success: true,
    platform: "threads",
    postId,
  }
}

async function publishMoltbookPost(request: SocialPublishRequest): Promise<SocialPublishResult> {
  const title = request.title?.trim() || ""
  const error = validateMoltbookPost(title, request.text)
  if (error) {
    return { success: false, platform: "moltbook", error }
  }

  const cfg = loadConfig()
  const secrets = loadNamedVaultSecrets({
    vaultPath: cfg.vaultPath,
    keyVaultPath: cfg.keyVaultPath,
  }, ["MOLTBOOK_API_KEY"])

  const apiKey = secrets.MOLTBOOK_API_KEY?.trim()
  if (!apiKey) {
    return { success: false, platform: "moltbook", error: "Moltbook credentials not available in key vault" }
  }

  const createRes = await fetch(`${MOLTBOOK_BASE_URL}/api/v1/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      content: request.text.trim(),
      submolt: request.submolt?.trim() || "general",
    }),
  })

  const createData = await safeJson(createRes)
  if (!createRes.ok) {
    return buildApiFailure("moltbook", createRes.status, createData, createRes.headers)
  }

  const postId = extractMoltbookPostId(createData)
  if (!postId) {
    return { success: false, platform: "moltbook", error: "Moltbook publish response missing post id" }
  }

  const verification = extractMoltbookVerification(createData)
  if (!verification) {
    return { success: true, platform: "moltbook", postId }
  }

  const verificationCode = readString(verification.verification_code) || readString(verification.code)
  const challengeText = readString(verification.challenge_text) || readString(verification.challenge)
  const answer = solveMoltbookChallenge(challengeText)

  log.info(`[Moltbook] verification challenge: "${challengeText}" → answer: "${answer}"`)

  if (!verificationCode || !answer) {
    log.warn(`[Moltbook] could not solve challenge: code=${!!verificationCode} answer=${!!answer}`)
    return { success: false, platform: "moltbook", error: "Moltbook verification challenge could not be solved" }
  }

  const verifyRes = await fetch(`${MOLTBOOK_BASE_URL}/api/v1/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      verification_code: verificationCode,
      answer,
    }),
  })

  const verifyData = await safeJson(verifyRes)
  const verified = verifyRes.ok && verifyData?.success === true
  if (!verified) {
    log.warn(`[Moltbook] verification failed: status=${verifyRes.status} data=${JSON.stringify(verifyData)}`)
    return buildApiFailure("moltbook", verifyRes.status, verifyData, verifyRes.headers)
  }

  return { success: true, platform: "moltbook", postId }
}

// ── Moltbook CTA self-reply ──

export interface MoltbookCommentResult {
  success: boolean
  commentId?: string
  error?: string
}

const CTA_VARIANTS = [
  "If you want to explore these ideas hands-on: AgentLore is our AI-verified knowledge base with 23 MCP tools — https://agentlore.vercel.app/en/get-started\n\nAgentRune is the open-source mobile controller for AI coding agents — https://github.com/Kujirafu/AgentRune",
  "Want to try this? AgentLore gives your agents a verified knowledge base via MCP — https://agentlore.vercel.app/en/get-started\n\nAgentRune lets you control coding agents from your phone (open source) — https://github.com/Kujirafu/AgentRune",
  "Curious to try it yourself? AgentLore is the knowledge layer — 23 MCP tools, confidence-scored entries: https://agentlore.vercel.app/en/get-started\n\nAgentRune is the control layer — run and manage agents from your phone: https://github.com/Kujirafu/AgentRune",
  "If this resonates, you can try the tools behind it: AgentLore (AI-verified knowledge base, MCP server) — https://agentlore.vercel.app/en/get-started\n\nAgentRune (open-source agent controller for mobile) — https://github.com/Kujirafu/AgentRune",
  "For anyone who wants to dig deeper: AgentLore is our MCP-powered knowledge base for agents — https://agentlore.vercel.app/en/get-started\n\nAgentRune is the open-source mobile app for controlling AI coding agents — https://github.com/Kujirafu/AgentRune",
]

export function pickCtaVariant(): string {
  return CTA_VARIANTS[Math.floor(Math.random() * CTA_VARIANTS.length)]
}

export async function postMoltbookComment(postId: string, content: string): Promise<MoltbookCommentResult> {
  const cfg = loadConfig()
  const secrets = loadNamedVaultSecrets({
    vaultPath: cfg.vaultPath,
    keyVaultPath: cfg.keyVaultPath,
  }, ["MOLTBOOK_API_KEY"])

  const apiKey = secrets.MOLTBOOK_API_KEY?.trim()
  if (!apiKey) {
    return { success: false, error: "Moltbook credentials not available" }
  }

  const res = await fetch(`${MOLTBOOK_BASE_URL}/api/v1/posts/${postId}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: content.trim() }),
  })

  const data = await safeJson(res)
  if (!res.ok || !data.success) {
    return { success: false, error: formatApiError(res.status, data) }
  }

  const commentId = data.comment?.id
  return { success: true, ...(commentId ? { commentId } : {}) }
}

// ── X/Twitter OAuth 1.0a ──

function percentEncodeOAuth(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function generateXOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  accessSecret: string,
): string {
  const sortedKeys = Object.keys(params).sort()
  const paramString = sortedKeys.map((k) => `${percentEncodeOAuth(k)}=${percentEncodeOAuth(params[k])}`).join("&")
  const baseString = `${method}&${percentEncodeOAuth(url)}&${percentEncodeOAuth(paramString)}`
  const signingKey = `${percentEncodeOAuth(consumerSecret)}&${percentEncodeOAuth(accessSecret)}`
  return crypto.createHmac("sha1", signingKey).update(baseString).digest("base64")
}

function buildXAuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessSecret: string,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  }
  oauthParams.oauth_signature = generateXOAuthSignature(method, url, oauthParams, consumerSecret, accessSecret)
  const header = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncodeOAuth(k)}="${percentEncodeOAuth(oauthParams[k])}"`)
    .join(", ")
  return `OAuth ${header}`
}

// ── X/Twitter publishing ──

async function publishXPost(request: SocialPublishRequest): Promise<SocialPublishResult> {
  const cfg = loadConfig()
  const secrets = loadNamedVaultSecrets({
    vaultPath: cfg.vaultPath,
    keyVaultPath: cfg.keyVaultPath,
  }, ["X_CONSUMER_KEY", "X_CONSUMER_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"])

  const consumerKey = secrets.X_CONSUMER_KEY?.trim()
  const consumerSecret = secrets.X_CONSUMER_SECRET?.trim()
  const accessToken = secrets.X_ACCESS_TOKEN?.trim()
  const accessSecret = secrets.X_ACCESS_SECRET?.trim()
  if (!consumerKey || !consumerSecret || !accessToken || !accessSecret) {
    return { success: false, platform: "x", error: "X/Twitter credentials not available in key vault" }
  }

  const segments = request.text.split("\n---\n").map((s) => s.trim()).filter(Boolean)
  if (segments.length === 0) {
    return { success: false, platform: "x", error: "Post text is empty" }
  }

  const tooLong = segments.findIndex((s) => s.length > 280)
  if (tooLong >= 0) {
    return { success: false, platform: "x", error: `Tweet segment ${tooLong + 1} exceeds 280 characters (${segments[tooLong].length})` }
  }

  // Post first tweet
  const firstRes = await fetch(X_API_URL, {
    method: "POST",
    headers: {
      Authorization: buildXAuthHeader("POST", X_API_URL, consumerKey, consumerSecret, accessToken, accessSecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: segments[0] }),
  })

  const firstData = await safeJson(firstRes)
  if (!firstRes.ok) {
    return buildApiFailure("x", firstRes.status, firstData, firstRes.headers)
  }

  const firstTweetId = firstData?.data?.id
  if (!firstTweetId) {
    return { success: false, platform: "x", error: "X/Twitter publish response missing tweet id" }
  }

  // If single tweet, return immediately
  if (segments.length === 1) {
    return { success: true, platform: "x", postId: firstTweetId }
  }

  // Post thread — reply each segment to the previous one
  let previousId = firstTweetId
  for (let i = 1; i < segments.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, X_THREAD_DELAY_MS))

    const replyRes = await fetch(X_API_URL, {
      method: "POST",
      headers: {
        Authorization: buildXAuthHeader("POST", X_API_URL, consumerKey, consumerSecret, accessToken, accessSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: segments[i],
        reply: { in_reply_to_tweet_id: previousId },
      }),
    })

    const replyData = await safeJson(replyRes)
    if (!replyRes.ok) {
      log.warn(`[X] Thread segment ${i + 1} failed: ${replyRes.status} ${JSON.stringify(replyData)}`)
      return {
        success: true,
        platform: "x",
        postId: firstTweetId,
        error: `Thread partially posted (${i}/${segments.length} segments). Segment ${i + 1} failed: ${replyRes.status}`,
      }
    }

    previousId = replyData?.data?.id || previousId
  }

  return { success: true, platform: "x", postId: firstTweetId }
}

export async function postXSelfReply(
  tweetId: string,
  text: string,
): Promise<{ success: boolean; tweetId?: string; error?: string }> {
  const cfg = loadConfig()
  const secrets = loadNamedVaultSecrets({
    vaultPath: cfg.vaultPath,
    keyVaultPath: cfg.keyVaultPath,
  }, ["X_CONSUMER_KEY", "X_CONSUMER_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"])

  const consumerKey = secrets.X_CONSUMER_KEY?.trim()
  const consumerSecret = secrets.X_CONSUMER_SECRET?.trim()
  const accessToken = secrets.X_ACCESS_TOKEN?.trim()
  const accessSecret = secrets.X_ACCESS_SECRET?.trim()
  if (!consumerKey || !consumerSecret || !accessToken || !accessSecret) {
    return { success: false, error: "X/Twitter credentials not available" }
  }

  const res = await fetch(X_API_URL, {
    method: "POST",
    headers: {
      Authorization: buildXAuthHeader("POST", X_API_URL, consumerKey, consumerSecret, accessToken, accessSecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: text.trim(),
      reply: { in_reply_to_tweet_id: tweetId },
    }),
  })

  const data = await safeJson(res)
  if (!res.ok) {
    return { success: false, error: formatApiError(res.status, data) }
  }

  const replyTweetId = data?.data?.id
  return { success: true, ...(replyTweetId ? { tweetId: replyTweetId } : {}) }
}

// ── X CTA variants ──

const X_CTA_VARIANTS = [
  "We built the tools behind these ideas:\n\nAgentLore — AI knowledge base, 23 MCP tools\nhttps://agentlore.vercel.app/en/get-started\n\nAgentRune — open-source agent controller\nhttps://github.com/Kujirafu/AgentRune",
  "If you want to try this yourself:\n\nAgentLore (MCP knowledge base): https://agentlore.vercel.app/en/get-started\nAgentRune (mobile agent control): https://github.com/Kujirafu/AgentRune",
  "Tools we built for this:\n\nAgentLore — verified knowledge base for AI agents\nhttps://agentlore.vercel.app/en/get-started\n\nAgentRune — control coding agents from your phone\nhttps://github.com/Kujirafu/AgentRune",
  "Want to dig deeper?\n\nAgentLore: https://agentlore.vercel.app/en/get-started\n(AI-verified knowledge, MCP server)\n\nAgentRune: https://github.com/Kujirafu/AgentRune\n(open-source, manage agents from mobile)",
  "Built with:\n\nAgentLore — knowledge layer for AI agents (23 MCP tools)\nhttps://agentlore.vercel.app/en/get-started\n\nAgentRune — agent controller for mobile (AGPL-3.0)\nhttps://github.com/Kujirafu/AgentRune",
]

export function pickXCtaVariant(): string {
  return X_CTA_VARIANTS[Math.floor(Math.random() * X_CTA_VARIANTS.length)]
}

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

function formatApiError(status: number, payload: any): string {
  const message = payload?.error?.message
    || payload?.error
    || payload?.message
    || "Unknown social API error"
  // Truncate to avoid leaking verbose API internals into client-facing output
  const safeMessage = typeof message === "string" ? message.slice(0, 200) : String(message).slice(0, 200)
  return `${status}: ${safeMessage}`
}

function buildApiFailure(
  platform: SocialPublishPlatform,
  status: number,
  payload: any,
  headers?: { get(name: string): string | null },
): SocialPublishResult {
  const retryAfterMs = parseRetryAfterMs(headers)
  const cooldown = inferCooldown(status, payload, retryAfterMs)

  return {
    success: false,
    platform,
    error: formatApiError(status, payload),
    statusCode: status,
    ...(typeof retryAfterMs === "number" ? { retryAfterMs } : {}),
    ...(cooldown ? {
      cooldownMs: cooldown.cooldownMs,
      cooldownReason: cooldown.reason,
    } : {}),
  }
}

function inferCooldown(
  status: number,
  payload: any,
  retryAfterMs?: number,
): { cooldownMs: number; reason: string } | null {
  if (typeof retryAfterMs === "number" && retryAfterMs > 0) {
    return {
      cooldownMs: retryAfterMs,
      reason: "API returned Retry-After backoff",
    }
  }

  const message = `${payload?.error?.message || payload?.error || payload?.message || ""}`.toLowerCase()
  const looksRateLimited = /rate.?limit|too many|cooldown|retry later|quota/.test(message)
  const looksTemporary = /temporar|unavailable|timeout|overload|busy|try again/.test(message)

  if (status === 429 || ((status === 403 || status === 409) && looksRateLimited)) {
    return {
      cooldownMs: DEFAULT_RATE_LIMIT_COOLDOWN_MS,
      reason: "API rate limit or cooldown detected",
    }
  }

  if ([502, 503, 504].includes(status) || (status >= 500 && looksTemporary)) {
    return {
      cooldownMs: DEFAULT_TEMP_FAILURE_COOLDOWN_MS,
      reason: "Temporary API failure detected",
    }
  }

  return null
}

function parseRetryAfterMs(headers?: { get(name: string): string | null }): number | undefined {
  const raw = headers?.get("Retry-After") || headers?.get("retry-after")
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined

  if (/^\d+$/.test(trimmed)) {
    return Math.max(1, Number(trimmed)) * 1000
  }

  const retryAt = Date.parse(trimmed)
  if (Number.isNaN(retryAt)) return undefined
  return Math.max(1, retryAt - Date.now())
}

function extractMoltbookPostId(payload: any): string {
  return readString(payload?.post?.id) || readString(payload?.id) || ""
}

function extractMoltbookVerification(payload: any): Record<string, unknown> | null {
  const value = payload?.post?.verification ?? payload?.verification
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function solveMoltbookChallenge(text: string | null | undefined): string | null {
  if (!text) return null

  const tokens = tokenizeChallenge(text)
  if (tokens.length === 0) return null

  for (const keyword of DOUBLE_KEYWORDS) {
    const idx = tokens.indexOf(keyword)
    if (idx >= 0) {
      const nearby = findNearbyNumber(tokens, idx)
      if (nearby !== null && nearby > 0) return formatSolvedNumber(nearby * 2)
    }
  }

  for (const keyword of TRIPLE_KEYWORDS) {
    const idx = tokens.indexOf(keyword)
    if (idx >= 0) {
      const nearby = findNearbyNumber(tokens, idx)
      if (nearby !== null && nearby > 0) return formatSolvedNumber(nearby * 3)
    }
  }

  for (const keyword of HALF_KEYWORDS) {
    const idx = tokens.indexOf(keyword)
    if (idx >= 0) {
      const nearby = findNearbyNumber(tokens, idx)
      if (nearby !== null && nearby > 0) return formatSolvedNumber(nearby / 2)
    }
  }

  const numbers: number[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const current = matchSingleToken(tokens[i])
    if (current === null) continue

    if (TENS_VALUES.has(current) && i + 1 < tokens.length) {
      const next = matchSingleToken(tokens[i + 1])
      if (next !== null && next >= 1 && next <= 9) {
        numbers.push(current + next)
        i += 1
        continue
      }
    }

    numbers.push(current)
  }

  const uniqueNumbers = dedupeRepeated(numbers)
  if (uniqueNumbers.length === 0) return null
  if (uniqueNumbers.length === 1 && shouldRejectSingleNumber(tokens)) return null
  if (uniqueNumbers.length === 1) return formatSolvedNumber(uniqueNumbers[0])

  if (uniqueNumbers.length === 2) {
    const op = detectOperator(tokens)
    const [a, b] = uniqueNumbers
    switch (op) {
      case "subtract": return formatSolvedNumber(a - b)
      case "multiply": return formatSolvedNumber(a * b)
      case "divide": return b !== 0 ? formatSolvedNumber(a / b) : null
      default: return formatSolvedNumber(a + b)
    }
  }

  return formatSolvedNumber(uniqueNumbers.reduce((sum, value) => sum + value, 0))
}

function tokenizeChallenge(text: string): string[] {
  const cleaned = smartClean(text)
  const tokens = cleaned.split(" ").filter(Boolean)
  return mergeSplitNumberTokens(tokens)
}

type MathOperator = "add" | "subtract" | "multiply" | "divide"

function detectOperator(tokens: string[]): MathOperator {
  for (const token of tokens) {
    if (MINUS_KEYWORDS.has(token)) return "subtract"
    if (TIMES_KEYWORDS.has(token)) return "multiply"
    if (DIVIDE_KEYWORDS.has(token)) return "divide"
    if (PLUS_KEYWORDS.has(token)) return "add"
  }
  return "add"
}

function smartClean(text: string): string {
  return text
    .replace(/(?<=[a-zA-Z])[^a-zA-Z0-9 ]+(?=[a-zA-Z])/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function findNearbyNumber(tokens: string[], index: number): number | null {
  const start = Math.max(0, index - 3)
  const end = Math.min(tokens.length - 1, index + 3)
  for (let i = start; i <= end; i += 1) {
    const value = matchSingleToken(tokens[i])
    if (value !== null) return value
  }
  return null
}

function matchSingleToken(token: string, opts: { allowFuzzy?: boolean } = {}): number | null {
  const allowFuzzy = opts.allowFuzzy !== false
  if (!token || ARTICLE_STOPWORDS.has(token)) return null
  if (token in WORD_TO_NUM) return WORD_TO_NUM[token]
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token)

  const collapsed = collapseRepeats(token)
  if (collapsed in WORD_TO_NUM) return WORD_TO_NUM[collapsed]
  if (/^\d+(\.\d+)?$/.test(collapsed)) return Number(collapsed)

  if (!allowFuzzy) return null

  const fuzzy = getClosestNumberWord(token)
  if (fuzzy) return WORD_TO_NUM[fuzzy]

  const fuzzyCollapsed = getClosestNumberWord(collapsed)
  if (fuzzyCollapsed) return WORD_TO_NUM[fuzzyCollapsed]

  return null
}

function mergeSplitNumberTokens(tokens: string[]): string[] {
  const merged: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    let bestMatch: { value: string; nextIndex: number } | null = null
    let combined = ""

    for (let j = i; j < Math.min(tokens.length, i + 6); j += 1) {
      const part = tokens[j]
      if (!/^[a-z]+$/.test(part)) break
      combined += part
      if (combined.length > 14) break
      const resolved = resolveMergedNumberToken(combined)
      if (resolved) {
        bestMatch = { value: resolved, nextIndex: j + 1 }
      }
    }

    if (bestMatch && bestMatch.nextIndex > i + 1) {
      merged.push(bestMatch.value)
      i = bestMatch.nextIndex - 1
      continue
    }

    merged.push(tokens[i])
  }
  return merged
}

function resolveMergedNumberToken(token: string): string | null {
  if (token in WORD_TO_NUM) return token
  const collapsed = collapseRepeats(token)
  if (collapsed in WORD_TO_NUM) return collapsed
  const fuzzy = getClosestNumberWord(token)
  if (fuzzy && isSafeFuzzyCandidate(token, fuzzy)) return fuzzy
  const fuzzyCollapsed = getClosestNumberWord(collapsed)
  if (fuzzyCollapsed && isSafeFuzzyCandidate(collapsed, fuzzyCollapsed)) return fuzzyCollapsed
  return null
}

function collapseRepeats(token: string): string {
  let result = ""
  let previous = ""
  for (const char of token) {
    if (char !== previous) {
      result += char
      previous = char
    }
  }
  return result
}

function getClosestNumberWord(token: string): string | null {
  let bestWord: string | null = null
  let bestScore = 0

  for (const candidate of NUMBER_WORDS) {
    const score = diceCoefficient(token, candidate)
    if (score > bestScore) {
      bestScore = score
      bestWord = candidate
    }
  }

  return bestScore >= 0.85 ? bestWord : null
}

function isSafeFuzzyCandidate(token: string, candidate: string): boolean {
  if (token === candidate) return true
  if (!token || !candidate) return false
  if (token[0] !== candidate[0]) return false
  if (Math.abs(token.length - candidate.length) > 1) return false
  return levenshteinDistance(token, candidate) <= 1
}

function diceCoefficient(left: string, right: string): number {
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0

  const leftBigrams = buildBigrams(left)
  const rightBigrams = buildBigrams(right)
  const counts = new Map<string, number>()

  for (const value of leftBigrams) {
    counts.set(value, (counts.get(value) || 0) + 1)
  }

  let overlap = 0
  for (const value of rightBigrams) {
    const remaining = counts.get(value) || 0
    if (remaining > 0) {
      overlap += 1
      counts.set(value, remaining - 1)
    }
  }

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length)
}

function buildBigrams(token: string): string[] {
  const result: string[] = []
  for (let i = 0; i < token.length - 1; i += 1) {
    result.push(token.slice(i, i + 2))
  }
  return result
}

function levenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1
  const cols = right.length + 1
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0))

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }

  return matrix[left.length][right.length]
}

function shouldRejectSingleNumber(tokens: string[]): boolean {
  if (tokens.some((token) => SINGLE_NUMBER_CONTEXT_KEYWORDS.has(token))) return false
  const lexicalNoise = tokens.filter((token) =>
    /^[a-z]+$/.test(token)
    && !SINGLE_NUMBER_NEUTRAL_WORDS.has(token)
    && matchSingleToken(token, { allowFuzzy: false }) === null
  )
  return lexicalNoise.some((token) => token.length > 3)
}

function dedupeRepeated(values: number[]): number[] {
  const result: number[] = []
  for (const value of values) {
    if (!result.includes(value)) result.push(value)
  }
  return result
}

function formatSolvedNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}
