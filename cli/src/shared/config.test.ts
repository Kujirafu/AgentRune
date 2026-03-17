import { afterEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { recoverConfigFromText } from "./config.js"

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("config recovery", () => {
  it("recovers a truncated keyVaultPath to the 金鑰庫 directory", () => {
    const root = mkdtempSync(join(tmpdir(), "agentrune-config-"))
    tempDirs.push(root)

    const vaultDir = join(root, "Obsidian", "Test", "AgentLore", "金鑰庫")
    mkdirSync(vaultDir, { recursive: true })

    const brokenPath = join(root, "Obsidian", "Test", "AgentLore", "broken-value").replace(/\\/g, "/")
    const raw = `{\n  "port": 3456,\n  "keyVaultPath": "${brokenPath}\n}\n`

    expect(recoverConfigFromText(raw)).toEqual({
      port: 3456,
      keyVaultPath: vaultDir,
    })
  })

  it("keeps valid path values when they are already well-formed", () => {
    const root = mkdtempSync(join(tmpdir(), "agentrune-config-"))
    tempDirs.push(root)

    const vaultPath = join(root, "Obsidian", "Test").replace(/\\/g, "/")
    const raw = `{\n  "port": 4567,\n  "vaultPath": "${vaultPath}"\n}\n`

    expect(recoverConfigFromText(raw)).toEqual({
      port: 4567,
      vaultPath,
    })
  })
})

