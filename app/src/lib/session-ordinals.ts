import type { AppSession } from "../types"

export function extractSessionTimestamp(sessionId: string): number | null {
  const matches = [...sessionId.matchAll(/_(\d{13,})(?=_|$)/g)]
  if (matches.length === 0) return null
  const value = Number.parseInt(matches[matches.length - 1][1], 10)
  return Number.isFinite(value) ? value : null
}

export function getSessionOrderTimestamp(session: Pick<AppSession, "id" | "createdAt" | "lastActivity">): number {
  if (typeof session.createdAt === "number" && Number.isFinite(session.createdAt)) return session.createdAt

  const fromId = extractSessionTimestamp(session.id)
  if (fromId !== null) return fromId

  if (typeof session.lastActivity === "number" && Number.isFinite(session.lastActivity)) return session.lastActivity
  return 0
}

export function compareSessionsByOrdinal(
  a: Pick<AppSession, "id" | "createdAt" | "lastActivity">,
  b: Pick<AppSession, "id" | "createdAt" | "lastActivity">,
): number {
  return getSessionOrderTimestamp(a) - getSessionOrderTimestamp(b) || a.id.localeCompare(b.id)
}

export function buildSessionOrdinalMap(
  sessions: Array<Pick<AppSession, "id" | "createdAt" | "lastActivity">>,
): Map<string, number> {
  const ordinals = new Map<string, number>()
  const ordered = [...sessions].sort(compareSessionsByOrdinal)
  ordered.forEach((session, index) => {
    ordinals.set(session.id, index + 1)
  })
  return ordinals
}

export function sortSessionsByOrdinal<T extends Pick<AppSession, "id" | "createdAt" | "lastActivity">>(sessions: T[]): T[] {
  return [...sessions].sort(compareSessionsByOrdinal)
}
