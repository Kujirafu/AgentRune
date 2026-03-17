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

function today(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${month}-${day}`
}

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
      "| Date | Type | Title | Metrics |",
      "|------|------|------|------|",
      "| 03-15 | Thread | Existing post | 2 replies |",
      "",
      "### Recent ideas",
    ].join("\n"))

    mockConfig.current = { vaultPath: vaultRoot }

    expect(recordPublishedSocialPost({
      platform: "threads",
      recordType: "Agent Insight",
      recordTitle: "AI blind spots are usually caused by overly careful prompting",
      recordMetrics: "-",
    })).toMatchObject({
      success: true,
      path: filePath,
    })

    const updated = readFileSync(filePath, "utf-8")
    expect(updated).toContain(`| ${today()} | Agent Insight | AI blind spots are usually caused by overly careful prompting | - |`)
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
    const row = `| ${today()} | Agent Insight | AI blind spots are usually caused by overly careful prompting | - |`

    writeFileSync(filePath, [
      "| Date | Type | Title | Metrics |",
      "|------|------|------|------|",
      row,
      "",
      "### Recent ideas",
    ].join("\n"))

    mockConfig.current = { keyVaultPath: keyVaultDir }

    expect(recordPublishedSocialPost({
      platform: "threads",
      recordType: "Agent Insight",
      recordTitle: "AI blind spots are usually caused by overly careful prompting",
      recordMetrics: "-",
    })).toEqual({
      success: true,
      skipped: true,
      path: filePath,
    })
  })
})
