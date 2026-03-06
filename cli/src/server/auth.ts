// server/auth.ts
// Session token management for WebSocket authentication

import { randomBytes } from "node:crypto"

interface TokenEntry {
  deviceId: string
  createdAt: number
}

const TOKEN_EXPIRY = 24 * 60 * 60 * 1000 // 24 hours
const tokens = new Map<string, TokenEntry>()

export function createSessionToken(deviceId: string): string {
  const token = randomBytes(32).toString("hex")
  tokens.set(token, { deviceId, createdAt: Date.now() })
  return token
}

export function validateSessionToken(token: string): string | null {
  const entry = tokens.get(token)
  if (!entry) return null
  if (Date.now() - entry.createdAt > TOKEN_EXPIRY) {
    tokens.delete(token)
    return null
  }
  return entry.deviceId
}

export function revokeSessionToken(token: string): void {
  tokens.delete(token)
}

/** Clean up expired tokens periodically */
export function cleanupExpiredTokens(): void {
  const now = Date.now()
  for (const [token, entry] of tokens) {
    if (now - entry.createdAt > TOKEN_EXPIRY) {
      tokens.delete(token)
    }
  }
}
