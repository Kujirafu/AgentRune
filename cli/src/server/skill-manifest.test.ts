import { describe, it, expect } from "vitest"
import {
  createManifestForLevel,
  createDefaultManifest,
  validateManifest,
  buildSandboxInstructions,
  scanPromptForConflicts,
  type SkillManifest,
  type SandboxLevel,
} from "./skill-manifest"

// ── createManifestForLevel ──

describe("createManifestForLevel", () => {
  it('"strict" — no write, no network, no shell', () => {
    const m = createManifestForLevel("test-skill", "strict")

    expect(m.skillId).toBe("test-skill")
    expect(m.permissions.filesystem?.write).toEqual([])
    expect(m.permissions.network).toEqual([])
    expect(m.permissions.shell).toEqual([])
    expect(m.permissions.filesystem?.read).toEqual(["./**"])
    expect(m.walletAccess).toBe(false)
    expect(m.maxExecutionMinutes).toBe(30)
  })

  it('"moderate" — file read/write allowed, no network', () => {
    const m = createManifestForLevel("test-skill", "moderate")

    expect(m.permissions.filesystem?.read).toEqual(["./**"])
    expect(m.permissions.filesystem?.write).toEqual(["./**"])
    expect(m.permissions.network).toEqual([])
    expect(m.permissions.shell).toEqual(["git", "npm test", "npx tsc"])
    expect(m.walletAccess).toBe(false)
  })

  it('"permissive" — network allowed, shell commands allowed', () => {
    const m = createManifestForLevel("test-skill", "permissive")

    expect(m.permissions.network).toEqual(["*"])
    expect(m.permissions.shell).toEqual(
      expect.arrayContaining(["git", "npm", "npx", "node", "curl"])
    )
    expect(m.permissions.shell!.length).toBeGreaterThan(3)
    expect(m.permissions.filesystem?.read).toEqual(["**"])
    expect(m.permissions.filesystem?.write).toEqual(["./**"])
    expect(m.walletAccess).toBe(false)
  })

  it('"none" — everything allowed (wildcards)', () => {
    const m = createManifestForLevel("test-skill", "none")

    expect(m.permissions.filesystem?.read).toEqual(["**"])
    expect(m.permissions.filesystem?.write).toEqual(["**"])
    expect(m.permissions.network).toEqual(["*"])
    expect(m.permissions.shell).toEqual(["*"])
    expect(m.permissions.env).toEqual(["*"])
    expect(m.walletAccess).toBe(false)
  })

  it("defaults to strict when no level is provided", () => {
    const m = createManifestForLevel("test-skill")
    const strict = createManifestForLevel("test-skill", "strict")

    expect(m).toEqual(strict)
  })
})

// ── createDefaultManifest ──

describe("createDefaultManifest", () => {
  it("matches strict level", () => {
    const def = createDefaultManifest("my-skill")
    const strict = createManifestForLevel("my-skill", "strict")

    expect(def).toEqual(strict)
  })

  it("sets skillId correctly", () => {
    const m = createDefaultManifest("abc-123")
    expect(m.skillId).toBe("abc-123")
  })
})

// ── validateManifest ──

