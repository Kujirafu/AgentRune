export interface SessionActivityMessage {
  sessionId?: string
  eventId?: string
  eventType?: string
  eventTitle?: string
  agentStatus?: string
}

// Uses >>> 0 to ensure unsigned 32-bit result (Math.abs fails on -2147483648)
export function hashStableString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0
  }
  return hash >>> 0
}

export function getSessionActivityNotificationKey(msg: SessionActivityMessage): string | null {
  const sid = typeof msg.sessionId === "string" ? msg.sessionId.trim() : ""
  if (!sid) return null

  const eventId = typeof msg.eventId === "string" ? msg.eventId.trim() : ""
  if (eventId) {
    return `event:${sid}:${eventId}`
  }

  const eventType = typeof msg.eventType === "string" ? msg.eventType.trim() : ""
  const status = typeof msg.agentStatus === "string" ? msg.agentStatus.trim() : ""
  const title = typeof msg.eventTitle === "string" ? msg.eventTitle.trim().slice(0, 200) : ""
  return `fallback:${sid}:${eventType}:${status}:${title}`
}

export function getSessionActivityNotificationId(msg: SessionActivityMessage): number | null {
  const key = getSessionActivityNotificationKey(msg)
  return key ? (hashStableString(key) % 2147483647) : null
}
