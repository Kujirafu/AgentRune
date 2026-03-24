import { createHash } from "node:crypto"

export interface AutomationBehaviorStateInput {
  command?: string
  prompt?: string
  skill?: string
  templateId?: string
  schedule?: {
    type?: string
    timeOfDay?: string
    weekdays?: number[]
    intervalMinutes?: number
  }
  runMode?: string
  agentId?: string
  locale?: string
  model?: string
  bypass?: boolean
  trustProfile?: string
  sandboxLevel?: string
  requirePlanReview?: boolean
  requireMergeApproval?: boolean
  dailyRunLimit?: number
  planReviewTimeoutMinutes?: number
  timeoutMinutes?: number
  manifest?: unknown
  crew?: unknown
}

export interface AutomationLaunchSnapshot {
  bin: string
  args: string[]
  fullPrompt: string
}

export function computeAutomationBehaviorStateHash(input: AutomationBehaviorStateInput): string {
  const normalized = normalizeBehaviorState(input)
  return hashStableValue(normalized)
}

export function computeAutomationPromptStateHash(fullPrompt: string): string {
  return hashStableValue(fullPrompt.replace(/\s+/g, " ").trim())
}

export function computeAutomationLaunchStateHash(snapshot: AutomationLaunchSnapshot): string {
  return hashStableValue({
    bin: snapshot.bin,
    args: snapshot.args.map(sanitizeLaunchArg),
    promptHash: computeAutomationPromptStateHash(snapshot.fullPrompt),
  })
}

export function validateAutomationLaunchState(
  input: AutomationBehaviorStateInput,
  snapshot: AutomationLaunchSnapshot,
): string[] {
  const issues: string[] = []
  const agentId = input.agentId || "claude"

  if (!snapshot.bin.trim()) {
    issues.push("Launch binary is empty")
  }

  if (agentId === "claude") {
    if (snapshot.bin !== "claude") issues.push(`Expected claude binary, got "${snapshot.bin}"`)
    if (!snapshot.args.includes("-p")) issues.push('Claude launch is missing "-p" prompt flag')
  } else if (agentId === "codex") {
    if (snapshot.bin !== "codex") issues.push(`Expected codex binary, got "${snapshot.bin}"`)
    if (!snapshot.args.includes("--full-auto")) issues.push('Codex launch is missing "--full-auto"')
  } else if (snapshot.bin !== agentId) {
    issues.push(`Expected ${agentId} binary, got "${snapshot.bin}"`)
  }

  if (input.model) {
    const modelIndex = snapshot.args.indexOf("--model")
    if (modelIndex < 0 || snapshot.args[modelIndex + 1] !== input.model) {
      issues.push(`Configured model "${input.model}" did not reach launch args`)
    }
  }

  if (input.skill && !snapshot.fullPrompt.includes(`Use the MCP skill "${input.skill}"`)) {
    issues.push(`Configured skill "${input.skill}" did not reach the runtime prompt`)
  }

  if (input.locale && input.locale !== "en") {
    const localeHints = getLocaleHints(input.locale)
    if (!localeHints.some((hint) => snapshot.fullPrompt.includes(hint))) {
      issues.push(`Configured locale "${input.locale}" did not reach the runtime prompt`)
    }
  }

  return issues
}

function normalizeBehaviorState(input: AutomationBehaviorStateInput): Record<string, unknown> {
  return {
    command: normalizeOptionalString(input.command),
    prompt: normalizeOptionalString(input.prompt),
    skill: normalizeOptionalString(input.skill),
    templateId: normalizeOptionalString(input.templateId),
    schedule: input.schedule ? {
      type: normalizeOptionalString(input.schedule.type),
      timeOfDay: normalizeOptionalString(input.schedule.timeOfDay),
      weekdays: [...(input.schedule.weekdays || [])].sort((a, b) => a - b),
      intervalMinutes: typeof input.schedule.intervalMinutes === "number" ? input.schedule.intervalMinutes : undefined,
    } : undefined,
    runMode: normalizeOptionalString(input.runMode),
    agentId: normalizeOptionalString(input.agentId),
    locale: normalizeOptionalString(input.locale),
    model: normalizeOptionalString(input.model),
    bypass: input.bypass === true,
    trustProfile: normalizeOptionalString(input.trustProfile),
    sandboxLevel: normalizeOptionalString(input.sandboxLevel),
    requirePlanReview: input.requirePlanReview === true,
    requireMergeApproval: input.requireMergeApproval === true,
    dailyRunLimit: typeof input.dailyRunLimit === "number" ? input.dailyRunLimit : undefined,
    planReviewTimeoutMinutes: typeof input.planReviewTimeoutMinutes === "number" ? input.planReviewTimeoutMinutes : undefined,
    timeoutMinutes: typeof input.timeoutMinutes === "number" ? input.timeoutMinutes : undefined,
    manifest: normalizeUnknown(input.manifest),
    crew: normalizeUnknown(input.crew),
  }
}

function normalizeUnknown(value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) return value.map(normalizeUnknown)
  if (typeof value !== "object") return value
  const record = value as Record<string, unknown>
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = normalizeUnknown(record[key])
      return acc
    }, {})
}

function hashStableValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16)
}

function stableStringify(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`

  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
  return `{${entries.join(",")}}`
}

function sanitizeLaunchArg(value: string): string {
  return value
    .replace(/[A-Za-z]:\\[^"' ]*prompt_[^"' ]+\.txt/gi, "<prompt-file>")
    .replace(/\/[^"' ]*prompt_[^"' ]+\.txt/gi, "<prompt-file>")
}

function getLocaleHints(locale: string): string[] {
  switch (locale) {
    case "zh-TW":
      return ["zh-TW", "Traditional Chinese"]
    case "ja":
      return ["ja", "Japanese"]
    case "ko":
      return ["ko", "Korean"]
    default:
      return [locale]
  }
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}
