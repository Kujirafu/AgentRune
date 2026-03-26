import type { AgentEvent } from "../types"
import { getSessionActivityNotificationKey } from "./session-activity"

export const MAX_SESSION_EVENT_HISTORY = 500

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

function preferEventType(existing: AgentEvent["type"], incoming: AgentEvent["type"]): AgentEvent["type"] {
  if (existing === incoming) return incoming
  if (existing === "response" && incoming === "info") return existing
  if (incoming === "response" && existing === "info") return incoming
  return incoming
}

function normalizeSemanticText(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim()
}

function isGenericAgentResponseTitle(value?: string): boolean {
  return /^(?:Claude|Codex|Cursor|Gemini|Aider) responded(?: \(detailed\))?$/i.test(normalizeSemanticText(value))
}

function haveEquivalentEventTypes(existing: AgentEvent["type"], incoming: AgentEvent["type"]): boolean {
  if (existing === incoming) return true
  if ((existing === "response" || existing === "info") && (incoming === "response" || incoming === "info")) return true
  return false
}

function areSemanticallyEquivalent(existing: AgentEvent, incoming: AgentEvent): boolean {
  if (!haveEquivalentEventTypes(existing.type, incoming.type)) return false
  if (Math.abs((existing.timestamp || 0) - (incoming.timestamp || 0)) > 5_000) return false

  const existingTitle = normalizeSemanticText(existing.title)
  const incomingTitle = normalizeSemanticText(incoming.title)

  const existingDetail = normalizeSemanticText(existing.detail)
  const incomingDetail = normalizeSemanticText(incoming.detail)
  if (existingDetail && incomingDetail && existingDetail === incomingDetail) return true

  if (existingTitle && incomingTitle && existingTitle === incomingTitle) {
    return !existingDetail || !incomingDetail || existingDetail === incomingDetail
  }

  const existingGeneric = isGenericAgentResponseTitle(existingTitle)
  const incomingGeneric = isGenericAgentResponseTitle(incomingTitle)
  if (!existingGeneric && !incomingGeneric) return false

  if (existingDetail && incomingTitle && existingDetail.startsWith(incomingTitle)) return true
  if (incomingDetail && existingTitle && incomingDetail.startsWith(existingTitle)) return true

  return false
}

export function mergeAgentEvent(existing: AgentEvent, incoming: AgentEvent): AgentEvent {
  return {
    ...existing,
    ...incoming,
    timestamp: Math.max(existing.timestamp || 0, incoming.timestamp || 0),
    type: preferEventType(existing.type, incoming.type),
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
  const existingIdx = events.findIndex((event) =>
    event.id === incoming.id || areSemanticallyEquivalent(event, incoming),
  )
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
