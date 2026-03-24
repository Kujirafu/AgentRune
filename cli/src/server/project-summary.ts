import type { AgentEvent, ProgressReport } from "../shared/types.js"

export type SummaryLocale = "en" | "zh-TW"
export type SessionDigestStatus = "blocked" | "done" | "working" | "idle"
export type SessionDigestSource =
  | "progress"
  | "decision"
  | "error"
  | "test"
  | "summary"
  | "response"
  | "file"
  | "command"
  | "user"
  | "none"

export interface SessionDecisionDigest {
  sessionId: string
  agentId: string
  status: SessionDigestStatus
  summary: string
  nextAction: string
  updatedAt: number
  priority: number
  source: SessionDigestSource
  shouldResume: boolean
}

export interface ProjectSummaryResponse {
  summary: string
  recommendedSessionId: string | null
  recommendedReason: string
  sessions: SessionDecisionDigest[]
}

interface SessionSummaryInput {
  sessionId: string
  agentId: string
  events: AgentEvent[]
}

const NOISE_PATTERNS = [
  /^\d[\d,]*\s*tokens?\s*(used|remaining|total)?$/i,
  /^token usage$/i,
  /^(thinking|processing|waiting)\.{0,3}$/i,
  /^(session (started|ended|resumed)|resume session)/i,
  /^(permission requested|agent is requesting)/i,
  /^(compacting context|handoff|claude code is compress)/i,
  /^(initializing|initialization complete|initialized)$/i,
  /^(初始化中|初始化完成|工作階段已)/,
  /^\.{2,}$/,
]

const BOILERPLATE_PREFIX = /^(i('|’)ll|i will|let me|starting by|start by|first[, ]|to begin|i'm going to|going to|我先|先來|先看|先檢查|先確認|讓我|我會先|開始先|先把|正在|接著先)/i
const OUTCOME_HINT = /(fixed|fixing|done|completed|shipped|published|passed|failed|blocked|waiting|need|next|ready|verified|updated|changed|created|edited|error|errors|issue|issues|risk|risks|requires|decide|decision|review|reviewed|pending|卡住|阻塞|完成|修好|修正|通過|失敗|錯誤|風險|需要|下一步|待確認|已發|已更新|改成|測試|驗證|決策)/i
const HEADING_RE = /^(summary|what happened|outcome|issues?(&| and )risks?|decision needed|摘要|做了哪些事|結果如何|問題與風險|需要你決策)[\s:：-]*$/i

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
}

function normalizeWhitespace(text: string): string {
  return stripMarkdown(text)
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
}

function truncateText(text: string, limit = 160): string {
  if (text.length <= limit) return text
  return text.slice(0, limit - 1).trimEnd() + "..."
}

function splitCandidates(text: string): string[] {
  return stripMarkdown(text)
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => !HEADING_RE.test(line))
}

function isSummaryNoise(text: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(text || "")
  if (!normalized) return true
  if (normalized.length < 4) return true
  if (NOISE_PATTERNS.some((pattern) => pattern.test(normalized))) return true
  if (BOILERPLATE_PREFIX.test(normalized) && !OUTCOME_HINT.test(normalized)) return true
  return false
}

function pickMeaningfulText(...chunks: Array<string | null | undefined>): string {
  for (const chunk of chunks) {
    if (!chunk) continue
    for (const line of splitCandidates(chunk)) {
      if (isSummaryNoise(line)) continue
      return truncateText(line)
    }
  }
  return ""
}

function getLatestProgressEvent(events: AgentEvent[]): AgentEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].progress) return events[i]
  }
  return null
}

function getLatestProgress(events: AgentEvent[]): ProgressReport | null {
  return getLatestProgressEvent(events)?.progress || null
}

function findLatestEvent(events: AgentEvent[], predicate: (event: AgentEvent) => boolean): AgentEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (predicate(events[i])) return events[i]
  }
  return null
}

function formatFileSummary(event: AgentEvent, locale: SummaryLocale): string {
  const path = event.diff?.filePath || event.title?.replace(/^(Editing|Creating|Edited|Created)\s+/i, "") || ""
  const name = path.split(/[/\\]/).pop() || path
  if (!name) return ""
  return locale === "zh-TW"
    ? `${event.type === "file_create" ? "新增" : "修改"} ${name}`
    : `${event.type === "file_create" ? "Created" : "Edited"} ${name}`
}

function inferStatus(events: AgentEvent[]): SessionDigestStatus {
  const latestProgress = getLatestProgress(events)
  if (latestProgress?.status === "blocked") return "blocked"
  if (latestProgress?.status === "done") return "done"
  const waitingDecision = findLatestEvent(events, (event) => event.type === "decision_request" && event.status === "waiting")
  if (waitingDecision) return "blocked"
  const latestError = findLatestEvent(events, (event) =>
    event.type === "error" || (event.type === "test_result" && event.status === "failed"),
  )
  if (latestError) return "blocked"
  const lastEvent = events[events.length - 1]
  if (lastEvent?.status === "in_progress" || lastEvent?.status === "waiting") return "working"
  return "idle"
}

