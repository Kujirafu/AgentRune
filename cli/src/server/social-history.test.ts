import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const mockConfig = vi.hoisted(() => ({
  current: {} as { vaultPath?: string; keyVaultPath?: string },
}))

vi.mock("../shared/config.js", () => ({
  loadConfig: () => mockConfig.current,
}))

import { recordPublishedSocialPost } from "./social-history.js"

const tempDirs: string[] = []

afterEach(() => {
  mockConfig.current = {}
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("social-history", () => {
  it("updates the Threads materials table after a successful publish", () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), "agentrune-social-history-"))
    tempDirs.push(vaultRoot)

    const materialsDir = join(vaultRoot, "AgentLore", "社群")
    mkdirSync(materialsDir, { recursive: true })
    const filePath = join(materialsDir, "Threads素材庫.md")
    writeFileSync(filePath, [
      "| 日期 | 類型 | 主題 | 數據 |",
      "|------|------|------|------|",
      "| 03-15 | 觀點文 | 舊貼文 | 2 轉 |",
      "",
      "### 觀察",
    ].join("\n"))

    mockConfig.current = { vaultPath: vaultRoot }

    expect(recordPublishedSocialPost({
      platform: "threads",
      recordType: "Agent 視角",
      recordTitle: "AI 盲區（大部分人用 AI 的方式都太小心了）",
      recordMetrics: "-",
    })).toMatchObject({
      success: true,
      path: filePath,
    })

    const updated = readFileSync(filePath, "utf-8")
    expect(updated).toContain("| Agent 視角 | AI 盲區（大部分人用 AI 的方式都太小心了） | - |")
  })

  it("deduplicates an existing Threads history row", () => {
    const root = mkdtempSync(join(tmpdir(), "agentrune-social-history-"))
    tempDirs.push(root)

    const agentLoreDir = join(root, "AgentLore")
    const keyVaultDir = join(agentLoreDir, "金鑰庫")
    const materialsDir = join(agentLoreDir, "社群")
    mkdirSync(keyVaultDir, { recursive: true })
    mkdirSync(materialsDir, { recursive: true })
    const filePath = join(materialsDir, "Threads素材庫.md")
    const row = "| 03-17 | Agent 視角 | AI 盲區（大部分人用 AI 的方式都太小心了） | - |"
    writeFileSync(filePath, [
      "| 日期 | 類型 | 主題 | 數據 |",
      "|------|------|------|------|",
      row,
      "",
      "### 觀察",
    ].join("\n"))

    mockConfig.current = { keyVaultPath: keyVaultDir }

    expect(recordPublishedSocialPost({
      platform: "threads",
      recordType: "Agent 視角",
      recordTitle: "AI 盲區（大部分人用 AI 的方式都太小心了）",
      recordMetrics: "-",
    })).toEqual({
      success: true,
      skipped: true,
      path: filePath,
    })
  })
})

