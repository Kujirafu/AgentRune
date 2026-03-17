import { afterEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadNamedVaultSecrets, loadVaultKeys } from "./vault-keys.js"

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("vault-keys", () => {
  it("loads named secrets from the Obsidian key vault directory", () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), "agentrune-vault-"))
    tempDirs.push(vaultRoot)

    const keyVaultDir = join(vaultRoot, "AgentLore", "金鑰庫")
    mkdirSync(keyVaultDir, { recursive: true })
    writeFileSync(join(keyVaultDir, "第三方服務.md"), [
      "### THREADS_USER_ID",
      "```",
      "12345678901234567",
      "```",
      "",
      "### THREADS_ACCESS_TOKEN (long-lived, 60 days)",
      "```",
      "threads-access-token",
      "```",
      "",
    ].join("\n"))

    expect(loadNamedVaultSecrets({ vaultPath: vaultRoot }, ["THREADS_USER_ID", "THREADS_ACCESS_TOKEN"])).toEqual({
      THREADS_USER_ID: "12345678901234567",
      THREADS_ACCESS_TOKEN: "threads-access-token",
    })
  })

  it("only exposes allowlisted API keys to PTY sessions", () => {
    const keyVaultDir = mkdtempSync(join(tmpdir(), "agentrune-keys-"))
    tempDirs.push(keyVaultDir)

    writeFileSync(join(keyVaultDir, "keys.md"), [
      "### ANTHROPIC_API_KEY",
      "```",
      "anthropic-secret-value",
      "```",
      "",
      "### THREADS_ACCESS_TOKEN",
      "```",
      "threads-access-token",
      "```",
      "",
    ].join("\n"))

    expect(loadVaultKeys({ keyVaultPath: keyVaultDir })).toEqual({
      ANTHROPIC_API_KEY: "anthropic-secret-value",
    })
  })
})

