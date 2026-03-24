import type { AppSession, AgentEvent } from "../types"
import { buildSessionDigest, type SummaryLocale } from "./session-summary"

export interface SessionCompletionNotice {
  id: string
  sessionId: string
  sessionIdx: number
  label: string
  summary: string
  nextAction: string
  updatedAt: number
}

function pickText(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function getFallbackSummary(events: AgentEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type === "session_summary") {
      const text = pickText(event.detail, event.title)
      if (text) return text
    }
    if (event.type === "progress_report") {
      const text = pickText(event.progress?.summary, event.detail, event.title)
      if (text) return text
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    const text = pickText(event.detail, event.title)
    if (text) return text
  }
  return ""
}

function defaultCompletionSummary(locale: SummaryLocale): string {
  return locale === "zh-TW" ? "工作階段已完成" : "Session completed"
}

export function buildSessionCompletionNotice(params: {
  session: AppSession
  events: AgentEvent[]
  locale: SummaryLocale
  sessionIdx: number
}): SessionCompletionNotice | null {
  const { session, events, locale, sessionIdx } = params
  if (!session || events.length === 0) return null

  const digest = buildSessionDigest(events, {
    locale,
    sessionId: session.id,
    agentId: session.agentId,
    displayLabel: session.taskTitle || undefined,
  })

  if (digest.status === "blocked") return null

  const summary = digest.summary || getFallbackSummary(events)
  const nextAction = digest.nextAction || ""
  if (!summary && !nextAction) return null

  const updatedAt = digest.updatedAt || events[events.length - 1]?.timestamp || Date.now()
  return {
    id: `${session.id}:${updatedAt}`,
    sessionId: session.id,
    sessionIdx,
    label: digest.displayLabel || session.taskTitle || `Session ${sessionIdx}`,
    summary: summary || defaultCompletionSummary(locale),
    nextAction,
    updatedAt,
  }
}
