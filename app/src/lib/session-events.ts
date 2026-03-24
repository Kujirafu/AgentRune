import type { AgentEvent } from "../types"
import { getSessionActivityNotificationKey } from "./session-activity"

type SessionActivityIdentity = {
  sessionId?: string
  eventId?: string
  eventType?: string
  eventTitle?: string
  agentStatus?: string
}

export function buildSessionActivityEventId(activity: SessionActivityIdentity): string | null {
  const eventId = typeof activity.eventId === "string" ? activity.eventId.trim() : ""
  if (eventId) return eventId

  const fallbackKey = getSessionActivityNotificationKey(activity)
  return fallbackKey ? `activity:${fallbackKey}` : null
}

function mergeStringField(existing?: string, incoming?: string): string | undefined {
  if (typeof incoming === "string" && incoming.trim()) return incoming
  return existing
}

function mergeArrayField<T>(existing?: T[], incoming?: T[]): T[] | undefined {
  return Array.isArray(incoming) && incoming.length > 0 ? incoming : existing
}

export function mergeAgentEvent(existing: AgentEvent, incoming: AgentEvent): AgentEvent {
  return {
    ...existing,
    ...incoming,
    timestamp: Math.max(existing.timestamp || 0, incoming.timestamp || 0),
    title: mergeStringField(existing.title, incoming.title) || "",
    detail: mergeStringField(existing.detail, incoming.detail),
    raw: mergeStringField(existing.raw, incoming.raw),
    diff: incoming.diff ?? existing.diff,
    decision: incoming.decision ?? existing.decision,
    progress: incoming.progress ?? existing.progress,
    _images: mergeArrayField(existing._images, incoming._images),
  }
}

export function upsertAgentEvent(events: AgentEvent[], incoming: AgentEvent): AgentEvent[] {
  const existingIdx = events.findIndex((event) => event.id === incoming.id)
  if (existingIdx === -1) {
    return [...events, incoming].sort((a, b) => a.timestamp - b.timestamp)
  }

  const merged = mergeAgentEvent(events[existingIdx], incoming)
  const unchanged = JSON.stringify(merged) === JSON.stringify(events[existingIdx])
  if (unchanged) return events

  const next = [...events]
  next[existingIdx] = merged
  next.sort((a, b) => a.timestamp - b.timestamp)
  return next
}

export function mergeAgentEventLists(existing: AgentEvent[], incoming: AgentEvent[]): AgentEvent[] {
  return incoming.reduce((list, event) => upsertAgentEvent(list, event), existing)
}
