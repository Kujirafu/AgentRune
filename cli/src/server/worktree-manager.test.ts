import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { syncProjectMemoryToWorktree } from "./worktree-manager.js"

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("worktree-manager memory sync", () => {
  it("shares the memory index, rules, and context sections into a worktree", () => {
    const projectMemoryDir = createTempDir("agentrune-memory-")
    const worktreeMemoryDir = createTempDir("agentrune-worktree-")

    mkdirSync(join(projectMemoryDir, "context"), { recursive: true })
    writeFileSync(join(projectMemoryDir, "agentlore.md"), "# Index\n", "utf-8")
    writeFileSync(join(projectMemoryDir, "rules.md"), "# Rules\n", "utf-8")
    writeFileSync(join(projectMemoryDir, "context", "security.md"), "# Security\n", "utf-8")

    syncProjectMemoryToWorktree(projectMemoryDir, worktreeMemoryDir)

    expect(existsSync(join(worktreeMemoryDir, "agentlore.md"))).toBe(true)
    expect(existsSync(join(worktreeMemoryDir, "rules.md"))).toBe(true)
    expect(existsSync(join(worktreeMemoryDir, "context", "security.md"))).toBe(true)
    expect(readFileSync(join(worktreeMemoryDir, "context", "security.md"), "utf-8")).toContain("Security")

    writeFileSync(join(projectMemoryDir, "agentlore.md"), "# Index\nUpdated\n", "utf-8")
    writeFileSync(join(projectMemoryDir, "context", "security.md"), "# Security\nUpdated\n", "utf-8")

    expect(readFileSync(join(worktreeMemoryDir, "agentlore.md"), "utf-8")).toContain("Updated")
    expect(readFileSync(join(worktreeMemoryDir, "context", "security.md"), "utf-8")).toContain("Updated")
  })
})
