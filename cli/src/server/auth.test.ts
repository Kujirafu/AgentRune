// auth.test.ts
// Unit tests for session & device token management (auth.ts)

import { describe, it, expect, beforeEach, vi } from "vitest"

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before the module under test is loaded.
// auth.ts calls loadFromDisk() at import time, so we need to prevent real FS
// access from the very first import.
// ---------------------------------------------------------------------------

vi.mock("./crypto.js", () => ({
  readEncryptedFile: vi.fn(() => null),
  writeEncryptedFile: vi.fn(),
  isEncrypted: vi.fn(() => false),
}))

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => ""),
  }
})

// Import mocked helpers so individual tests can inspect/change their behaviour.
import { readEncryptedFile, writeEncryptedFile, isEncrypted } from "./crypto.js"
import { existsSync, mkdirSync, readFileSync } from "node:fs"

const mockReadEncryptedFile = vi.mocked(readEncryptedFile)
const mockWriteEncryptedFile = vi.mocked(writeEncryptedFile)
const mockIsEncrypted = vi.mocked(isEncrypted)
const mockExistsSync = vi.mocked(existsSync)
const mockMkdirSync = vi.mocked(mkdirSync)
const mockReadFileSync = vi.mocked(readFileSync)

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are declared.
// ---------------------------------------------------------------------------
import {
  createSessionToken,
  validateSessionToken,
  revokeSessionToken,
  registerDevice,
  validateDeviceToken,
  hasPairedDevices,
  listPairedDevices,
  revokeDevice,
  cleanupExpiredTokens,
} from "./auth.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fast-forward Date.now() by the given milliseconds. */
function advanceTimeBy(ms: number) {
  vi.setSystemTime(Date.now() + ms)
}

const SESSION_EXPIRY = 24 * 60 * 60 * 1000 // 24 h in ms — mirrors the constant in auth.ts

// ---------------------------------------------------------------------------
// Reset shared state between every test.
// Because sessionTokens and pairedDevices are module-level Maps they persist
// between tests in the same process.  We reset them by revoking everything
// that was created in the previous test.
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-03-24T00:00:00.000Z"))

  // Clear all paired devices created by previous tests
  for (const entry of listPairedDevices()) {
    revokeDevice(entry.deviceId)
  }

  // Session tokens: we cannot enumerate them directly (Map is not exported),
  // but validateSessionToken returns null for unknown tokens — the cleanup
  // function removes expired ones.  We advance time past expiry then call
  // cleanupExpiredTokens() to flush any lingering session tokens.
  advanceTimeBy(SESSION_EXPIRY + 1)
  cleanupExpiredTokens()
  vi.setSystemTime(new Date("2026-03-24T00:00:00.000Z"))

  // Reset call counts on FS / crypto mocks.
  mockWriteEncryptedFile.mockClear()
  mockReadEncryptedFile.mockClear()
  mockIsEncrypted.mockClear()
})

