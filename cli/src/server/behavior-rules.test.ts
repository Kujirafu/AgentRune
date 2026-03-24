import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ensureRulesFile, getDefaultRules, getRulesPath, parseRulesVersion } from "./behavior-rules.js"

const tempDirs: string[] = []

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentrune-rules-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("behavior-rules", () => {
  it("generates rules that describe the index-first memory model", () => {
    const content = getDefaultRules({ locale: "zh-TW" })

    expect(content).toContain(".agentrune/agentlore.md")
    expect(content).toContain("Do not read every memory section by default")
    expect(content).toContain("route_memory_sections")
    expect(content).toContain("Public vs Private Documentation")
  })

  it("writes versioned rules.md for a project", () => {
    const projectDir = createTempProject()

    ensureRulesFile(projectDir)

    const rulesPath = getRulesPath(projectDir)
    const content = readFileSync(rulesPath, "utf-8")

    expect(parseRulesVersion(content)).toBeGreaterThanOrEqual(5)
  })
})
