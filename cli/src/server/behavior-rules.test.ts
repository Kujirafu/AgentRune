import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ensurePrdApiSection,
  ensureRulesFile,
  getCommandPrompt,
  getDefaultRules,
  getMemoryPath,
  getPrdApiSection,
  getProjectMemory,
  getRulesPath,
  parseRulesVersion,
  updateProjectMemory,
} from "./behavior-rules.js"

const tempDirs: string[] = []

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentrune-rules-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllEnvs()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// parseRulesVersion
// ---------------------------------------------------------------------------
describe("parseRulesVersion", () => {
  it("returns the version number from a valid header", () => {
    const content = "# AgentRune Behavior Rules (v5)\nsome content"
    expect(parseRulesVersion(content)).toBe(5)
  })

  it("returns 0 when the header is missing", () => {
    expect(parseRulesVersion("")).toBe(0)
    expect(parseRulesVersion("# Some other heading\ncontent")).toBe(0)
    expect(parseRulesVersion("AgentRune Behavior Rules (v5)")).toBe(0)
  })

  it("returns 0 for content with no version marker at all", () => {
    expect(parseRulesVersion("random text without any header")).toBe(0)
  })

  it("parses a two-digit version correctly", () => {
    const content = "# AgentRune Behavior Rules (v12)\ncontent"
    expect(parseRulesVersion(content)).toBe(12)
  })

  it("matches the header only at the start of a line", () => {
    // Indented version should not match
    const content = "  # AgentRune Behavior Rules (v9)\ncontent"
    expect(parseRulesVersion(content)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getDefaultRules
// ---------------------------------------------------------------------------
describe("getDefaultRules", () => {
  it("generates rules that describe the index-first memory model", () => {
    const content = getDefaultRules({ locale: "zh-TW" })

    expect(content).toContain(".agentrune/agentlore.md")
    expect(content).toContain("Do not read every memory section by default")
    expect(content).toContain("route_memory_sections")
    expect(content).toContain("Public vs Private Documentation")
  })

  it("includes the current version number in the header", () => {
    const content = getDefaultRules({ locale: "en" })
    // Version must be parseable and >= 5
    expect(parseRulesVersion(content)).toBeGreaterThanOrEqual(5)
  })

  it("uses Traditional Chinese locale label for zh-TW", () => {
    const content = getDefaultRules({ locale: "zh-TW" })
    expect(content).toContain("Traditional Chinese (zh-TW)")
  })

  it("uses Japanese locale label for ja", () => {
    const content = getDefaultRules({ locale: "ja" })
    expect(content).toContain("Japanese (ja)")
  })

  it("uses Korean locale label for ko", () => {
    const content = getDefaultRules({ locale: "ko" })
    expect(content).toContain("Korean (ko)")
  })

  it("uses English locale label for en", () => {
    const content = getDefaultRules({ locale: "en" })
    expect(content).toContain("English (en)")
  })

  it("falls back to the raw locale string for an unknown locale", () => {
    const content = getDefaultRules({ locale: "fr" })
    // LOCALE_DISPLAY has no entry for 'fr', so the raw value is used
    expect(content).toContain("fr")
    // Must not accidentally pick up another display label
    expect(content).not.toContain("English (en)")
    expect(content).not.toContain("Japanese (ja)")
  })

  it("calls getSystemLocale when no locale option is provided", () => {
    // Stub env so getSystemLocale returns a deterministic value
    vi.stubEnv("LANG", "ja_JP.UTF-8")
    vi.stubEnv("LC_ALL", "")
    const content = getDefaultRules()
    expect(content).toContain("Japanese (ja)")
  })

  it("calls getSystemLocale and detects zh locale from LANG", () => {
    vi.stubEnv("LANG", "zh_TW.UTF-8")
    vi.stubEnv("LC_ALL", "")
    const content = getDefaultRules()
    expect(content).toContain("Traditional Chinese (zh-TW)")
  })

  it("calls getSystemLocale and detects ko locale from LANG", () => {
    vi.stubEnv("LANG", "ko_KR.UTF-8")
    vi.stubEnv("LC_ALL", "")
    const content = getDefaultRules()
    expect(content).toContain("Korean (ko)")
  })

  it("falls back to English when LANG is unrecognised and Intl gives a non-CJK locale", () => {
    vi.stubEnv("LANG", "")
    vi.stubEnv("LC_ALL", "")
    // Default Intl locale in the test runner is likely 'en', which will
    // produce English output; we just assert the content is well-formed.
    const content = getDefaultRules()
    expect(parseRulesVersion(content)).toBeGreaterThanOrEqual(5)
  })

  it("detects ja locale from Intl when LANG and LC_ALL are empty", () => {
    vi.stubEnv("LANG", "")
    vi.stubEnv("LC_ALL", "")
    // Temporarily override Intl.DateTimeFormat so the code falls through
    // the env-var check and hits the Intl branch with a ja locale.
    const OriginalIntl = Intl.DateTimeFormat
    const mockIntl = Object.assign(
      function () {
        return { resolvedOptions: () => ({ locale: "ja-JP" }) }
      },
      OriginalIntl,
    ) as unknown as typeof Intl.DateTimeFormat
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(mockIntl)

    const content = getDefaultRules()
    expect(content).toContain("Japanese (ja)")

    vi.restoreAllMocks()
  })

  it("detects ko locale from Intl when LANG and LC_ALL are empty", () => {
    vi.stubEnv("LANG", "")
    vi.stubEnv("LC_ALL", "")
    const OriginalIntl = Intl.DateTimeFormat
    const mockIntl = Object.assign(
      function () {
        return { resolvedOptions: () => ({ locale: "ko-KR" }) }
      },
      OriginalIntl,
    ) as unknown as typeof Intl.DateTimeFormat
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(mockIntl)

    const content = getDefaultRules()
    expect(content).toContain("Korean (ko)")

    vi.restoreAllMocks()
  })

  it("detects zh locale from Intl when LANG and LC_ALL are empty", () => {
    vi.stubEnv("LANG", "")
    vi.stubEnv("LC_ALL", "")
    const OriginalIntl = Intl.DateTimeFormat
    const mockIntl = Object.assign(
      function () {
        return { resolvedOptions: () => ({ locale: "zh-TW" }) }
      },
      OriginalIntl,
    ) as unknown as typeof Intl.DateTimeFormat
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(mockIntl)

    const content = getDefaultRules()
    expect(content).toContain("Traditional Chinese (zh-TW)")

    vi.restoreAllMocks()
  })

  it("returns English when Intl.DateTimeFormat throws", () => {
    vi.stubEnv("LANG", "")
    vi.stubEnv("LC_ALL", "")
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("Intl not available")
    })

    const content = getDefaultRules()
    expect(content).toContain("English (en)")

    vi.restoreAllMocks()
  })
})

// ---------------------------------------------------------------------------
// getRulesPath
// ---------------------------------------------------------------------------
describe("getRulesPath", () => {
  it("returns the expected path inside .agentrune", () => {
    const rulesPath = getRulesPath("/some/project")
    expect(rulesPath).toContain(".agentrune")
    expect(rulesPath).toContain("rules.md")
  })

  it("joins projectCwd with .agentrune/rules.md", () => {
    const dir = createTempProject()
    const expected = join(dir, ".agentrune", "rules.md")
    expect(getRulesPath(dir)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// ensureRulesFile
// ---------------------------------------------------------------------------
describe("ensureRulesFile", () => {
  it("writes versioned rules.md for a project", () => {
    const projectDir = createTempProject()

    ensureRulesFile(projectDir)

    const rulesPath = getRulesPath(projectDir)
    const content = readFileSync(rulesPath, "utf-8")

    expect(parseRulesVersion(content)).toBeGreaterThanOrEqual(5)
  })

  it("creates .agentrune directory when it does not exist", () => {
    const projectDir = createTempProject()
    const agentruneDir = join(projectDir, ".agentrune")

    expect(existsSync(agentruneDir)).toBe(false)
    ensureRulesFile(projectDir)
    expect(existsSync(agentruneDir)).toBe(true)
  })

  it("does not overwrite an existing rules.md that is already at the current version", () => {
    const projectDir = createTempProject()
    ensureRulesFile(projectDir)

    const rulesPath = getRulesPath(projectDir)
    // Append a marker so we can detect if the file was rewritten
    const original = readFileSync(rulesPath, "utf-8")
    const withMarker = original + "\n<!-- sentinel -->"
    writeFileSync(rulesPath, withMarker, "utf-8")

    ensureRulesFile(projectDir)

    const after = readFileSync(rulesPath, "utf-8")
    expect(after).toContain("<!-- sentinel -->")
  })

  it("overwrites an existing rules.md whose version is older than the current version", () => {
    const projectDir = createTempProject()
    const agentruneDir = join(projectDir, ".agentrune")
    mkdirSync(agentruneDir, { recursive: true })

    const rulesPath = getRulesPath(projectDir)
    // Write a stale version (v1)
    writeFileSync(rulesPath, "# AgentRune Behavior Rules (v1)\nold content", "utf-8")

    ensureRulesFile(projectDir)

    const after = readFileSync(rulesPath, "utf-8")
    expect(parseRulesVersion(after)).toBeGreaterThanOrEqual(5)
    expect(after).not.toContain("old content")
  })

  it("passes the locale option through to the generated content", () => {
    const projectDir = createTempProject()
    ensureRulesFile(projectDir, { locale: "ko" })

    const content = readFileSync(getRulesPath(projectDir), "utf-8")
    expect(content).toContain("Korean (ko)")
  })
})

// ---------------------------------------------------------------------------
// getPrdApiSection
// ---------------------------------------------------------------------------
describe("getPrdApiSection", () => {
  it("includes the default port 3457 when no port is provided", () => {
    const section = getPrdApiSection()
    expect(section).toContain("3457")
  })

  it("uses the provided port number", () => {
    const section = getPrdApiSection(9000)
    expect(section).toContain("9000")
    expect(section).not.toContain("3457")
  })

  it("substitutes the projectId placeholder in the URL paths when a projectId is provided", () => {
    const section = getPrdApiSection(3457, "my-project")
    // The actual project ID must appear in the curl URL paths
    expect(section).toContain("/api/prd/my-project")
    // The URL path should not contain the literal token <projectId>
    expect(section).not.toContain("/api/prd/<projectId>")
  })

  it("keeps the <projectId> placeholder in the URL paths when no projectId is provided", () => {
    const section = getPrdApiSection(3457)
    expect(section).toContain("/api/prd/<projectId>")
  })

  it("sanitises unsafe characters from the projectId", () => {
    // Slashes, spaces, and dots are not in [a-zA-Z0-9_-] and must be replaced with _
    const section = getPrdApiSection(3457, "my project/path.name")
    expect(section).toContain("my_project_path_name")
    expect(section).not.toContain("my project/path.name")
  })

  it("contains the PRD API markdown heading", () => {
    const section = getPrdApiSection()
    expect(section).toContain("## PRD API")
  })

  it("includes curl examples for create, read, patch, and task-add", () => {
    const section = getPrdApiSection(3457, "proj")
    expect(section).toContain("curl -X POST")
    expect(section).toContain("curl -X PATCH")
    expect(section).toContain("/api/prd/")
  })
})

// ---------------------------------------------------------------------------
// ensurePrdApiSection
// ---------------------------------------------------------------------------
describe("ensurePrdApiSection", () => {
  it("does nothing when rules.md does not exist", () => {
    const projectDir = createTempProject()
    // No rules.md written — should not throw
    expect(() => ensurePrdApiSection(projectDir)).not.toThrow()
  })

  it("appends the PRD API section when it is missing from rules.md", () => {
    const projectDir = createTempProject()
    ensureRulesFile(projectDir)

    // Verify the section is not present yet (fresh rules.md has no PRD block)
    const rulesPath = getRulesPath(projectDir)
    const before = readFileSync(rulesPath, "utf-8")
    expect(before).not.toContain("## PRD API")

    ensurePrdApiSection(projectDir, 3457, "proj-1")

    const after = readFileSync(rulesPath, "utf-8")
    expect(after).toContain("## PRD API")
    expect(after).toContain("proj-1")
  })

  it("does not duplicate the PRD API section when already present", () => {
    const projectDir = createTempProject()
    ensureRulesFile(projectDir)

    ensurePrdApiSection(projectDir, 3457, "proj-1")
    ensurePrdApiSection(projectDir, 3457, "proj-1")

    const content = readFileSync(getRulesPath(projectDir), "utf-8")
    const occurrences = (content.match(/## PRD API/g) || []).length
    expect(occurrences).toBe(1)
  })

  it("uses the provided port in the appended section", () => {
    const projectDir = createTempProject()
    ensureRulesFile(projectDir)

    ensurePrdApiSection(projectDir, 8888)

    const content = readFileSync(getRulesPath(projectDir), "utf-8")
    expect(content).toContain("8888")
  })
})

// ---------------------------------------------------------------------------
// getMemoryPath
// ---------------------------------------------------------------------------
describe("getMemoryPath", () => {
  it("returns the agentlore.md path inside .agentrune", () => {
    const dir = createTempProject()
    const expected = join(dir, ".agentrune", "agentlore.md")
    expect(getMemoryPath(dir)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// getProjectMemory
// ---------------------------------------------------------------------------
describe("getProjectMemory", () => {
  it("returns empty string when agentlore.md does not exist", () => {
    const projectDir = createTempProject()
    expect(getProjectMemory(projectDir)).toBe("")
  })

  it("returns the file content when agentlore.md exists", () => {
    const projectDir = createTempProject()
    const memDir = join(projectDir, ".agentrune")
    mkdirSync(memDir, { recursive: true })
    writeFileSync(join(memDir, "agentlore.md"), "# memory content", "utf-8")

    expect(getProjectMemory(projectDir)).toBe("# memory content")
  })

  it("returns empty string when readFileSync throws", () => {
    // Mock readFileSync to throw after existsSync returns true by writing the
    // file first and then patching the module's fs call via vi.mock is not
    // straightforward with ESM, so we use a real filesystem trigger instead:
    // create the agentlore.md file and then replace it with a directory of
    // the same name, which causes readFileSync to throw EISDIR.
    const projectDir = createTempProject()
    const memDir = join(projectDir, ".agentrune")
    mkdirSync(memDir, { recursive: true })
    const memPath = join(memDir, "agentlore.md")
    // Create agentlore.md as a *directory* so existsSync returns true but
    // readFileSync throws (EISDIR / illegal operation on a directory).
    mkdirSync(memPath, { recursive: true })

    expect(getProjectMemory(projectDir)).toBe("")
  })
})

// ---------------------------------------------------------------------------
// updateProjectMemory
// ---------------------------------------------------------------------------
describe("updateProjectMemory", () => {
  it("creates agentlore.md with the given content", () => {
    const projectDir = createTempProject()
    updateProjectMemory(projectDir, "# new memory")

    const memPath = getMemoryPath(projectDir)
    expect(readFileSync(memPath, "utf-8")).toBe("# new memory")
  })

  it("creates the .agentrune directory if it does not exist", () => {
    const projectDir = createTempProject()
    const agentruneDir = join(projectDir, ".agentrune")

    expect(existsSync(agentruneDir)).toBe(false)
    updateProjectMemory(projectDir, "content")
    expect(existsSync(agentruneDir)).toBe(true)
  })

  it("overwrites existing agentlore.md content", () => {
    const projectDir = createTempProject()
    updateProjectMemory(projectDir, "first version")
    updateProjectMemory(projectDir, "second version")

    const content = readFileSync(getMemoryPath(projectDir), "utf-8")
    expect(content).toBe("second version")
    expect(content).not.toContain("first version")
  })

  it("writes empty string without error", () => {
    const projectDir = createTempProject()
    expect(() => updateProjectMemory(projectDir, "")).not.toThrow()
    const content = readFileSync(getMemoryPath(projectDir), "utf-8")
    expect(content).toBe("")
  })
})

// ---------------------------------------------------------------------------
// getCommandPrompt
// ---------------------------------------------------------------------------
describe("getCommandPrompt", () => {
  const knownCommands = [
    "/resume",
    "/status",
    "/report",
    "/test",
    "/review",
    "/deploy",
    "/merge",
    "/note",
    "/context",
    "/analysis",
    "/insight",
    "/watch",
    "/watch stop",
  ]

  it.each(knownCommands)("returns a non-empty string for known command '%s'", (cmd) => {
    const prompt = getCommandPrompt(cmd)
    expect(prompt).not.toBeNull()
    expect(typeof prompt).toBe("string")
    expect((prompt as string).length).toBeGreaterThan(0)
  })

  it("returns null for an unknown command", () => {
    expect(getCommandPrompt("/unknown")).toBeNull()
    expect(getCommandPrompt("unknown")).toBeNull()
    expect(getCommandPrompt("")).toBeNull()
  })

  it("returns null for a command with trailing whitespace that does not match", () => {
    // '/resume ' with a trailing space is not in the map
    expect(getCommandPrompt("/resume ")).toBeNull()
  })

  it("returns null for a partial command prefix", () => {
    expect(getCommandPrompt("/res")).toBeNull()
    expect(getCommandPrompt("/wat")).toBeNull()
  })

  it("/resume prompt includes memory-oriented instructions", () => {
    const prompt = getCommandPrompt("/resume") as string
    expect(prompt).toContain("rules.md")
    expect(prompt).toContain("agentlore.md")
    expect(prompt).toContain("report_progress")
  })

  it("/status prompt includes git status instruction", () => {
    const prompt = getCommandPrompt("/status") as string
    expect(prompt).toContain("git status")
    expect(prompt).toContain("report_progress")
  })

  it("/watch stop prompt instructs to end watch mode", () => {
    const prompt = getCommandPrompt("/watch stop") as string
    expect(prompt).toContain("watch")
    expect(prompt).toContain("report_progress")
  })
})