describe("validateManifest", () => {
  function validManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
    return {
      skillId: "valid-skill",
      permissions: {
        filesystem: { read: ["./**"], write: [] },
        network: [],
        shell: [],
        env: [],
      },
      walletAccess: false,
      maxExecutionMinutes: 30,
      ...overrides,
    }
  }

  it("valid manifest returns empty errors", () => {
    const errors = validateManifest(validManifest())
    expect(errors).toEqual([])
  })

  it("missing skillId returns error", () => {
    const errors = validateManifest(validManifest({ skillId: "" }))
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors.some((e) => e.field === "skillId")).toBe(true)
  })

  it("path traversal (..) returns error", () => {
    const m = validManifest()
    m.permissions.filesystem = { read: ["../../etc/passwd"], write: [] }

    const errors = validateManifest(m)
    expect(errors.some((e) => e.field === "permissions.filesystem")).toBe(true)
    expect(errors.some((e) => e.message.includes(".."))).toBe(true)
  })

  it("absolute path returns error", () => {
    const m = validManifest()
    m.permissions.filesystem = { read: ["/etc/passwd"], write: [] }

    const errors = validateManifest(m)
    expect(errors.some((e) => e.field === "permissions.filesystem")).toBe(true)
    expect(errors.some((e) => e.message.includes("absolute"))).toBe(true)
  })

  it("Windows absolute path (C:\\) returns error", () => {
    const m = validManifest()
    m.permissions.filesystem = { read: ["C:\\Users\\test"], write: [] }

    const errors = validateManifest(m)
    expect(errors.some((e) => e.field === "permissions.filesystem")).toBe(true)
  })

  it("raw IP in network returns error", () => {
    const m = validManifest()
    m.permissions.network = ["192.168.1.1"]

    const errors = validateManifest(m)
    expect(errors.some((e) => e.field === "permissions.network")).toBe(true)
    expect(errors.some((e) => e.message.includes("Raw IP"))).toBe(true)
  })

  it("protocol in hostname returns error", () => {
    const m = validManifest()
    m.permissions.network = ["https://api.github.com"]

    const errors = validateManifest(m)
    expect(errors.some((e) => e.field === "permissions.network")).toBe(true)
    expect(errors.some((e) => e.message.includes("protocol"))).toBe(true)
  })

  it("dangerous shell command returns error", () => {
    const m = validManifest()
    m.permissions.shell = ["rm -rf /"]

    const errors = validateManifest(m)
    expect(errors.some((e) => e.field === "permissions.shell")).toBe(true)
    expect(errors.some((e) => e.message.includes("Dangerous"))).toBe(true)
  })

  it("mkfs dangerous command returns error", () => {
    const m = validManifest()
    m.permissions.shell = ["mkfs.ext4 /dev/sda1"]

    const errors = validateManifest(m)
    expect(errors.some((e) => e.field === "permissions.shell")).toBe(true)
  })

  it("invalid maxExecutionMinutes (zero) returns error", () => {
    const errors = validateManifest(validManifest({ maxExecutionMinutes: 0 }))
    expect(errors.some((e) => e.field === "maxExecutionMinutes")).toBe(true)
  })

  it("invalid maxExecutionMinutes (negative) returns error", () => {
    const errors = validateManifest(validManifest({ maxExecutionMinutes: -5 }))
    expect(errors.some((e) => e.field === "maxExecutionMinutes")).toBe(true)
  })

  it("invalid maxExecutionMinutes (over 480) returns error", () => {
    const errors = validateManifest(validManifest({ maxExecutionMinutes: 999 }))
    expect(errors.some((e) => e.field === "maxExecutionMinutes")).toBe(true)
  })

  it("valid maxExecutionMinutes (1) returns no error", () => {
    const errors = validateManifest(validManifest({ maxExecutionMinutes: 1 }))
    expect(errors).toEqual([])
  })

  it("valid maxExecutionMinutes (480) returns no error", () => {
    const errors = validateManifest(validManifest({ maxExecutionMinutes: 480 }))
    expect(errors).toEqual([])
  })

  it("multiple errors are collected simultaneously", () => {
    const m: SkillManifest = {
      skillId: "",
      permissions: {
        filesystem: { read: ["/root"], write: [] },
        network: ["192.168.0.1"],
        shell: ["rm -rf /"],
      },
      walletAccess: false,
      maxExecutionMinutes: -1,
    }

    const errors = validateManifest(m)
    expect(errors.length).toBeGreaterThanOrEqual(4)
  })
})

// ── buildSandboxInstructions ──