// ---------------------------------------------------------------------------
// createSessionToken()
// ---------------------------------------------------------------------------
describe("createSessionToken", () => {
  it("returns a 64-character hex string (32 random bytes)", () => {
    const token = createSessionToken("device-1")
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it("generates a unique token on every call", () => {
    const a = createSessionToken("device-1")
    const b = createSessionToken("device-1")
    expect(a).not.toBe(b)
  })

  it("persists to disk on creation", () => {
    createSessionToken("device-1")
    expect(mockWriteEncryptedFile).toHaveBeenCalledOnce()
  })

  it("accepts an optional clientIp and persists it", () => {
    const token = createSessionToken("device-42", "192.168.1.10")
    // Validate from the same IP — should succeed and return the deviceId
    const deviceId = validateSessionToken(token, "192.168.1.10")
    expect(deviceId).toBe("device-42")
  })

  it("accepts undefined clientIp without throwing", () => {
    expect(() => createSessionToken("device-x")).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// validateSessionToken()
// ---------------------------------------------------------------------------
describe("validateSessionToken", () => {
  it("returns the deviceId for a valid, unexpired token", () => {
    const token = createSessionToken("device-abc")
    const result = validateSessionToken(token)
    expect(result).toBe("device-abc")
  })

  it("returns null for an unknown token", () => {
    expect(validateSessionToken("deadbeef".repeat(8))).toBeNull()
  })

  it("returns null for an empty-string token", () => {
    expect(validateSessionToken("")).toBeNull()
  })

  it("returns null and deletes token when it is expired", () => {
    const token = createSessionToken("device-exp")
    advanceTimeBy(SESSION_EXPIRY + 1)
    expect(validateSessionToken(token)).toBeNull()
  })

  it("persists to disk after deleting an expired token", () => {
    const token = createSessionToken("device-exp2")
    mockWriteEncryptedFile.mockClear()
    advanceTimeBy(SESSION_EXPIRY + 1)
    validateSessionToken(token)
    expect(mockWriteEncryptedFile).toHaveBeenCalledOnce()
  })

  it("returns deviceId for a token just before expiry", () => {
    const token = createSessionToken("device-almost")
    advanceTimeBy(SESSION_EXPIRY - 1)
    expect(validateSessionToken(token)).toBe("device-almost")
  })

  // ── IP binding ──────────────────────────────────────────────────────────

  it("allows validation when no IP was bound and none is provided", () => {
    const token = createSessionToken("device-noip")
    expect(validateSessionToken(token)).toBe("device-noip")
  })

  it("allows validation when IP was bound and clientIp matches", () => {
    const token = createSessionToken("device-ip", "10.0.0.5")
    expect(validateSessionToken(token, "10.0.0.5")).toBe("device-ip")
  })

  it("returns null when clientIp does not match bound IP", () => {
    const token = createSessionToken("device-ip2", "10.0.0.5")
    expect(validateSessionToken(token, "10.0.0.6")).toBeNull()
  })

  it("allows validation when IP was bound but no clientIp provided to validate", () => {
    // IP binding only rejects when BOTH entry.clientIp AND clientIp are truthy
    // and they differ.  Providing no clientIp to validate skips the check.
    const token = createSessionToken("device-ip3", "10.0.0.5")
    expect(validateSessionToken(token, undefined)).toBe("device-ip3")
  })

  it("allows validation when no IP was bound but clientIp is provided", () => {
    const token = createSessionToken("device-nobound")
    expect(validateSessionToken(token, "10.0.0.99")).toBe("device-nobound")
  })

  // ── Security edge cases ─────────────────────────────────────────────────

  it("returns null for a token with injected null bytes", () => {
    expect(validateSessionToken("\x00".repeat(64))).toBeNull()
  })

  it("returns null for a token that is all zeros", () => {
    expect(validateSessionToken("0".repeat(64))).toBeNull()
  })

  it("returns null for a very long string", () => {
    expect(validateSessionToken("a".repeat(10_000))).toBeNull()
  })

  it("returns null for a token containing path-traversal characters", () => {
    expect(validateSessionToken("../../etc/passwd")).toBeNull()
  })

  it("does not expose internal token map state through validation errors", () => {
    // Both an unknown token and an empty string should return the same null
    expect(validateSessionToken("unknown-token")).toBeNull()
    expect(validateSessionToken("")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// revokeSessionToken()
// ---------------------------------------------------------------------------
describe("revokeSessionToken", () => {
  it("makes a previously valid token invalid", () => {
    const token = createSessionToken("device-rev")
    revokeSessionToken(token)
    expect(validateSessionToken(token)).toBeNull()
  })

  it("persists to disk after revocation", () => {
    const token = createSessionToken("device-rev2")
    mockWriteEncryptedFile.mockClear()
    revokeSessionToken(token)
    expect(mockWriteEncryptedFile).toHaveBeenCalledOnce()
  })

  it("does not throw when revoking a non-existent token", () => {
    expect(() => revokeSessionToken("does-not-exist")).not.toThrow()
  })

  it("does not throw when revoking an empty string", () => {
    expect(() => revokeSessionToken("")).not.toThrow()
  })

  it("revoking one token does not affect another", () => {
    const a = createSessionToken("device-a")
    const b = createSessionToken("device-b")
    revokeSessionToken(a)
    expect(validateSessionToken(b)).toBe("device-b")
  })
})

// ---------------------------------------------------------------------------
// registerDevice()
// ---------------------------------------------------------------------------
describe("registerDevice", () => {
  it("returns a DeviceEntry with required fields", () => {
    const entry = registerDevice("My Phone")
    expect(entry).toHaveProperty("deviceId")
    expect(entry).toHaveProperty("deviceName", "My Phone")
    expect(entry).toHaveProperty("token")
    expect(entry).toHaveProperty("createdAt")
  })

  it("deviceId is a 32-character hex string (16 random bytes)", () => {
    const entry = registerDevice("Tablet")
    expect(entry.deviceId).toMatch(/^[0-9a-f]{32}$/)
  })

  it("token is a 64-character hex string (32 random bytes)", () => {
    const entry = registerDevice("Laptop")
    expect(entry.token).toMatch(/^[0-9a-f]{64}$/)
  })

  it("generates unique deviceIds on successive calls", () => {
    const a = registerDevice("Phone A")
    const b = registerDevice("Phone B")
    expect(a.deviceId).not.toBe(b.deviceId)
  })

  it("generates unique tokens on successive calls", () => {
    const a = registerDevice("Phone A")
    const b = registerDevice("Phone B")
    expect(a.token).not.toBe(b.token)
  })

  it("sets createdAt to the current timestamp", () => {
    const before = Date.now()
    const entry = registerDevice("Watch")
    const after = Date.now()
    expect(entry.createdAt).toBeGreaterThanOrEqual(before)
    expect(entry.createdAt).toBeLessThanOrEqual(after)
  })

  it("persists to disk after registration", () => {
    mockWriteEncryptedFile.mockClear()
    registerDevice("New Device")
    expect(mockWriteEncryptedFile).toHaveBeenCalledOnce()
  })

  it("accepts an empty string as deviceName without throwing", () => {
    expect(() => registerDevice("")).not.toThrow()
  })

  it("accepts a very long deviceName without throwing", () => {
    expect(() => registerDevice("x".repeat(10_000))).not.toThrow()
  })

  it("accepts CJK characters in deviceName", () => {
    const entry = registerDevice("我的手機")
    expect(entry.deviceName).toBe("我的手機")
  })
})

// ---------------------------------------------------------------------------
// validateDeviceToken()
// ---------------------------------------------------------------------------
describe("validateDeviceToken", () => {
  it("returns true for a valid deviceId and matching token", () => {
    const entry = registerDevice("Phone")
    expect(validateDeviceToken(entry.deviceId, entry.token)).toBe(true)
  })

  it("returns false for an unknown deviceId", () => {
    expect(validateDeviceToken("nonexistent-device-id", "some-token")).toBe(false)
  })

  it("returns false when the token does not match", () => {
    const entry = registerDevice("Phone")
    expect(validateDeviceToken(entry.deviceId, "wrong-token")).toBe(false)
  })

  it("returns false for an empty deviceId", () => {
    expect(validateDeviceToken("", "some-token")).toBe(false)
  })

  it("returns false for an empty token", () => {
    const entry = registerDevice("Phone")
    expect(validateDeviceToken(entry.deviceId, "")).toBe(false)
  })

  it("returns false for an empty deviceId AND empty token", () => {
    expect(validateDeviceToken("", "")).toBe(false)
  })

  it("uses constant-time comparison (timingSafeEqual) — length mismatch returns false", () => {
    const entry = registerDevice("Phone")
    // Token is one character shorter than the real 64-char token
    const shortToken = entry.token.slice(0, -1)
    expect(validateDeviceToken(entry.deviceId, shortToken)).toBe(false)
  })

  it("returns false for a token that differs only in the last character", () => {
    const entry = registerDevice("Phone")
    const almostRight =
      entry.token.slice(0, -1) + (entry.token.endsWith("a") ? "b" : "a")
    expect(validateDeviceToken(entry.deviceId, almostRight)).toBe(false)
  })

  it("validation survives after device is registered and then revoked", () => {
    const entry = registerDevice("Temporary Phone")
    revokeDevice(entry.deviceId)
    expect(validateDeviceToken(entry.deviceId, entry.token)).toBe(false)
  })

  // ── Security edge cases ─────────────────────────────────────────────────

  it("returns false for a deviceId with injection characters", () => {
    expect(validateDeviceToken("'; DROP TABLE devices; --", "token")).toBe(false)
  })

  it("returns false for a very long token string", () => {
    const entry = registerDevice("Phone")
    expect(validateDeviceToken(entry.deviceId, "a".repeat(10_000))).toBe(false)
  })

  it("returns false for token with null bytes", () => {
    const entry = registerDevice("Phone")
    expect(validateDeviceToken(entry.deviceId, "\x00".repeat(64))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hasPairedDevices()
// ---------------------------------------------------------------------------
describe("hasPairedDevices", () => {
  it("returns false when no devices are registered", () => {
    // beforeEach already cleared all devices
    expect(hasPairedDevices()).toBe(false)
  })

  it("returns true after registering a device", () => {
    registerDevice("First Device")
    expect(hasPairedDevices()).toBe(true)
  })

  it("returns false after revoking the only registered device", () => {
    const entry = registerDevice("Only Device")
    revokeDevice(entry.deviceId)
    expect(hasPairedDevices()).toBe(false)
  })

  it("returns true when at least one device remains after partial revocation", () => {
    const a = registerDevice("Device A")
    registerDevice("Device B")
    revokeDevice(a.deviceId)
    expect(hasPairedDevices()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// listPairedDevices()
// ---------------------------------------------------------------------------
describe("listPairedDevices", () => {
  it("returns an empty array when no devices are registered", () => {
    expect(listPairedDevices()).toEqual([])
  })

  it("returns all registered devices", () => {
    registerDevice("Phone")
    registerDevice("Tablet")
    const list = listPairedDevices()
    expect(list).toHaveLength(2)
  })

  it("each entry contains deviceId, deviceName, token, createdAt", () => {
    const entry = registerDevice("My Device")
    const list = listPairedDevices()
    const found = list.find((d) => d.deviceId === entry.deviceId)
    expect(found).toBeDefined()
    expect(found).toHaveProperty("deviceId", entry.deviceId)
    expect(found).toHaveProperty("deviceName", "My Device")
    expect(found).toHaveProperty("token", entry.token)
    expect(found).toHaveProperty("createdAt", entry.createdAt)
  })

  it("does not include a device that was revoked", () => {
    const a = registerDevice("Device A")
    registerDevice("Device B")
    revokeDevice(a.deviceId)
    const list = listPairedDevices()
    expect(list.find((d) => d.deviceId === a.deviceId)).toBeUndefined()
  })

  it("returns a snapshot — mutating the result does not affect internal state", () => {
    registerDevice("Phone")
    const list = listPairedDevices()
    list.pop() // Remove from the returned array
    // Internal state should still have the device
    expect(listPairedDevices()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// revokeDevice()
// ---------------------------------------------------------------------------
describe("revokeDevice", () => {
  it("removes device from paired devices", () => {
    const entry = registerDevice("Removable Device")
    revokeDevice(entry.deviceId)
    expect(listPairedDevices().find((d) => d.deviceId === entry.deviceId)).toBeUndefined()
  })

  it("persists to disk after revocation", () => {
    const entry = registerDevice("Removable Device 2")
    mockWriteEncryptedFile.mockClear()
    revokeDevice(entry.deviceId)
    expect(mockWriteEncryptedFile).toHaveBeenCalledOnce()
  })

  it("does not throw when revoking an unknown deviceId", () => {
    expect(() => revokeDevice("does-not-exist")).not.toThrow()
  })

  it("does not throw when revoking an empty string", () => {
    expect(() => revokeDevice("")).not.toThrow()
  })

  it("revoking one device does not affect other registered devices", () => {
    const a = registerDevice("Device A")
    const b = registerDevice("Device B")
    revokeDevice(a.deviceId)
    expect(validateDeviceToken(b.deviceId, b.token)).toBe(true)
  })

  it("revoking the same device twice does not throw", () => {
    const entry = registerDevice("Double Revoke Device")
    revokeDevice(entry.deviceId)
    expect(() => revokeDevice(entry.deviceId)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// cleanupExpiredTokens()
// ---------------------------------------------------------------------------
describe("cleanupExpiredTokens", () => {
  it("does not throw when there are no session tokens", () => {
    expect(() => cleanupExpiredTokens()).not.toThrow()
  })

  it("removes expired tokens and persists to disk", () => {
    const token = createSessionToken("device-cleanup")
    advanceTimeBy(SESSION_EXPIRY + 1)
    mockWriteEncryptedFile.mockClear()
    cleanupExpiredTokens()
    expect(validateSessionToken(token)).toBeNull()
    expect(mockWriteEncryptedFile).toHaveBeenCalledOnce()
  })

  it("does not remove tokens that are not yet expired", () => {
    const token = createSessionToken("device-keep")
    advanceTimeBy(SESSION_EXPIRY - 1000)
    cleanupExpiredTokens()
    expect(validateSessionToken(token)).toBe("device-keep")
  })

  it("does not write to disk when nothing was cleaned up", () => {
    mockWriteEncryptedFile.mockClear()
    cleanupExpiredTokens()
    expect(mockWriteEncryptedFile).not.toHaveBeenCalled()
  })

  it("only removes expired tokens and keeps valid ones", () => {
    const expired = createSessionToken("device-old")
    advanceTimeBy(SESSION_EXPIRY - 5000)
    const fresh = createSessionToken("device-new")
    advanceTimeBy(6000) // total: SESSION_EXPIRY + 1 for the first token

    cleanupExpiredTokens()

    expect(validateSessionToken(expired)).toBeNull()
    expect(validateSessionToken(fresh)).toBe("device-new")
  })

  it("removes multiple expired tokens in one call", () => {
    const tokens = [
      createSessionToken("device-1"),
      createSessionToken("device-2"),
      createSessionToken("device-3"),
    ]
    advanceTimeBy(SESSION_EXPIRY + 1)
    cleanupExpiredTokens()
    tokens.forEach((t) => expect(validateSessionToken(t)).toBeNull())
  })
})

// ---------------------------------------------------------------------------
// Disk persistence — saveToDisk() / loadFromDisk() behaviour via the crypto mock
// ---------------------------------------------------------------------------
describe("disk persistence interactions", () => {
  it("calls writeEncryptedFile on every mutating operation", () => {
    // Each of these operations must call saveToDisk() exactly once
    mockWriteEncryptedFile.mockClear()
    const token = createSessionToken("device-persist")
    expect(mockWriteEncryptedFile).toHaveBeenCalledTimes(1)

    mockWriteEncryptedFile.mockClear()
    revokeSessionToken(token)
    expect(mockWriteEncryptedFile).toHaveBeenCalledTimes(1)

    mockWriteEncryptedFile.mockClear()
    const device = registerDevice("Persist Device")
    expect(mockWriteEncryptedFile).toHaveBeenCalledTimes(1)

    mockWriteEncryptedFile.mockClear()
    revokeDevice(device.deviceId)
    expect(mockWriteEncryptedFile).toHaveBeenCalledTimes(1)
  })

  it("writeEncryptedFile receives valid JSON as its payload", () => {
    registerDevice("JSON Check Device")
    const [, payload] = mockWriteEncryptedFile.mock.calls.at(-1) as [string, string]
    expect(() => JSON.parse(payload)).not.toThrow()
    const data = JSON.parse(payload)
    expect(data).toHaveProperty("sessionTokens")
    expect(data).toHaveProperty("pairedDevices")
  })

  it("does not write to disk for read-only operations", () => {
    registerDevice("Read Only Test")
    mockWriteEncryptedFile.mockClear()

    // These are all read-only
    hasPairedDevices()
    listPairedDevices()
    validateSessionToken("dummy")

    expect(mockWriteEncryptedFile).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Multi-device / multi-session interactions
// ---------------------------------------------------------------------------
describe("multi-device and multi-session scenarios", () => {
  it("session tokens are independent across different devices", () => {
    const tokenA = createSessionToken("device-A")
    const tokenB = createSessionToken("device-B")
    expect(validateSessionToken(tokenA)).toBe("device-A")
    expect(validateSessionToken(tokenB)).toBe("device-B")
  })

  it("the same device can hold multiple active session tokens", () => {
    const t1 = createSessionToken("shared-device")
    const t2 = createSessionToken("shared-device")
    expect(validateSessionToken(t1)).toBe("shared-device")
    expect(validateSessionToken(t2)).toBe("shared-device")
    expect(t1).not.toBe(t2)
  })

  it("multiple devices can coexist and validate independently", () => {
    const d1 = registerDevice("Device 1")
    const d2 = registerDevice("Device 2")
    expect(validateDeviceToken(d1.deviceId, d1.token)).toBe(true)
    expect(validateDeviceToken(d2.deviceId, d2.token)).toBe(true)
    // Cross-validate: each device's token must not work for the other
    expect(validateDeviceToken(d1.deviceId, d2.token)).toBe(false)
    expect(validateDeviceToken(d2.deviceId, d1.token)).toBe(false)
  })

  it("revoking a device does not affect session tokens", () => {
    const device = registerDevice("Temp Device")
    const sessionToken = createSessionToken(device.deviceId)
    revokeDevice(device.deviceId)
    // Session token is independent of device registration
    expect(validateSessionToken(sessionToken)).toBe(device.deviceId)
  })

  it("revoking a session token does not affect the device registration", () => {
    const device = registerDevice("Persistent Device")
    const sessionToken = createSessionToken(device.deviceId)
    revokeSessionToken(sessionToken)
    // Device should still be paired
    expect(validateDeviceToken(device.deviceId, device.token)).toBe(true)
    expect(hasPairedDevices()).toBe(true)
  })
})
