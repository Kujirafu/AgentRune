import type { AppSession } from "../types"
import type { SessionAttachMessage } from "./session-attach"
import { buildSessionAttachMessage } from "./session-attach"
import { getSessionOrderTimestamp } from "./session-ordinals"
import { getAutoSaveKeysEnabled, getAutoSaveKeysPath, getSettings } from "./storage"

export interface ResolveDesktopLaunchAgentOptions {
  targetSessionId: string | null
  expandedSessionIds?: Iterable<string>
  sessions: AppSession[]
  selectedProjectId: string | null
}

export interface BuildDesktopLaunchAttachOptions {
  projectId: string
  agentId: string
  sessionId: string
  locale: string
  resumeAgentSessionId?: string
}

function sortNewestFirst(sessions: AppSession[]): AppSession[] {
  return [...sessions].sort((a, b) =>
    getSessionOrderTimestamp(b) - getSessionOrderTimestamp(a) || b.id.localeCompare(a.id),
  )
}

export function resolveDesktopLaunchAgentId({
  targetSessionId,
  expandedSessionIds,
  sessions,
  selectedProjectId,
}: ResolveDesktopLaunchAgentOptions): string {
  if (targetSessionId) {
    const target = sessions.find((session) => session.id === targetSessionId)
    if (target?.agentId) return target.agentId
  }

  const expandedSet = new Set(expandedSessionIds || [])
  const projectSessions = sortNewestFirst(
    sessions.filter((session) => !selectedProjectId || session.projectId === selectedProjectId),
  )
  const expandedSession = projectSessions.find((session) => expandedSet.has(session.id))
  if (expandedSession?.agentId) return expandedSession.agentId

  return projectSessions[0]?.agentId || sortNewestFirst(sessions)[0]?.agentId || "claude"
}

export function buildDesktopLaunchAttachMessage({
  projectId,
  agentId,
  sessionId,
  locale,
  resumeAgentSessionId,
}: BuildDesktopLaunchAttachOptions): SessionAttachMessage {
  return buildSessionAttachMessage({
    projectId,
    agentId,
    sessionId,
    autoSaveKeys: getAutoSaveKeysEnabled(),
    autoSaveKeysPath: getAutoSaveKeysPath(),
    shouldResumeAgent: !!resumeAgentSessionId,
    claudeSessionId: resumeAgentSessionId,
    settings: getSettings(projectId),
    locale,
  })
}
