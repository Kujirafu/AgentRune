// server/auth.ts
// Session & device token management with encrypted disk persistence

import { randomBytes, timingSafeEqual } from "node:crypto"
import { readFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { readEncryptedFile, writeEncryptedFile, isEncrypted } from "./crypto.js"

interface TokenEntry {
  deviceId: string
  createdAt: number
  clientIp?: string // Bound IP — reject if request comes from a different IP
}

interface DeviceEntry {
  deviceId: string
  deviceName: string
  token: string
  createdAt: number
}

const SESSION_EXPIRY = 24 * 60 * 60 * 1000 // 24 hours
const sessionTokens = new Map<string, TokenEntry>()
const pairedDevices = new Map<string, DeviceEntry>() // deviceId -> entry

function getTokensPath(): string {
  const dir = join(homedir(), ".agentrune")
  mkdirSync(dir, { recursive: true })
  return join(dir, "tokens.json")
}

// ── Persistence ──────────────────────────────────────────────

function saveToDisk(): void {
  const data = {
    sessionTokens: Object.fromEntries(sessionTokens),
    pairedDevices: Object.fromEntries(pairedDevices),
  }
  writeEncryptedFile(getTokensPath(), JSON.stringify(data, null, 2))
}

function loadFromDisk(): void {
  const tokensPath = getTokensPath()
  if (!existsSync(tokensPath)) return
  try {
    // readEncryptedFile handles both encrypted and plaintext (migration)
    const content = readEncryptedFile(tokensPath)
    if (!content) return
    const raw = JSON.parse(content)
    const now = Date.now()

    // Load session tokens (skip expired)
    if (raw.sessionTokens) {
      for (const [token, entry] of Object.entries(raw.sessionTokens)) {
        const e = entry as TokenEntry
        if (now - e.createdAt < SESSION_EXPIRY) {
          sessionTokens.set(token, e)
        }
      }
    }

    // Load paired devices (permanent until revoked)
    if (raw.pairedDevices) {
      for (const [deviceId, entry] of Object.entries(raw.pairedDevices)) {
        pairedDevices.set(deviceId, entry as DeviceEntry)
      }
    }

    // Auto-migrate: if file was plaintext, re-encrypt on load
    const rawFile = readFileSync(tokensPath, "utf-8")
    if (!isEncrypted(rawFile)) {
      saveToDisk() // re-saves encrypted
    }
  } catch {
    // Corrupted file — start fresh
  }
}

// Load on module init
loadFromDisk()

// ── Session tokens (short-lived, 24h) ───────────────────────

export function createSessionToken(deviceId: string, clientIp?: string): string {
  const token = randomBytes(32).toString("hex")
  sessionTokens.set(token, { deviceId, createdAt: Date.now(), clientIp })
  saveToDisk()
  return token
}

export function validateSessionToken(token: string, clientIp?: string): string | null {
  const entry = sessionTokens.get(token)
  if (!entry) return null
  if (Date.now() - entry.createdAt > SESSION_EXPIRY) {
    sessionTokens.delete(token)
    saveToDisk()
    return null
  }
  // IP binding: if token was created with a bound IP, reject mismatches
  if (entry.clientIp && clientIp && entry.clientIp !== clientIp) {
    return null
  }
  return entry.deviceId
}

export function revokeSessionToken(token: string): void {
  sessionTokens.delete(token)
  saveToDisk()
}

// ── Device tokens (long-lived, persist across daemon restarts) ─

export function registerDevice(deviceName: string): DeviceEntry {
  const deviceId = randomBytes(16).toString("hex")
  const token = randomBytes(32).toString("hex")
  const entry: DeviceEntry = { deviceId, deviceName, token, createdAt: Date.now() }
  pairedDevices.set(deviceId, entry)
  saveToDisk()
  return entry
}

export function validateDeviceToken(deviceId: string, token: string): boolean {
  const entry = pairedDevices.get(deviceId)
  if (!entry) return false
  const a = Buffer.from(entry.token)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function hasPairedDevices(): boolean {
  return pairedDevices.size > 0
}

export function listPairedDevices(): DeviceEntry[] {
  return Array.from(pairedDevices.values())
}

export function revokeDevice(deviceId: string): void {
  pairedDevices.delete(deviceId)
  saveToDisk()
}

/** Clean up expired session tokens */
export function cleanupExpiredTokens(): void {
  const now = Date.now()
  let changed = false
  for (const [token, entry] of sessionTokens) {
    if (now - entry.createdAt > SESSION_EXPIRY) {
      sessionTokens.delete(token)
      changed = true
    }
  }
  if (changed) saveToDisk()
}