function getFallbackNextAction(status: SessionDigestStatus, locale: SummaryLocale): string {
  if (locale === "zh-TW") {
    if (status === "blocked") return "回到這個 session 解決阻塞或做出決策"
    if (status === "working") return "回到這個 session 繼續推進並補上結果"
    if (status === "done") return "回來驗收結果或決定是否收尾"
    return ""
  }
  if (status === "blocked") return "Return to this session to resolve the blocker or make the decision"
  if (status === "working") return "Return to this session to keep pushing and verify the result"
  if (status === "done") return "Return to review the result or decide whether to wrap it up"
  return ""
}

function getProgressNextAction(progress: ProgressReport | null): string {
  if (!progress?.nextSteps?.length) return ""
  for (const step of progress.nextSteps) {
    const clean = pickMeaningfulText(step)
    if (clean) return clean
  }
  return ""
}

function computePriority(status: SessionDigestStatus, summary: string, nextAction: string, source: SessionDigestSource): number {
  if (status === "blocked") return nextAction ? 120 : 110
  if (status === "working" && nextAction) return 95
  if (status === "working") return 80
  if (status === "done" && nextAction) return 70
  if (status === "done") return 55
  if (source === "user") return 15
  return summary ? 35 : 0
}

export function buildSessionDigest(
  sessionId: string,
  agentId: string,
  events: AgentEvent[],
  locale: SummaryLocale = "en",
): SessionDecisionDigest {
  const status = inferStatus(events)
  const latestProgressEvent = getLatestProgressEvent(events)
  const latestProgress = latestProgressEvent?.progress || null
  const waitingDecision = findLatestEvent(events, (event) => event.type === "decision_request" && event.status === "waiting")
  const latestError = findLatestEvent(events, (event) => event.type === "error")
  const latestFailedTest = findLatestEvent(events, (event) => event.type === "test_result" && event.status === "failed")
  const latestSessionSummary = findLatestEvent(events, (event) => event.type === "session_summary")
  const latestResponse = findLatestEvent(events, (event) =>
    (event.type === "response" || event.type === "info") && !event.id.startsWith("usr_"),
  )
  const latestCommand = findLatestEvent(events, (event) => event.type === "command_run")
  const latestFile = findLatestEvent(events, (event) => event.type === "file_edit" || event.type === "file_create")
  const firstUser = events.find((event) => event.id.startsWith("usr_") || event.type === "user_message") || null

  const candidates: Array<{ source: SessionDigestSource; event: AgentEvent | null; summary: string; nextAction: string }> = [
    {
      source: "decision",
      event: waitingDecision,
      summary: pickMeaningfulText(waitingDecision?.detail, waitingDecision?.title),
      nextAction: locale === "zh-TW" ? "需要你的決策或確認" : "Needs your decision or approval",
    },
    {
      source: "error",
      event: latestError,
      summary: pickMeaningfulText(latestError?.detail, latestError?.title),
      nextAction: "",
    },
    {
      source: "test",
      event: latestFailedTest,
      summary: pickMeaningfulText(latestFailedTest?.detail, latestFailedTest?.title),
      nextAction: "",
    },
    {
      source: "progress",
      event: latestProgressEvent,
      summary: pickMeaningfulText(latestProgress?.summary, latestProgress?.details, latestProgress?.title, latestProgressEvent?.title),
      nextAction: getProgressNextAction(latestProgress),
    },
    {
      source: "summary",
      event: latestSessionSummary,
      summary: pickMeaningfulText(latestSessionSummary?.detail, latestSessionSummary?.title),
      nextAction: "",
    },
    {
      source: "response",
      event: latestResponse,
      summary: pickMeaningfulText(latestResponse?.detail, latestResponse?.title),
      nextAction: "",
    },
    {
      source: "command",
      event: latestCommand,
      summary: pickMeaningfulText(latestCommand?.detail, latestCommand?.title),
      nextAction: "",
    },
    {
      source: "file",
      event: latestFile,
      summary: latestFile ? formatFileSummary(latestFile, locale) : "",
      nextAction: "",
    },
    {
      source: "user",
      event: firstUser,
      summary: pickMeaningfulText(firstUser?.detail, firstUser?.title),
      nextAction: "",
    },
  ]

  const fallbackChosen = {
    source: "none" as const,
    event: null,
    summary: "",
    nextAction: "",
  }
  let chosen = candidates.find((candidate) => candidate.summary) || fallbackChosen
  const responseCandidate = candidates.find((candidate) => candidate.source === "response" && candidate.summary)
  if (
    chosen.source === "progress"
    && latestProgressEvent
    && responseCandidate?.event
    && responseCandidate.event.timestamp > latestProgressEvent.timestamp
    && OUTCOME_HINT.test(responseCandidate.summary)
  ) {
    chosen = responseCandidate
  }

  const nextAction = chosen.nextAction || getProgressNextAction(latestProgress) || getFallbackNextAction(status, locale)
  const updatedAt = chosen.event?.timestamp
    || latestProgressEvent?.timestamp
    || latestResponse?.timestamp
    || latestCommand?.timestamp
    || latestFile?.timestamp
    || firstUser?.timestamp
    || 0
  const priority = computePriority(status, chosen.summary, nextAction, chosen.source)

  return {
    sessionId,
    agentId,
    status,
    summary: chosen.summary,
    nextAction,
    updatedAt,
    priority,
    source: chosen.source,
    shouldResume: status === "blocked" || status === "working" || (!!nextAction && status !== "idle"),
  }
}

