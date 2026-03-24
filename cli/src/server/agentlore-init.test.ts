import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  isAllowedContextSectionFile,
  listContextSections,
  readContextSection,
  routeContextSections,
  searchContextSections,
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

  it("lists structured section metadata", () => {
    const projectDir = createTempProject()

    const sections = listContextSections(projectDir)

    expect(sections.some((section) => section.file === "security.md")).toBe(true)
    const security = sections.find((section) => section.file === "security.md")
    expect(security?.keywords).toContain("security")
    expect(security?.taskTypes).toContain("security")
  })

  it("blocks invalid section names from reading or writing", () => {
    const projectDir = createTempProject()
    const traversalPath = "..\\..\\secret.txt"

    expect(readContextSection(projectDir, traversalPath)).toBe("")
    expect(() => writeContextSection(projectDir, traversalPath, "pwned")).toThrow(/Invalid context section file/)
    expect(existsSync(join(projectDir, "secret.txt"))).toBe(false)
  })

  it("searches structured memory sections using metadata and content", () => {
    const projectDir = createTempProject()
    writeContextSection(projectDir, "security.md", "# Security\nTunnel auth must validate forwarded headers.\n")
    writeContextSection(projectDir, "bugs.md", "# Bugs\nWatcher resume race in ws-server.\n")

    const results = searchContextSections(projectDir, "tunnel auth forwarded headers", { limit: 3 })

    expect(results[0]?.file).toBe("security.md")
    expect(results[0]?.snippets.some((snippet) => /forwarded headers/i.test(snippet))).toBe(true)
  })

  it("routes tasks to the most relevant memory sections", () => {
    const projectDir = createTempProject()
    writeContextSection(projectDir, "security.md", "# Security\nTrusted-local auth rules.\n")
    writeContextSection(projectDir, "bugs.md", "# Bugs\nWatcher bug root cause.\n")
    writeContextSection(projectDir, "lessons.md", "# Lessons\nPlaywright regression notes.\n")

    const route = routeContextSections(projectDir, {
      task: "Fix tunnel auth bug in ws-server and review the security boundary",
      changedFiles: ["cli/src/server/ws-server.ts"],
      maxSections: 3,
    })

    expect(route.sections[0]?.file).toBe("security.md")
    expect(route.sections.some((section) => section.file === "bugs.md")).toBe(true)
    expect(route.sections[0]?.reasons.length).toBeGreaterThan(0)
  })
})
