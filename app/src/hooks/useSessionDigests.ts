import { useMemo } from "react"
import type { AppSession, AgentEvent } from "../types"
import {
  buildSessionDigest,
  type SessionDecisionDigest,
  type SummaryLocale,
} from "../lib/session-summary"

export function useSessionDigests(
  sessions: AppSession[],
  events: Map<string, AgentEvent[]>,
  locale: SummaryLocale,
  getDisplayLabel?: (session: AppSession) => string
): Map<string, SessionDecisionDigest> {
  return useMemo(() => {
    const map = new Map<string, SessionDecisionDigest>()
    for (const session of sessions) {
      const sessionEvents = events.get(session.id) || []
      map.set(
        session.id,
        buildSessionDigest(sessionEvents, {
          locale,
          sessionId: session.id,
          agentId: session.agentId,
          displayLabel: getDisplayLabel?.(session),
        })
      )
    }
    return map
  }, [sessions, events, locale, getDisplayLabel])
}
