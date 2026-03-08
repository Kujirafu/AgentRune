// server/auth.ts
// Session & device token management with disk persistence

import { randomBytes } from "node:crypto"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

interface TokenEntry {
  deviceId: string
  createdAt: number
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
  writeFileSync(getTokensPath(), JSON.stringify(data, null, 2))
}

function loadFromDisk(): void {
  const path = getTokensPath()
  if (!existsSync(path)) return
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"))
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
  } catch {
    // Corrupted file — start fresh
  }
}

// Load on module init
loadFromDisk()

// ── Session tokens (short-lived, 24h) ───────────────────────

export function createSessionToken(deviceId: string): string {
  const token = randomBytes(32).toString("hex")
  sessionTokens.set(token, { deviceId, createdAt: Date.now() })
  saveToDisk()
  return token
}

export function validateSessionToken(token: string): string | null {
  const entry = sessionTokens.get(token)
  if (!entry) return null
  if (Date.now() - entry.createdAt > SESSION_EXPIRY) {
    sessionTokens.delete(token)
    saveToDisk()
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
  return entry.token === token
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
