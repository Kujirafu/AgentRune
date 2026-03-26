import type { AgentEvent } from "../shared/types.js"

export const MAX_SESSION_EVENT_HISTORY = 500

export function normalizeSessionRecentEvents(events: AgentEvent[]): AgentEvent[] {
  const meaningful = events.filter((event) => event.type !== "token_usage")
  if (meaningful.length <= MAX_SESSION_EVENT_HISTORY) return meaningful
  return meaningful.slice(-MAX_SESSION_EVENT_HISTORY)
}

export function mergeSessionRecentEvents(
  existing: AgentEvent[] | undefined,
  incoming: AgentEvent[],
): AgentEvent[] {
  if ((!existing || existing.length === 0) && incoming.length === 0) return []
  return normalizeSessionRecentEvents([...(existing || []), ...incoming])
}
