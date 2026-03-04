import { randomBytes, createHmac, createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

// ─── Types ──────────────────────────────────────────────────────

export type AuthMode = "pairing" | "totp" | "none"

interface RegisteredDevice {
  id: string
  token: string
  name: string
  registeredAt: number
  lastSeen: number
}

interface AuthState {
  mode: AuthMode
  devices: RegisteredDevice[]
  totpSecret?: string // base32 encoded, persisted for TOTP mode
}

// ─── Paths ──────────────────────────────────────────────────────

const DATA_DIR = join(homedir(), ".agentrune")
const STATE_PATH = join(DATA_DIR, "auth.json")

// ─── Base32 encode/decode (for TOTP secret) ─────────────────────

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

function base32Encode(buffer: Buffer): string {
  let bits = ""
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0")
  let result = ""
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0")
    result += BASE32_CHARS[parseInt(chunk, 2)]
  }
  return result
}

function base32Decode(str: string): Buffer {
  let bits = ""
  for (const ch of str.toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(ch)
    if (idx === -1) continue
    bits += idx.toString(2).padStart(5, "0")
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

// ─── TOTP implementation (RFC 6238) ─────────────────────────────

function generateTOTP(secret: string, timeStep = 30, digits = 6): string {
  const key = base32Decode(secret)
  const counter = Math.floor(Date.now() / 1000 / timeStep)
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeUInt32BE(0, 0) // high 32 bits
  counterBuf.writeUInt32BE(counter, 4) // low 32 bits

  const hmac = createHmac("sha1", key).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  return (code % 10 ** digits).toString().padStart(digits, "0")
}

function verifyTOTP(secret: string, token: string, window = 1): boolean {
  const timeStep = 30
  const now = Math.floor(Date.now() / 1000 / timeStep)

  for (let i = -window; i <= window; i++) {
    const counterBuf = Buffer.alloc(8)
    counterBuf.writeUInt32BE(0, 0)
    counterBuf.writeUInt32BE(now + i, 4)

    const key = base32Decode(secret)
    const hmac = createHmac("sha1", key).update(counterBuf).digest()
    const offset = hmac[hmac.length - 1] & 0x0f
    const code =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)

    const expected = (code % 10 ** 6).toString().padStart(6, "0")
    if (expected === token) return true
  }

  return false
}

// ─── Auth Manager ───────────────────────────────────────────────

export class AuthManager {
  private state: AuthState
  private pairingCode: string | null = null // ephemeral, regenerated each start

  constructor(mode: AuthMode) {
    this.state = this.loadState(mode)

    if (mode === "pairing") {
      // Generate ephemeral 6-digit pairing code
      this.pairingCode = this.generatePairingCode()
    }

    if (mode === "totp" && !this.state.totpSecret) {
      // First run: generate TOTP secret
      this.state.totpSecret = base32Encode(randomBytes(20))
      this.saveState()
    }
  }

  get mode(): AuthMode {
    return this.state.mode
  }

  get deviceCount(): number {
    return this.state.devices.length
  }

  // ── Pairing ──

  getPairingCode(): string | null {
    return this.pairingCode
  }

  getCurrentCode(): string | undefined {
    return this.pairingCode || undefined
  }

  verifyPairingCode(code: string): boolean {
    if (!this.pairingCode) return false
    return code === this.pairingCode
  }

  // ── TOTP ──

  getTotpSecret(): string | null {
    return this.state.totpSecret || null
  }

  getTotpUri(): string | null {
    if (!this.state.totpSecret) return null
    return `otpauth://totp/AgentRune?secret=${this.state.totpSecret}&issuer=AgentRune&digits=6&period=30`
  }

  verifyTotpCode(code: string): boolean {
    if (!this.state.totpSecret) return false
    return verifyTOTP(this.state.totpSecret, code)
  }

  // ── Device management ──

  registerDevice(name: string): { deviceId: string; token: string } {
    const deviceId = randomBytes(16).toString("hex")
    const token = randomBytes(32).toString("hex")

    this.state.devices.push({
      id: deviceId,
      token: this.hashToken(token),
      name,
      registeredAt: Date.now(),
      lastSeen: Date.now(),
    })

    this.saveState()
    return { deviceId, token }
  }

  verifyDevice(deviceId: string, token: string): boolean {
    const device = this.state.devices.find((d) => d.id === deviceId)
    if (!device) return false

    const hashed = this.hashToken(token)
    if (device.token !== hashed) return false

    // Update last seen
    device.lastSeen = Date.now()
    this.saveState()
    return true
  }

  isDeviceKnown(deviceId: string): boolean {
    return this.state.devices.some((d) => d.id === deviceId)
  }

  // ── Console output ──

  printAuthInfo(): void {
    if (this.state.mode === "none") {
      console.log("    Auth:    None (set AGENTRUNE_AUTH=pairing or totp)")
      return
    }

    if (this.state.mode === "pairing") {
      console.log("    Auth:    Device pairing")
      console.log("")
      console.log("    ┌────────────────────────────────────┐")
      console.log(`    │   Pairing code:  ${this.pairingCode}              │`)
      console.log("    │   Enter this on your phone         │")
      console.log("    └────────────────────────────────────┘")
      if (this.state.devices.length > 0) {
        console.log(`    ${this.state.devices.length} device(s) already paired`)
      }
      return
    }

    if (this.state.mode === "totp") {
      console.log("    Auth:    TOTP (Google Authenticator)")
      if (this.state.devices.length === 0) {
        console.log("")
        console.log("    ┌────────────────────────────────────────────┐")
        console.log("    │   First-time setup — scan this in your     │")
        console.log("    │   authenticator app:                       │")
        console.log("    │                                            │")
        console.log(`    │   Secret: ${this.state.totpSecret}         │`)
        console.log("    │                                            │")
        console.log("    │   Or use this URI:                         │")
        console.log(`    │   ${this.getTotpUri()}`)
        console.log("    └────────────────────────────────────────────┘")
      } else {
        console.log(`    ${this.state.devices.length} device(s) registered`)
      }
    }
  }

  // ── Internal ──

  private generatePairingCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex")
  }

  private loadState(mode: AuthMode): AuthState {
    if (existsSync(STATE_PATH)) {
      try {
        const raw = JSON.parse(readFileSync(STATE_PATH, "utf-8"))
        return { ...raw, mode } // mode comes from env, devices from file
      } catch {
        // Corrupted file, start fresh
      }
    }
    return { mode, devices: [] }
  }

  private saveState(): void {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2))
  }
}