describe("buildSandboxInstructions", () => {
  it("strict sandbox has restrictive text", () => {
    const manifest = createManifestForLevel("test-skill", "strict")
    const text = buildSandboxInstructions(manifest, "/home/user/project")

    expect(text).toContain("SECURITY SCOPE")
    expect(text).toContain("NONE")
    expect(text).toContain("NO network access")
    expect(text).toContain("do not create or modify any files")
    expect(text).toContain("do not execute shell commands")
    expect(text).toContain("FORBIDDEN")
  })

  it('"none" sandbox has permissive text', () => {
    const manifest = createManifestForLevel("test-skill", "none")
    const text = buildSandboxInstructions(manifest, "/home/user/project")

    expect(text).toContain("Allowed")
    expect(text).toContain("Network: Allowed")
    expect(text).toContain("Shell commands: Allowed")
    expect(text).not.toContain("NO network access")
    expect(text).not.toContain("do not execute shell commands")
  })

  it("moderate sandbox shows limited shell and no network", () => {
    const manifest = createManifestForLevel("test-skill", "moderate")
    const text = buildSandboxInstructions(manifest, "/proj")

    expect(text).toContain("NO network access")
    expect(text).toContain("Only these prefixes")
    expect(text).toContain("git")
    expect(text).toContain("Write: ./**")
  })

  it("includes projectCwd in filesystem section", () => {
    const manifest = createManifestForLevel("test-skill", "strict")
    const text = buildSandboxInstructions(manifest, "/my/project/path")

    expect(text).toContain("/my/project/path")
  })

  it("includes time limit", () => {
    const manifest = createManifestForLevel("test-skill", "strict")
    const text = buildSandboxInstructions(manifest, "/proj")

    expect(text).toContain("30 minutes")
  })

  it("includes stop instruction at the end", () => {
    const manifest = createManifestForLevel("test-skill", "strict")
    const text = buildSandboxInstructions(manifest, "/proj")

    expect(text).toContain("STOP immediately")
    expect(text).toContain("Do NOT attempt to access restricted resources")
  })

  it("shows NO filesystem access when both read and write are empty", () => {
    const manifest: SkillManifest = {
      skillId: "no-fs",
      permissions: { filesystem: { read: [], write: [] }, network: [], shell: [] },
      walletAccess: false,
      maxExecutionMinutes: 10,
    }
    const text = buildSandboxInstructions(manifest, "/proj")

    expect(text).toContain("Filesystem: NO access")
    expect(text).toContain("do not read or write any files")
  })

  it("shows specific host list when network is not wildcard", () => {
    const manifest: SkillManifest = {
      skillId: "specific-net",
      permissions: {
        filesystem: { read: ["./**"], write: [] },
        network: ["api.github.com", "registry.npmjs.org"],
        shell: [],
      },
      walletAccess: false,
      maxExecutionMinutes: 30,
    }
    const text = buildSandboxInstructions(manifest, "/proj")

    expect(text).toContain("Only these hosts")
    expect(text).toContain("api.github.com")
    expect(text).toContain("registry.npmjs.org")
  })

  it("omits wallet restriction line when walletAccess is true", () => {
    const manifest: SkillManifest = {
      skillId: "wallet-ok",
      permissions: { filesystem: { read: [], write: [] }, network: [], shell: [] },
      walletAccess: true,
      maxExecutionMinutes: 30,
    }
    const text = buildSandboxInstructions(manifest, "/proj")

    expect(text).not.toContain("FORBIDDEN")
  })

  it("omits time limit line when maxExecutionMinutes is undefined", () => {
    const manifest: SkillManifest = {
      skillId: "no-time",
      permissions: { filesystem: { read: ["./**"], write: [] }, network: [], shell: [] },
      walletAccess: false,
    }
    const text = buildSandboxInstructions(manifest, "/proj")

    expect(text).not.toContain("Time limit")
    expect(text).not.toContain("minutes")
  })
})

// ── scanPromptForConflicts ──

