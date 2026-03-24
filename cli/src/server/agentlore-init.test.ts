import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  isAllowedContextSectionFile,
  readContextSection,
  writeContextSection,
} from "./agentlore-init.js"

const tempDirs: string[] = []

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentrune-agentlore-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("agentlore-init context sections", () => {
  it("accepts only known context section filenames", () => {
    expect(isAllowedContextSectionFile("stack.md")).toBe(true)
    expect(isAllowedContextSectionFile("security.md")).toBe(true)
    expect(isAllowedContextSectionFile("..\\..\\secret.txt")).toBe(false)
    expect(isAllowedContextSectionFile("custom.md")).toBe(false)
  })

  it("reads and writes allowed section files", () => {
    const projectDir = createTempProject()

    writeContextSection(projectDir, "stack.md", "# Stack\nsafe\n")

    expect(readContextSection(projectDir, "stack.md")).toBe("# Stack\nsafe\n")
    expect(existsSync(join(projectDir, ".agentrune", "context", "stack.md"))).toBe(true)
  })

  it("blocks invalid section names from reading or writing", () => {
    const projectDir = createTempProject()
    const traversalPath = "..\\..\\secret.txt"

    expect(readContextSection(projectDir, traversalPath)).toBe("")
    expect(() => writeContextSection(projectDir, traversalPath, "pwned")).toThrow(/Invalid context section file/)
    expect(existsSync(join(projectDir, "secret.txt"))).toBe(false)
  })
})
