// server/crypto.ts
// AES-256-GCM encryption for sensitive data at rest (vault keys, auth tokens)

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHash } from "node:crypto"
import { hostname, userInfo } from "node:os"
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, readdirSync, openSync, closeSync, constants as fsConstants } from "node:fs"
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
let cachedSaltHex: string | null = null

/**
 * Derive a stable machine-specific encryption key.
 * Uses: hostname + username + a persisted random salt (generated once).
 * The salt is stored at ~/.agentrune/.encryption-salt
 *
 * SAFETY: If the salt file already exists, it is NEVER overwritten.
 * New salt is only created when no salt file exists. On creation, we check
 * whether encrypted files already exist (which would indicate a lost salt)
 * and log a warning.
 */
function deriveKey(): Buffer {
  if (cachedKey) return cachedKey

  const dir = join(homedir(), ".agentrune")
  mkdirSync(dir, { recursive: true })
  const saltPath = join(dir, ".encryption-salt")

  let salt: Buffer
  if (existsSync(saltPath)) {
    salt = readFileSync(saltPath)
    // Validate salt size — if corrupted, do NOT overwrite (would make things worse)
    if (salt.length !== SALT_LENGTH) {
      throw new Error(`Encryption salt at ${saltPath} is corrupted (${salt.length} bytes, expected ${SALT_LENGTH}). Manual recovery required.`)
    }
  } else {
    // Check for existing encrypted data before creating a new salt.
    // If encrypted files exist but no salt, a previous salt was lost.
    const hasExistingEncrypted = checkForExistingEncryptedFiles(dir)
    if (hasExistingEncrypted) {
      console.error(`[crypto] WARNING: Creating new encryption salt but encrypted files already exist in ${dir}. Previously encrypted data will be UNREADABLE. This typically means the old .encryption-salt was deleted.`)
    }
    // Use O_CREAT | O_EXCL to atomically create — prevents race if two processes start simultaneously
    salt = randomBytes(SALT_LENGTH)
    try {
      const fd = openSync(saltPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL)
      writeFileSync(fd, salt)
      closeSync(fd)
    } catch (err: any) {
      if (err.code === "EEXIST") {
        // Another process created it first — use that one
        salt = readFileSync(saltPath)
      } else {
        throw err
      }
    }
    try { chmodSync(saltPath, 0o600) } catch {}
  }

  // Combine machine-specific identifiers
  const machineId = createHash("sha256")
    .update(hostname())
    .update(userInfo().username)
    .digest()

  cachedKey = pbkdf2Sync(machineId, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512")
  cachedSaltHex = salt.toString("hex")
  return cachedKey
}

/** Quick check: do any ARENC1-prefixed files exist under the config dir? */
function checkForExistingEncryptedFiles(dir: string): boolean {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) {
        try {
          const head = Buffer.alloc(6)
          const fd = openSync(join(dir, entry.name), "r")
          const { readSync } = require("node:fs")
          readSync(fd, head, 0, 6, 0)
          closeSync(fd)
          if (head.toString("utf-8") === MAGIC) return true
        } catch {}
      }
    }
  } catch {}
  return false
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