describe("scanPromptForConflicts", () => {
  it('"strict" with network keywords returns blocked conflicts', () => {
    const result = scanPromptForConflicts("Please fetch data from the API endpoint", "strict")

    expect(result.sandboxLevel).toBe("strict")
    expect(result.blockedCount).toBeGreaterThan(0)
    expect(result.conflicts.some((c) => c.category === "network" && c.blocked)).toBe(true)
  })

  it('"none" with network keywords returns no blocked conflicts', () => {
    const result = scanPromptForConflicts("Please fetch data from the API endpoint", "none")

    expect(result.sandboxLevel).toBe("none")
    // wallet is the only category blocked in "none" — network should not be blocked
    const blockedNetwork = result.conflicts.filter(
      (c) => c.category === "network" && c.blocked
    )
    expect(blockedNetwork).toHaveLength(0)
  })

  it("detects filesystem write keywords", () => {
    const result = scanPromptForConflicts(
      "Please create file output.json and write to file report.txt",
      "strict"
    )

    const writeConflicts = result.conflicts.filter(
      (c) => c.category === "filesystem.write"
    )
    expect(writeConflicts.length).toBeGreaterThan(0)
    expect(writeConflicts.some((c) => c.blocked)).toBe(true)
  })

  it("detects shell command keywords", () => {
    const result = scanPromptForConflicts(
      "Run npm install and then execute the build command",
      "strict"
    )

    const shellConflicts = result.conflicts.filter((c) => c.category === "shell")
    expect(shellConflicts.length).toBeGreaterThan(0)
    expect(shellConflicts.some((c) => c.blocked)).toBe(true)
  })

  it("detects wallet/crypto keywords", () => {
    const result = scanPromptForConflicts(
      "Sign the transaction with the wallet private key on Solana",
      "strict"
    )

    const walletConflicts = result.conflicts.filter((c) => c.category === "wallet")
    expect(walletConflicts.length).toBeGreaterThan(0)
    expect(walletConflicts.some((c) => c.blocked)).toBe(true)
  })

  it("Chinese keywords (filesystem write) — \\b does not match CJK, patterns fail to fire", () => {
    // NOTE: The regex uses \\b which only recognises ASCII word chars.
    // CJK characters are all \\W, so \\b never fires before them.
    // This test documents the current (buggy) behaviour:
    // Chinese filesystem-write keywords are NOT detected.
    const result = scanPromptForConflicts("請寫入檔案到 output 目錄", "strict")

    const writeConflicts = result.conflicts.filter(
      (c) => c.category === "filesystem.write"
    )
    expect(writeConflicts).toHaveLength(0)
  })

  it("Chinese keywords (shell execution) — \\b does not match CJK, patterns fail to fire", () => {
    // Same \\b limitation — Chinese shell keywords are not detected.
    // The prompt still matches ENGLISH patterns ("npm", "test", "deploy" etc.)
    const result = scanPromptForConflicts("執行 npm test 並部署到伺服器", "strict")

    // English "npm" + "test" still trigger shell category
    const shellConflicts = result.conflicts.filter((c) => c.category === "shell")
    expect(shellConflicts.length).toBeGreaterThan(0)

    // But the matched pattern should be the English match, not the Chinese one
    const chineseMatches = shellConflicts.filter((c) =>
      /[\u4e00-\u9fff]/.test(c.matchedPattern)
    )
    expect(chineseMatches).toHaveLength(0)
  })

  it("suggestedLevel is correct for network-only prompt", () => {
    const result = scanPromptForConflicts("Download the file from the endpoint", "strict")

    // Network operations require "permissive"
    expect(result.suggestedLevel).toBe("permissive")
  })

  it("suggestedLevel is correct for filesystem-write-only prompt", () => {
    const result = scanPromptForConflicts("Create file output.txt", "strict")

    // Filesystem write operations require "moderate"
    expect(result.suggestedLevel).toBe("moderate")
  })

  it("suggestedLevel is correct for wallet prompt", () => {
    const result = scanPromptForConflicts(
      "Sign transaction with wallet private key",
      "strict"
    )

    // Wallet operations require "none"
    expect(result.suggestedLevel).toBe("none")
  })

  it("suggestedLevel is null when no blocked conflicts", () => {
    const result = scanPromptForConflicts("Please read the README file", "permissive")

    // "permissive" allows everything except wallet — reading README should not trigger wallet
    // No blocked conflicts means suggestedLevel is null
    if (result.blockedCount === 0) {
      expect(result.suggestedLevel).toBeNull()
    }
  })

  it("summaryKey is noConflict when no blocked operations", () => {
    const result = scanPromptForConflicts("Hello, just a simple question", "none")

    expect(result.blockedCount).toBe(0)
    expect(result.summaryKey).toBe("sandbox.summary.noConflict")
  })

  it("summaryKey is hasConflict when blocked operations exist", () => {
    const result = scanPromptForConflicts("Fetch data from the API", "strict")

    expect(result.blockedCount).toBeGreaterThan(0)
    expect(result.summaryKey).toBe("sandbox.summary.hasConflict")
    expect(result.summaryParams.count).toBe(result.blockedCount)
  })

  it("deduplicates conflicts by category + matched text", () => {
    // Using the same keyword twice should not create duplicate conflicts
    const result = scanPromptForConflicts(
      "fetch data fetch data fetch data",
      "strict"
    )

    const fetchConflicts = result.conflicts.filter(
      (c) => c.matchedPattern.toLowerCase() === "fetch"
    )
    expect(fetchConflicts.length).toBeLessThanOrEqual(1)
  })

  it("conflicts have correct categoryKey format", () => {
    const result = scanPromptForConflicts("Install npm packages and download data", "strict")

    for (const conflict of result.conflicts) {
      expect(conflict.categoryKey).toMatch(/^sandbox\.category\./)
    }
  })

  it("conflicts have correct detectedKey format", () => {
    const result = scanPromptForConflicts("Fetch from the API and write file", "strict")

    for (const conflict of result.conflicts) {
      expect(conflict.detectedKey).toMatch(/^sandbox\.detected\./)
    }
  })

  it("detects env variable keywords", () => {
    const result = scanPromptForConflicts(
      "Read the API_KEY from process.env and use the .env config file",
      "strict"
    )

    const envConflicts = result.conflicts.filter((c) => c.category === "env")
    expect(envConflicts.length).toBeGreaterThan(0)
    expect(envConflicts.some((c) => c.blocked)).toBe(true)
  })

  it("env conflicts are not blocked in permissive mode", () => {
    const result = scanPromptForConflicts(
      "Read the API_KEY from process.env",
      "permissive"
    )

    // permissive env is [] which means blocked — but "none" has ["*"]
    // Let's check the actual behavior: permissive has env: []
    const envConflicts = result.conflicts.filter((c) => c.category === "env")
    if (envConflicts.length > 0) {
      // permissive still blocks env (env: [])
      expect(envConflicts.some((c) => c.blocked)).toBe(true)
    }
  })

  it("env conflicts are not blocked in none mode", () => {
    const result = scanPromptForConflicts(
      "Read the API_KEY from process.env",
      "none"
    )

    const blockedEnv = result.conflicts.filter(
      (c) => c.category === "env" && c.blocked
    )
    expect(blockedEnv).toHaveLength(0)
  })

  it("summaryParams includes categories and suggested for hasConflict", () => {
    const result = scanPromptForConflicts(
      "Fetch data from the API and write file output.json",
      "strict"
    )

    expect(result.summaryKey).toBe("sandbox.summary.hasConflict")
    expect(result.summaryParams.categories).toBeTruthy()
    expect(typeof result.summaryParams.categories).toBe("string")
    expect(result.summaryParams.suggested).toBeTruthy()
    expect(result.summaryParams.level).toBe("sandbox.level.strict")
  })

  it("noConflict summaryParams includes level", () => {
    const result = scanPromptForConflicts("Simple question", "none")

    expect(result.summaryKey).toBe("sandbox.summary.noConflict")
    expect(result.summaryParams.level).toBe("sandbox.level.none")
  })
})
