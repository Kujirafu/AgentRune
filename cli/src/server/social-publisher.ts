import { loadConfig } from "../shared/config.js"
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
}

const THREADS_MAX_LENGTH = 500
const MOLTBOOK_BASE_URL = "https://www.moltbook.com"

const ARTICLE_STOPWORDS = new Set(["a", "an"])
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
const DOUBLE_KEYWORDS = new Set(["doubling", "doubled", "double", "twice", "two-fold", "twofold"])
const TRIPLE_KEYWORDS = new Set(["tripling", "tripled", "triple", "three-fold", "threefold"])
const HALF_KEYWORDS = new Set(["halving", "halved", "half"])
const NUMBER_WORDS = Object.keys(WORD_TO_NUM)

export async function publishSocialPost(request: SocialPublishRequest): Promise<SocialPublishResult> {
  if (request.platform === "threads") {
    return publishThreadsPost(request)
  }

  if (request.platform === "moltbook") {
    return publishMoltbookPost(request)
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
    return {
      success: false,
      platform: "threads",
      error: formatApiError(createRes.status, createData),
    }
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
    return {
      success: false,
      platform: "threads",
      error: formatApiError(publishRes.status, publishData),
    }
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
    return {
      success: false,
      platform: "moltbook",
      error: formatApiError(createRes.status, createData),
    }
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

  if (!verificationCode || !answer) {
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
    return {
      success: false,
      platform: "moltbook",
      error: formatApiError(verifyRes.status, verifyData),
    }
  }

  return { success: true, platform: "moltbook", postId }
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
  return `${status}: ${message}`
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

  const cleaned = smartClean(text)
  const tokens = cleaned.split(" ").filter(Boolean)
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
  if (uniqueNumbers.length === 1) return formatSolvedNumber(uniqueNumbers[0])
  if (uniqueNumbers.length === 2) return formatSolvedNumber(uniqueNumbers[0] + uniqueNumbers[1])
  return formatSolvedNumber(uniqueNumbers.reduce((sum, value) => sum + value, 0))
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

function matchSingleToken(token: string): number | null {
  if (!token || ARTICLE_STOPWORDS.has(token)) return null
  if (token in WORD_TO_NUM) return WORD_TO_NUM[token]
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token)

  const collapsed = collapseRepeats(token)
  if (collapsed in WORD_TO_NUM) return WORD_TO_NUM[collapsed]
  if (/^\d+(\.\d+)?$/.test(collapsed)) return Number(collapsed)

  const fuzzy = getClosestNumberWord(token)
  if (fuzzy) return WORD_TO_NUM[fuzzy]

  const fuzzyCollapsed = getClosestNumberWord(collapsed)
  if (fuzzyCollapsed) return WORD_TO_NUM[fuzzyCollapsed]

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
