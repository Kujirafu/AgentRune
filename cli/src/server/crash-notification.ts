import type { AgentEvent } from "../shared/types.js"

export const CRASH_PUSH_COOLDOWN_MS = 10 * 60 * 1000

export function shouldSendCrashPush(lastSentAt: number | undefined, now: number, cooldownMs = CRASH_PUSH_COOLDOWN_MS): boolean {
  return lastSentAt === undefined || (now - lastSentAt) >= cooldownMs
}

export function buildSessionActivityPayload(sessionId: string, event: AgentEvent) {
  return {
    type: "session_activity" as const,
    sessionId,
    eventId: event.id,
    eventType: event.type,
    eventTitle: event.title,
    agentStatus: event.status === "waiting"
      ? "waiting"
      : event.status === "completed"
        ? "idle"
        : "working",
  }
}
