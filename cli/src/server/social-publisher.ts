import { loadConfig } from "../shared/config.js"
import { loadNamedVaultSecrets } from "./vault-keys.js"

export type SocialPublishPlatform = "threads"

export interface SocialPublishRequest {
  platform: SocialPublishPlatform
  text: string
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

export async function publishSocialPost(request: SocialPublishRequest): Promise<SocialPublishResult> {
  if (request.platform === "threads") {
    return publishThreadsPost(request)
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

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

function formatApiError(status: number, payload: any): string {
  const message = payload?.error?.message || payload?.message || "Unknown social API error"
  return `${status}: ${message}`
}

