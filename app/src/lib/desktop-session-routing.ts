import type { AgentEvent, AppSession } from "../types"
import { routeCommand } from "./command-router"
import { getSessionOrderTimestamp } from "./session-ordinals"
import type { SessionDecisionDigest } from "./session-summary"

const FOLLOW_UP_REPLY_RE = /^(?:好(?:的|啊|喔|哦)?|ok(?:ay)?|收到|了解|明白|可以|行|沒問題|继续|继续吧|繼續|繼續吧|請繼續|continue|carry on|keep going|go(?: ahead)?|yes|yep|sure)$/i

function normalizeInput(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase()
}

export function looksLikeFollowUpReply(text: string): boolean {
  const normalized = normalizeInput(text)
  if (!normalized) return false
  if (normalized.startsWith("/") || normalized.startsWith(">") || normalized.startsWith("@")) return false
  if (normalized.length > 24) return false
  return FOLLOW_UP_REPLY_RE.test(normalized)
}

function getSessionStatusScore(status: SessionDecisionDigest["status"] | undefined): number {
  if (status === "blocked") return 4
  if (status === "working") return 3
  if (status === "idle") return 2
  if (status === "done") return 1
  return 0
}

function getSessionActivityTimestamp(
  session: AppSession,
  digest: SessionDecisionDigest | undefined,
  events: AgentEvent[] | undefined,
): number {
  const lastEventTimestamp = events?.length ? events[events.length - 1]?.timestamp || 0 : 0
  return Math.max(
    lastEventTimestamp,
    digest?.updatedAt || 0,
    session.lastActivity || 0,
    getSessionOrderTimestamp(session),
  )
}

function sortSessionsByPriority(
  sessions: AppSession[],
  digests: Map<string, SessionDecisionDigest>,
  sessionEvents: Map<string, AgentEvent[]>,
): AppSession[] {
  return [...sessions].sort((a, b) => {
    const digestA = digests.get(a.id)
    const digestB = digests.get(b.id)
    const statusDelta = getSessionStatusScore(digestB?.status) - getSessionStatusScore(digestA?.status)
    if (statusDelta !== 0) return statusDelta

    const activityDelta =
      getSessionActivityTimestamp(b, digestB, sessionEvents.get(b.id)) -
      getSessionActivityTimestamp(a, digestA, sessionEvents.get(a.id))
    if (activityDelta !== 0) return activityDelta

    return a.id.localeCompare(b.id)
  })
}

function scoreTaskTitleMatch(text: string, session: AppSession): number {
  const title = (session.taskTitle || "").toLowerCase()
  if (!title) return 0
  const keywords = normalizeInput(text)
    .split(/[\s,.:;!?/\\()[\]{}-]+/)
    .filter((part) => part.length >= 3)
    .slice(0, 6)
  if (keywords.length === 0) return 0
  return keywords.filter((keyword) => title.includes(keyword)).length
}

export interface ResolveDesktopSessionTargetOptions {
  text: string
  targetSessionId: string | null
  expandedSessionIds?: Iterable<string>
  sessions: AppSession[]
  digests: Map<string, SessionDecisionDigest>
  sessionEvents: Map<string, AgentEvent[]>
}

export function resolveDesktopSessionTarget({
  text,
  targetSessionId,
  expandedSessionIds,
  sessions,
  digests,
  sessionEvents,
}: ResolveDesktopSessionTargetOptions): string | null {
  if (targetSessionId) return targetSessionId

  const expandedSet = new Set(expandedSessionIds || [])
  const liveSessions = sessions.filter((session) => session.status !== "recoverable")
  if (liveSessions.length === 0) return null

  const actionableSessions = liveSessions.filter((session) => digests.get(session.id)?.status !== "done")
  if (actionableSessions.length === 1) return actionableSessions[0].id

  const expandedSessions = actionableSessions.filter((session) => expandedSet.has(session.id))
  if (expandedSessions.length === 1) return expandedSessions[0].id

  const followUp = looksLikeFollowUpReply(text)
  if (followUp) {
    const preferred = sortSessionsByPriority(
      expandedSessions.length > 0 ? expandedSessions : actionableSessions,
      digests,
      sessionEvents,
    )[0]
    if (preferred) return preferred.id
  }

  const routableSessions = actionableSessions.filter((session) => digests.has(session.id))
  const routed = routeCommand(text, routableSessions, digests, sessionEvents)[0]
  if (routed?.sessionId) return routed.sessionId

  const idleSessions = actionableSessions.filter((session) => digests.get(session.id)?.status === "idle")
  if (idleSessions.length > 0) {
    const byTaskTitle = [...idleSessions]
      .map((session) => ({ session, score: scoreTaskTitleMatch(text, session) }))
      .sort((a, b) => b.score - a.score)
    if ((byTaskTitle[0]?.score || 0) > 0) return byTaskTitle[0].session.id
    return sortSessionsByPriority(idleSessions, digests, sessionEvents)[0]?.id || null
  }

  return null
}
