const DEFAULT_MIN_REVIEW_MS = 4000
const DEFAULT_MAX_REVIEW_MS = 120_000
const WORDS_PER_MINUTE = 220

export interface ReviewDecisionTelemetry {
  decisionLatencyMs: number
  estimatedReviewMs: number
  belowReviewFloor: boolean
  reviewNote?: string
  reviewNoteProvided: boolean
}

export function estimateReviewMsFromText(
  text: string,
  opts?: { minMs?: number; maxMs?: number },
): number {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return opts?.minMs ?? DEFAULT_MIN_REVIEW_MS

  const words = normalized.split(" ").filter(Boolean).length
  const estimated = Math.round((words / WORDS_PER_MINUTE) * 60_000)
  const minMs = opts?.minMs ?? DEFAULT_MIN_REVIEW_MS
  const maxMs = opts?.maxMs ?? DEFAULT_MAX_REVIEW_MS
  return Math.max(minMs, Math.min(maxMs, estimated || minMs))
}

export function estimatePhaseGateReviewMs(
  phaseResults: Array<{ roleName?: string; outputSummary?: string }>,
): number {
  const combined = phaseResults
    .map((item) => [item.roleName || "", item.outputSummary || ""].filter(Boolean).join(": "))
    .join("\n")
  return estimateReviewMsFromText(combined, { minMs: 6000, maxMs: 180_000 })
}

export function estimateReauthReviewMs(permissionKey: string, violationDescription: string): number {
  const combined = [permissionKey, violationDescription].filter(Boolean).join("\n")
  return estimateReviewMsFromText(combined, { minMs: 5000, maxMs: 45_000 })
}

export function summarizeReviewDecision(params: {
  requestedAt: number
  resolvedAt?: number
  estimatedReviewMs?: number
  reviewNote?: string
}): ReviewDecisionTelemetry {
  const resolvedAt = params.resolvedAt ?? Date.now()
  const decisionLatencyMs = Math.max(0, resolvedAt - params.requestedAt)
  const estimatedReviewMs = Math.max(0, params.estimatedReviewMs ?? 0)
  const reviewNote = normalizeOptionalString(params.reviewNote)
  return {
    decisionLatencyMs,
    estimatedReviewMs,
    belowReviewFloor: estimatedReviewMs > 0 && decisionLatencyMs < estimatedReviewMs,
    ...(reviewNote ? { reviewNote } : {}),
    reviewNoteProvided: Boolean(reviewNote),
  }
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}
