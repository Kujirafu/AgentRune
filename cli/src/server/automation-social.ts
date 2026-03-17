import type { SocialPlatform } from "./social-types.js"

export type AutomationSocialPlatform = SocialPlatform

export interface SocialAutomationMode {
  platform: AutomationSocialPlatform
}

export interface SocialPostDirective {
  kind: "post"
  platform: AutomationSocialPlatform
  text: string
  title?: string
  source?: string
  reason?: string
  recordType?: string
  recordTitle?: string
  recordMetrics?: string
  submolt?: string
}

export interface SocialSkipDirective {
  kind: "skip"
  platform: AutomationSocialPlatform
  reason: string
  source?: string
}

export type SocialAutomationDirective = SocialPostDirective | SocialSkipDirective

const SOCIAL_POST_MARKER = "__AGENTRUNE_SOCIAL_POST__"
const SOCIAL_SKIP_MARKER = "__AGENTRUNE_SOCIAL_SKIP__"

const THREADS_HINTS = [
  "threads",
  "graph.threads.net",
]

const MOLTBOOK_HINTS = [
  "moltbook",
  "www.moltbook.com",
  "/api/v1/posts",
  "submolt",
]

export function detectAutomationSocialMode(auto: {
  name?: string
  prompt?: string
  templateId?: string
  skill?: string
}): SocialAutomationMode | null {
  const haystack = [
    auto.name || "",
    auto.prompt || "",
    auto.templateId || "",
    auto.skill || "",
  ].join("\n").toLowerCase()

  if (MOLTBOOK_HINTS.some((hint) => haystack.includes(hint)) || /\bmoltbook\b/i.test(auto.name || "")) {
    return { platform: "moltbook" }
  }

  if (THREADS_HINTS.some((hint) => haystack.includes(hint)) || /\bthreads\b/i.test(auto.name || "")) {
    return { platform: "threads" }
  }

  return null
}

export function buildAutomationSocialInstructions(mode: SocialAutomationMode): string {
  if (mode.platform === "moltbook") {
    return [
      "[AGENTRUNE SOCIAL PUBLISH: Moltbook]",
      "This automation is expected to publish a REAL Moltbook post via AgentRune.",
      "AgentRune daemon will perform the actual API publish after you emit a marker. Network access is NOT required for you.",
      "AgentRune daemon will reject duplicate or trivially reformatted post text, so do not reuse recent copy.",
      "Do NOT tell the user to post manually.",
      "Do NOT print secrets, access tokens, cookies, or raw credentials.",
      "Do NOT call Moltbook APIs directly from the agent.",
      "Produce a final-ready title and body. Do not leave placeholders.",
      "If you were given approved materials, stay inside those materials and do not invent unsupported claims.",
      "",
      "If a post should be published now, end your final output with exactly one line:",
      `${SOCIAL_POST_MARKER} {"platform":"moltbook","title":"<final title>","text":"<final post body>","source":"<notes or materials file>","reason":"<why this post was chosen>","submolt":"general"}`,
      "",
      "If no post should be published now because of cooldown, missing approval, missing material, or another valid precondition, end your final output with exactly one line:",
      `${SOCIAL_SKIP_MARKER} {"platform":"moltbook","reason":"<why no post should be published now>","source":"<notes or materials file>"}`,
      "",
      "Never wrap these marker lines in a code block.",
      "Only emit one marker line total.",
    ].join("\n")
  }

  const platformName = "Threads"
  return [
    `[AGENTRUNE SOCIAL PUBLISH: ${platformName}]`,
    `This automation is expected to publish a REAL ${platformName} post via AgentRune.`,
    "AgentRune daemon will perform the actual API publish after you emit a marker. Network access is NOT required for you.",
    "AgentRune daemon will reject duplicate or trivially reformatted post text, so do not reuse recent copy.",
    "Do NOT tell the user to post manually.",
    "Do NOT print secrets, access tokens, cookies, or raw credentials.",
    `Do NOT call ${platformName} APIs directly from the agent.`,
    "Read the materials library and choose only approved copy.",
    "Use the approved post text exactly as written in the materials library. Do not paraphrase or invent new copy.",
    "Do NOT edit the materials library, publish history, or source notes before AgentRune confirms a successful publish.",
    "If the approved copy would need edits before posting, emit a skip marker instead of rewriting it yourself.",
    "",
    "If a post should be published now, end your final output with exactly one line:",
    `${SOCIAL_POST_MARKER} {"platform":"${mode.platform}","text":"<final post text>","source":"<materials file or section>","reason":"<why this post was chosen>","recordType":"<materials table type>","recordTitle":"<materials table title>","recordMetrics":"-"}`,
    "",
    "If no post should be published now because of cooldown, missing approval, missing material, or another valid precondition, end your final output with exactly one line:",
    `${SOCIAL_SKIP_MARKER} {"platform":"${mode.platform}","reason":"<why no post should be published now>","source":"<materials file or section>"}`,
    "",
    "Never wrap these marker lines in a code block.",
    "Only emit one marker line total.",
  ].join("\n")
}

export function extractAutomationSocialDirective(
  output: string,
  expectedPlatform: AutomationSocialPlatform,
): SocialAutomationDirective | null {
  for (const rawLine of output.split(/\r?\n/).reverse()) {
    const line = rawLine.trim().replace(/^`+|`+$/g, "")
    if (!line) continue

    if (line.startsWith(SOCIAL_POST_MARKER)) {
      const parsed = safeParseDirective(line.slice(SOCIAL_POST_MARKER.length).trim())
      if (!parsed || parsed.platform !== expectedPlatform || typeof parsed.text !== "string") return null
      const text = parsed.text.trim()
      if (!text) return null
      const title = normalizeOptionalString(parsed.title)
      const submolt = normalizeOptionalString(parsed.submolt)
      if (parsed.platform === "moltbook" && !title) return null
      return {
        kind: "post",
        platform: parsed.platform,
        text,
        source: normalizeOptionalString(parsed.source),
        reason: normalizeOptionalString(parsed.reason),
        recordType: normalizeOptionalString(parsed.recordType),
        recordTitle: normalizeOptionalString(parsed.recordTitle),
        recordMetrics: normalizeOptionalString(parsed.recordMetrics),
        ...(title ? { title } : {}),
        ...(submolt ? { submolt } : {}),
      }
    }

    if (line.startsWith(SOCIAL_SKIP_MARKER)) {
      const parsed = safeParseDirective(line.slice(SOCIAL_SKIP_MARKER.length).trim())
      if (!parsed || parsed.platform !== expectedPlatform || typeof parsed.reason !== "string") return null
      const reason = parsed.reason.trim()
      if (!reason) return null
      return {
        kind: "skip",
        platform: parsed.platform,
        reason,
        source: normalizeOptionalString(parsed.source),
      }
    }
  }

  return null
}

export function outputNeedsManualIntervention(output: string): boolean {
  const lower = output.toLowerCase()
  return [
    "copy the text",
    "copy and paste",
    "post manually",
    "sandbox",
    "manual intervention",
  ].some((needle) => lower.includes(needle))
}

function safeParseDirective(raw: string): {
  platform?: AutomationSocialPlatform
  text?: string
  title?: string
  source?: string
  reason?: string
  recordType?: string
  recordTitle?: string
  recordMetrics?: string
  submolt?: string
} | null {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    return parsed as {
      platform?: AutomationSocialPlatform
      text?: string
      title?: string
      source?: string
      reason?: string
      recordType?: string
      recordTitle?: string
      recordMetrics?: string
      submolt?: string
    }
  } catch {
    return null
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}
