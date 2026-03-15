// crypto.test.ts
// Unit tests for AES-256-GCM encryption module

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { encrypt, decrypt, isEncrypted, readEncryptedFile, writeEncryptedFile } from "./crypto.js"

// ---------------------------------------------------------------------------
// encrypt()
// ---------------------------------------------------------------------------
describe("encrypt", () => {
  it("returns a string starting with the ARENC1 magic header", () => {
    const result = encrypt("hello world")
    expect(result.startsWith("ARENC1")).toBe(true)
  })

  it("returns a non-empty string longer than the magic header", () => {
    const result = encrypt("test")
    expect(result.length).toBeGreaterThan("ARENC1".length)
  })

  it("produces different ciphertext on successive calls (random IV)", () => {
    const a = encrypt("same input")
    const b = encrypt("same input")
    expect(a).not.toBe(b)
  })

  it("handles empty string input", () => {
    const result = encrypt("")
    expect(result.startsWith("ARENC1")).toBe(true)
    expect(result.length).toBeGreaterThan("ARENC1".length)
  })
})

// ---------------------------------------------------------------------------
// decrypt()
// ---------------------------------------------------------------------------
describe("decrypt", () => {
  it("successfully decrypts an encrypted string", () => {
    const original = "secret data 1234"
    const encrypted = encrypt(original)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(original)
  })

  it("returns null for non-encrypted input (no ARENC1 prefix)", () => {
    expect(decrypt("just plain text")).toBeNull()
    expect(decrypt("")).toBeNull()
    expect(decrypt("NOTENC:abc")).toBeNull()
  })

  it("returns null for corrupted data (valid prefix, garbage payload)", () => {
    const corrupted = "ARENC1" + "!!!not-valid-base64-$$$"
    expect(decrypt(corrupted)).toBeNull()
  })

  it("returns null when ciphertext bytes are tampered with", () => {
    const encrypted = encrypt("sensitive")
    // Flip a character deep inside the base64 payload to corrupt the ciphertext
    const chars = encrypted.split("")
    const idx = Math.min(10, chars.length - 1)
    chars[idx] = chars[idx] === "A" ? "B" : "A"
    const tampered = chars.join("")
    expect(decrypt(tampered)).toBeNull()
  })

  it("returns null when the payload is truncated", () => {
    const encrypted = encrypt("hello")
    // Keep ARENC1 prefix but truncate the base64 portion
    const truncated = encrypted.slice(0, "ARENC1".length + 4)
    expect(decrypt(truncated)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isEncrypted()
// ---------------------------------------------------------------------------
describe("isEncrypted", () => {
  it("returns true for strings starting with ARENC1", () => {
    expect(isEncrypted("ARENC1somedata")).toBe(true)
    expect(isEncrypted("ARENC1")).toBe(true)
  })

  it("returns false for plain text", () => {
    expect(isEncrypted("hello world")).toBe(false)
    expect(isEncrypted("")).toBe(false)
    expect(isEncrypted("arenc1lowercase")).toBe(false)
    expect(isEncrypted("ARENC2different")).toBe(false)
  })

  it("correctly identifies output of encrypt()", () => {
    const encrypted = encrypt("test")
    expect(isEncrypted(encrypted)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Roundtrip: encrypt -> decrypt
// ---------------------------------------------------------------------------
describe("roundtrip encrypt/decrypt", () => {
  it("preserves ASCII text", () => {
    const original = "The quick brown fox jumps over the lazy dog."
    expect(decrypt(encrypt(original))).toBe(original)
  })

  it("preserves empty string", () => {
    expect(decrypt(encrypt(""))).toBe("")
  })

  it("preserves unicode / CJK characters", () => {
    const cjk = "\u4F60\u597D\u4E16\u754C\uFF01\u3053\u3093\u306B\u3061\u306F\uC548\uB155\uD558\uC138\uC694"
    expect(decrypt(encrypt(cjk))).toBe(cjk)
  })

  it("preserves mixed CJK + ASCII + special chars", () => {
    const mixed = "AgentRune \u63A7\u5236\u53F0 v1.0 -- key=abc&token=xyz\n\u7B2C\u4E8C\u884C"
    expect(decrypt(encrypt(mixed))).toBe(mixed)
  })

  it("preserves JSON content", () => {
    const json = JSON.stringify({ token: "sk-abc123", nested: { arr: [1, 2, 3] } })
    expect(decrypt(encrypt(json))).toBe(json)
  })

  it("preserves multi-line content with newlines", () => {
    const multiline = "line1\nline2\r\nline3\ttab"
    expect(decrypt(encrypt(multiline))).toBe(multiline)
  })

  it("preserves large payload (10 KB)", () => {
    const large = "x".repeat(10_000)
    expect(decrypt(encrypt(large))).toBe(large)
  })
})

// ---------------------------------------------------------------------------
// readEncryptedFile()
// ---------------------------------------------------------------------------
describe("readEncryptedFile", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentrune-crypto-test-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("returns null for a non-existent file", () => {
    const result = readEncryptedFile(join(tmpDir, "does-not-exist.txt"))
    expect(result).toBeNull()
  })

  it("reads a plaintext file as-is (migration support)", () => {
    const filePath = join(tmpDir, "plain.txt")
    const content = '{"token":"abc123"}'
    writeFileSync(filePath, content, "utf-8")

    const result = readEncryptedFile(filePath)
    expect(result).toBe(content)
  })

  it("reads and decrypts an encrypted file", () => {
    const filePath = join(tmpDir, "secret.enc")
    const original = "super secret value"
    const encrypted = encrypt(original)
    writeFileSync(filePath, encrypted, "utf-8")

    const result = readEncryptedFile(filePath)
    expect(result).toBe(original)
  })

  it("reads empty file as empty string (plaintext migration)", () => {
    const filePath = join(tmpDir, "empty.txt")
    writeFileSync(filePath, "", "utf-8")

    const result = readEncryptedFile(filePath)
    expect(result).toBe("")
  })
})

// ---------------------------------------------------------------------------
// writeEncryptedFile()
// ---------------------------------------------------------------------------
describe("writeEncryptedFile", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentrune-crypto-test-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("creates an encrypted file on disk", () => {
    const filePath = join(tmpDir, "output.enc")
    const content = "my secret data"

    writeEncryptedFile(filePath, content)

    expect(existsSync(filePath)).toBe(true)
    const raw = readFileSync(filePath, "utf-8")
    expect(isEncrypted(raw)).toBe(true)
    // The raw file should NOT contain the original plaintext
    expect(raw).not.toContain(content)
  })

  it("write then read roundtrip via file functions", () => {
    const filePath = join(tmpDir, "roundtrip.enc")
    const original = '{"apiKey":"sk-test-12345","nested":true}'

    writeEncryptedFile(filePath, original)
    const result = readEncryptedFile(filePath)

    expect(result).toBe(original)
  })

  it("overwrites existing file content", () => {
    const filePath = join(tmpDir, "overwrite.enc")

    writeEncryptedFile(filePath, "first value")
    writeEncryptedFile(filePath, "second value")

    const result = readEncryptedFile(filePath)
    expect(result).toBe("second value")
  })

  it("handles CJK content through file write/read roundtrip", () => {
    const filePath = join(tmpDir, "cjk.enc")
    const cjk = "\u52A0\u5BC6\u6E2C\u8A66\uFF1A\u7E41\u9AD4\u4E2D\u6587\u5167\u5BB9"

    writeEncryptedFile(filePath, cjk)
    const result = readEncryptedFile(filePath)

    expect(result).toBe(cjk)
  })
})
