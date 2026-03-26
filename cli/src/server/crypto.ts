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
const DEVICE_SECRET_LENGTH = 32
const KEY_LENGTH = 32
const PBKDF2_ITERATIONS = 100_000
const MAGIC = "ARENC1" // file header to identify encrypted files

let cachedKey: Buffer | null = null
let cachedSaltHex: string | null = null
let cachedLegacyKey: Buffer | null = null

/**
 * Read or create a random device secret file.
 * Returns the secret bytes, or null if the file does not exist and
 * `createIfMissing` is false.
 *
 * The device secret provides entropy that cannot be guessed from publicly
 * observable machine identifiers (hostname, username). On Windows, chmod is
 * a no-op, so the secret file itself is the only barrier — but its 32 bytes
 * of randomness make brute-forcing the key infeasible even if an attacker
 * can enumerate hostname + username.
 */
function readOrCreateDeviceSecret(dir: string, createIfMissing: boolean): Buffer | null {
  const secretPath = join(dir, ".device-secret")

  if (existsSync(secretPath)) {
    const secret = readFileSync(secretPath)
    if (secret.length !== DEVICE_SECRET_LENGTH) {
      throw new Error(
        `Device secret at ${secretPath} is corrupted (${secret.length} bytes, expected ${DEVICE_SECRET_LENGTH}). Manual recovery required.`
      )
    }
    return secret
  }

  if (!createIfMissing) return null

  const secret = randomBytes(DEVICE_SECRET_LENGTH)
  try {
    const fd = openSync(secretPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL)
    writeFileSync(fd, secret)
    closeSync(fd)
  } catch (err: any) {
    if (err.code === "EEXIST") {
      // Another process created it first — use that one
      return readFileSync(secretPath)
    }
    throw err
  }
  try { chmodSync(secretPath, 0o600) } catch {}
  return secret
}

/**
 * Build the legacy machineId from hostname + username.
 * Kept only for backward-compatible decryption of data encrypted before the
 * device-secret was introduced.
 */
function legacyMachineId(): Buffer {
  return createHash("sha256")
    .update(hostname())
    .update(userInfo().username)
    .digest()
}

/**
 * Derive the primary encryption key using the device secret.
 *
 * The `.device-secret` file (32 random bytes) is always created on first run.
 * It replaces hostname + username as the PBKDF2 password, making the key
 * unguessable even if the attacker knows all public machine identifiers.
 *
 * The salt (`.encryption-salt`) is always used as the PBKDF2 salt.
 *
 * SAFETY: Salt and device-secret files are NEVER overwritten once created.
 * Atomic O_CREAT|O_EXCL ensures no race between concurrent processes.
 */
function deriveKey(): Buffer {
  if (cachedKey) return cachedKey

  const { salt } = ensureSalt()
  const dir = join(homedir(), ".agentrune")

  // Always create .device-secret if it doesn't exist yet.
  const deviceSecret = readOrCreateDeviceSecret(dir, /* createIfMissing */ true)!
  const keyMaterial = createHash("sha256").update(deviceSecret).digest()

  cachedKey = pbkdf2Sync(keyMaterial, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512")
  cachedSaltHex = salt.toString("hex")
  return cachedKey
}

/**
 * Derive the legacy key from hostname + username.
 * Used only as a decryption fallback for data encrypted before the
 * device-secret existed. Never used for new encryption.
 */
function deriveLegacyKey(): Buffer {
  if (cachedLegacyKey) return cachedLegacyKey

  const { salt } = ensureSalt()
  const keyMaterial = legacyMachineId()

  cachedLegacyKey = pbkdf2Sync(keyMaterial, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512")
  return cachedLegacyKey
}

/**
 * Read (or create) the encryption salt. Factored out so both deriveKey()
 * and deriveLegacyKey() can share the same salt without duplicating I/O.
 */
function ensureSalt(): { salt: Buffer } {
  const dir = join(homedir(), ".agentrune")
  mkdirSync(dir, { recursive: true })
  const saltPath = join(dir, ".encryption-salt")

  let salt: Buffer
  if (existsSync(saltPath)) {
    salt = readFileSync(saltPath)
    if (salt.length !== SALT_LENGTH) {
      throw new Error(`Encryption salt at ${saltPath} is corrupted (${salt.length} bytes, expected ${SALT_LENGTH}). Manual recovery required.`)
    }
  } else {
    const hasExistingEncrypted = checkForExistingEncryptedFiles(dir)
    if (hasExistingEncrypted) {
      console.error(`[crypto] WARNING: Creating new encryption salt but encrypted files already exist in ${dir}. Previously encrypted data will be UNREADABLE. This typically means the old .encryption-salt was deleted.`)
    }
    salt = randomBytes(SALT_LENGTH)
    try {
      const fd = openSync(saltPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL)
      writeFileSync(fd, salt)
      closeSync(fd)
    } catch (err: any) {
      if (err.code === "EEXIST") {
        salt = readFileSync(saltPath)
      } else {
        throw err
      }
    }
    try { chmodSync(saltPath, 0o600) } catch {}
  }

  return { salt }
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
 * Attempt AES-256-GCM decryption with a specific key.
 * Returns the plaintext on success, or null if the key is wrong / data is
 * corrupted (GCM auth-tag verification will throw).
 */
function tryDecryptWithKey(packed: Buffer, key: Buffer): string | null {
  try {
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
 * Decrypt base64 encoded ciphertext -> plaintext string.
 * Returns null if decryption fails (wrong key, corrupted data).
 *
 * MIGRATION: If the primary (device-secret) key fails, a second attempt is
 * made with the legacy key (hostname + username). This allows transparent
 * reading of data that was encrypted before the device-secret was introduced.
 * The caller (readEncryptedFile) can then re-encrypt with the new key on the
 * next write.
 */
export function decrypt(ciphertext: string): string | null {
  if (!ciphertext.startsWith(MAGIC)) return null

  const packed = Buffer.from(ciphertext.slice(MAGIC.length), "base64")

  // 1. Try the primary key (device-secret based)
  const primaryKey = deriveKey()
  const result = tryDecryptWithKey(packed, primaryKey)
  if (result !== null) return result

  // 2. MIGRATION FALLBACK: try the legacy key (hostname + username).
  //    This path is only hit when data was encrypted with the old key
  //    before .device-secret existed. It is harmless on fresh installs
  //    because the legacy key simply won't match either, and null is returned.
  const legacyKey = deriveLegacyKey()
  const legacyResult = tryDecryptWithKey(packed, legacyKey)
  if (legacyResult !== null) {
    console.error(
      `[crypto] INFO: Decrypted data using legacy key (hostname + username). ` +
      `It will be re-encrypted with the stronger device-secret key on next write.`
    )
  }
  return legacyResult
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
