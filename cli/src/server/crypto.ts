// server/crypto.ts
// AES-256-GCM encryption for sensitive data at rest (vault keys, auth tokens)

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHash } from "node:crypto"
import { hostname, userInfo } from "node:os"
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12 // GCM recommended
const TAG_LENGTH = 16
const SALT_LENGTH = 32
const KEY_LENGTH = 32
const PBKDF2_ITERATIONS = 100_000
const MAGIC = "ARENC1" // file header to identify encrypted files

let cachedKey: Buffer | null = null

/**
 * Derive a stable machine-specific encryption key.
 * Uses: hostname + username + a persisted random salt (generated once).
 * The salt is stored at ~/.agentrune/.encryption-salt
 */
function deriveKey(): Buffer {
  if (cachedKey) return cachedKey

  const dir = join(homedir(), ".agentrune")
  mkdirSync(dir, { recursive: true })
  const saltPath = join(dir, ".encryption-salt")

  let salt: Buffer
  if (existsSync(saltPath)) {
    salt = readFileSync(saltPath)
  } else {
    // Generate and persist a random salt (one-time)
    salt = randomBytes(SALT_LENGTH)
    writeFileSync(saltPath, salt)
    try { chmodSync(saltPath, 0o600) } catch {}
  }

  // Combine machine-specific identifiers
  const machineId = createHash("sha256")
    .update(hostname())
    .update(userInfo().username)
    .digest()

  cachedKey = pbkdf2Sync(machineId, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512")
  return cachedKey
}

/**
 * Encrypt plaintext string → base64 encoded ciphertext.
 * Format: ARENC1 + base64(iv + ciphertext + authTag)
 */
export function encrypt(plaintext: string): string {
  const key = deriveKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()])
  const tag = cipher.getAuthTag()

  // Pack: iv (12) + encrypted (variable) + tag (16)
  const packed = Buffer.concat([iv, encrypted, tag])
  return MAGIC + packed.toString("base64")
}

/**
 * Decrypt base64 encoded ciphertext → plaintext string.
 * Returns null if decryption fails (wrong key, corrupted data).
 */
export function decrypt(ciphertext: string): string | null {
  if (!ciphertext.startsWith(MAGIC)) return null

  try {
    const key = deriveKey()
    const packed = Buffer.from(ciphertext.slice(MAGIC.length), "base64")

    const iv = packed.subarray(0, IV_LENGTH)
    const tag = packed.subarray(packed.length - TAG_LENGTH)
    const encrypted = packed.subarray(IV_LENGTH, packed.length - TAG_LENGTH)

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString("utf-8")
  } catch {
    return null
  }
}

/**
 * Check if a string is encrypted (has our magic header).
 */
export function isEncrypted(content: string): boolean {
  return content.startsWith(MAGIC)
}

/**
 * Read a file, decrypting if encrypted. Returns plaintext content.
 * If the file is plaintext (not encrypted), returns as-is for migration.
 */
export function readEncryptedFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, "utf-8")
    if (isEncrypted(raw)) {
      return decrypt(raw)
    }
    // Plaintext file — return as-is (will be encrypted on next write)
    return raw
  } catch {
    return null
  }
}

/**
 * Write content to a file, encrypting it with AES-256-GCM.
 * Also sets file permissions to 0o600 (owner read/write only).
 */
export function writeEncryptedFile(filePath: string, content: string): void {
  const encrypted = encrypt(content)
  writeFileSync(filePath, encrypted, "utf-8")
  try { chmodSync(filePath, 0o600) } catch {}
}