export function selectRecommendedSession(digests: SessionDecisionDigest[]): SessionDecisionDigest | null {
  const candidates = digests.filter((digest) => digest.summary || digest.nextAction)
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return b.updatedAt - a.updatedAt
  })[0] || null
}

function formatDigestLine(digest: SessionDecisionDigest, locale: SummaryLocale): string {
  const label = digest.agentId || (locale === "zh-TW" ? "這個 session" : "this session")
  const detail = digest.summary || digest.nextAction
  if (!detail) return label
  if (locale === "zh-TW") {
    if (digest.status === "blocked") return `${label} 卡在 ${detail}`
    if (digest.status === "working") return `${label} 正在 ${detail}`
    if (digest.status === "done") return `${label} 已完成 ${detail}`
    return `${label}：${detail}`
  }
  if (digest.status === "blocked") return `${label} is blocked on ${detail}`
  if (digest.status === "working") return `${label} is working on ${detail}`
  if (digest.status === "done") return `${label} completed ${detail}`
  return `${label}: ${detail}`
}

export function buildProjectSummaryResponse(
  sessions: SessionSummaryInput[],
  locale: SummaryLocale = "en",
): ProjectSummaryResponse {
  const digests = sessions
    .map((session) => buildSessionDigest(session.sessionId, session.agentId, session.events, locale))
    .filter((digest) => digest.summary || digest.nextAction || digest.updatedAt > 0)
    .sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt)

  const recommended = selectRecommendedSession(digests)
  if (!recommended) {
    return {
      summary: locale === "zh-TW"
        ? "目前還沒有足夠的進度可摘要，先打開最近的 session 看看。"
        : "There is not enough progress to summarize yet. Open the most recent session first.",
      recommendedSessionId: null,
      recommendedReason: "",
      sessions: digests,
    }
  }

  const parts: string[] = []
  if (locale === "zh-TW") {
    if (recommended.status === "blocked") {
      parts.push(`建議先回到 ${recommended.agentId}：${recommended.summary}`)
    } else if (recommended.status === "working") {
      parts.push(`目前最值得接手的是 ${recommended.agentId}：${recommended.summary}`)
    } else if (recommended.status === "done") {
      parts.push(`先確認 ${recommended.agentId}：${recommended.summary}`)
    } else {
      parts.push(`${recommended.agentId} 最新進度：${recommended.summary}`)
    }
    if (recommended.nextAction) parts.push(`下一步：${recommended.nextAction}`)
  } else {
    if (recommended.status === "blocked") {
      parts.push(`Go back to ${recommended.agentId} first: ${recommended.summary}`)
    } else if (recommended.status === "working") {
      parts.push(`The best place to continue is ${recommended.agentId}: ${recommended.summary}`)
    } else if (recommended.status === "done") {
      parts.push(`Check ${recommended.agentId} next: ${recommended.summary}`)
    } else {
      parts.push(`${recommended.agentId} latest: ${recommended.summary}`)
    }
    if (recommended.nextAction) parts.push(`Next: ${recommended.nextAction}`)
  }

  const others = digests
    .filter((digest) => digest.sessionId !== recommended.sessionId && (digest.summary || digest.nextAction))
    .slice(0, 2)
    .map((digest) => formatDigestLine(digest, locale))

  if (others.length > 0) {
    parts.push(locale === "zh-TW"
      ? `其他 session：${others.join("；")}`
      : `Other sessions: ${others.join("; ")}`)
  }

  return {
    summary: truncateText(parts.join(" "), 240),
    recommendedSessionId: recommended.sessionId,
    recommendedReason: recommended.nextAction || recommended.summary,
    sessions: digests,
  }
}
