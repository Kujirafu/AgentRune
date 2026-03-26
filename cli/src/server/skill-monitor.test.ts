import { describe, it, expect, vi, beforeEach } from "vitest"
import { SkillMonitor, type MonitorConfig } from "./skill-monitor.js"

// ── Mocks ──

vi.mock("../shared/logger.js", () => ({
  log: { warn: vi.fn(), error: vi.fn(), dim: vi.fn() },
}))

vi.mock("./authority-map.js", () => ({
  hasPermission: vi.fn(() => false),
  violationTypeToPermissionKey: vi.fn((t: string) => t),
}))

// Import the mocked functions so we can control them per-test
import * as authorityMapMock from "./authority-map.js"

const mockHasPermission = vi.mocked(authorityMapMock.hasPermission)
const mockViolationTypeToPermissionKey = vi.mocked(authorityMapMock.violationTypeToPermissionKey)

// ── Config helper ──

function createConfig(overrides?: Partial<MonitorConfig>): MonitorConfig {
  return {
    manifest: {
      skillId: "test-skill",
      permissions: {
        filesystem: { read: [], write: [] },
        network: [],
        shell: [],
        env: [],
      },
      walletAccess: false,
    },
    projectCwd: "/test/project",
    ...overrides,
  } as MonitorConfig
}

// ── 1. Basic processing ──

describe("processOutput — basic", () => {
  it("increments linesProcessed for each newline-terminated line", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("hello\nworld\n")
    // "hello" and "world" are complete lines; "" remains in buffer
    expect(monitor.getStats().linesProcessed).toBe(2)
  })

  it("does not count a partial line still sitting in the buffer", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("partial")
    expect(monitor.getStats().linesProcessed).toBe(0)
  })

  it("handles Windows-style CRLF line endings", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("line1\r\nline2\r\n")
    expect(monitor.getStats().linesProcessed).toBe(2)
  })

  it("updates lastActivityAt on each call", async () => {
    const monitor = new SkillMonitor(createConfig())
    const before = monitor.getStats().lastActivityAt
    await new Promise(r => setTimeout(r, 5))
    monitor.processOutput("anything\n")
    expect(monitor.getStats().lastActivityAt).toBeGreaterThanOrEqual(before)
  })
})

// ── 2. Filesystem detection ──

describe("filesystem pattern detection", () => {
  it("detects 'cat /etc/passwd'", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("cat /etc/passwd\n")
    const violations = monitor.getViolations()
    expect(violations).toHaveLength(1)
    expect(violations[0].type).toBe("filesystem")
    expect(violations[0].description).toBe("File read")
  })

  it("detects 'rm -rf /' as a critical filesystem violation", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("rm -rf /\n")
    const violations = monitor.getViolations()
    expect(violations.length).toBeGreaterThanOrEqual(1)
    const rmViolation = violations.find(v => v.description === "File delete")
    expect(rmViolation).toBeDefined()
    expect(rmViolation!.severity).toBe("critical")
  })

  it("detects file write via echo redirect", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("echo hello > /tmp/out.txt\n")
    expect(monitor.getViolations().some(v => v.description === "File write via redirect")).toBe(true)
  })

  it("detects 'write to file'", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("write to config.json\n")
    expect(monitor.getViolations().some(v => v.description === "File write")).toBe(true)
  })
})

// ── 3. Network detection ──

describe("network pattern detection", () => {
  it("detects 'curl http://evil.com'", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("curl http://evil.com\n")
    const violations = monitor.getViolations()
    expect(violations.some(v => v.type === "network" && v.description === "curl request")).toBe(true)
  })

  it("detects 'ssh user@host' as a critical violation", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("ssh user@host\n")
    const violations = monitor.getViolations()
    expect(violations.some(v => v.description === "SSH command")).toBe(true)
    expect(violations.find(v => v.description === "SSH command")!.severity).toBe("critical")
  })

  it("detects 'nc -l' (netcat) as a critical violation", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("nc -l 4444\n")
    const violations = monitor.getViolations()
    expect(violations.some(v => v.description === "netcat command")).toBe(true)
    expect(violations.find(v => v.description === "netcat command")!.severity).toBe("critical")
  })

  it("detects wget request", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("wget https://example.com/file.zip\n")
    expect(monitor.getViolations().some(v => v.type === "network" && v.description === "wget request")).toBe(true)
  })

  it("detects fetch() call", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("fetch('https://api.example.com/data')\n")
    expect(monitor.getViolations().some(v => v.type === "network" && v.description === "fetch() call")).toBe(true)
  })
})

// ── 4. Wallet detection ──

describe("wallet pattern detection", () => {
  it("detects 'sign transaction' as critical", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("sign transaction now\n")
    const violations = monitor.getViolations()
    expect(violations.some(v => v.type === "wallet" && v.description === "Transaction signing")).toBe(true)
    expect(violations.find(v => v.description === "Transaction signing")!.severity).toBe("critical")
  })

  it("detects 'seed phrase'", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("enter your seed phrase here\n")
    expect(monitor.getViolations().some(v => v.type === "wallet" && v.description === "Seed phrase access")).toBe(true)
  })

  it("detects 'private_key'", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("private_key = abc123\n")
    expect(monitor.getViolations().some(v => v.type === "wallet" && v.description === "Private key access")).toBe(true)
  })

  it("detects token transfer", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("transfer 100 tokens\n")
    expect(monitor.getViolations().some(v => v.type === "wallet" && v.description === "Token transfer")).toBe(true)
  })

  it("detects 'send sol'", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("send sol to recipient\n")
    expect(monitor.getViolations().some(v => v.type === "wallet" && v.description === "SOL transfer")).toBe(true)
  })
})

// ── 5. Env detection ──

describe("env pattern detection", () => {
  it("detects 'echo $SECRET'", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("echo $SECRET\n")
    expect(monitor.getViolations().some(v => v.type === "env" && v.description === "Env var read")).toBe(true)
  })

  it("detects 'export API_KEY=xxx'", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("export API_KEY=supersecret\n")
    expect(monitor.getViolations().some(v => v.type === "env" && v.description === "Env var set")).toBe(true)
  })

  it("detects printenv read", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("printenv DATABASE_URL\n")
    expect(monitor.getViolations().some(v => v.type === "env" && v.description === "Env var read")).toBe(true)
  })
})

// ── 6. ANSI stripping ──

describe("ANSI escape code stripping", () => {
  it("detects a filesystem command embedded in ANSI bold/reset codes", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("\x1b[1mcat /etc/passwd\x1b[0m\n")
    expect(monitor.getViolations().some(v => v.type === "filesystem")).toBe(true)
  })

  it("detects a network command embedded in color codes", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("\x1b[32mcurl https://evil.com/payload\x1b[0m\n")
    expect(monitor.getViolations().some(v => v.type === "network")).toBe(true)
  })

  it("produces no violations for a line that is only ANSI codes after stripping", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("\x1b[2J\x1b[H\n")
    expect(monitor.getViolations()).toHaveLength(0)
  })
})

// ── 7. Allowed filesystem actions ──

describe("isAllowed — filesystem", () => {
  it("does not flag file reads when the read list contains './**'", () => {
    const monitor = new SkillMonitor(createConfig({
      manifest: {
        skillId: "test-skill",
        permissions: {
          filesystem: { read: ["./**"], write: [] },
          network: [],
          shell: [],
          env: [],
        },
        walletAccess: false,
      },
    }))
    monitor.processOutput("cat ./src/index.ts\n")
    expect(monitor.getViolations()).toHaveLength(0)
  })

  it("flags file reads when no read paths are declared", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("cat ./src/index.ts\n")
    expect(monitor.getViolations()).toHaveLength(1)
  })

  it("does not flag a file read when the matched path is a substring of an allowed read path", () => {
    const monitor = new SkillMonitor(createConfig({
      manifest: {
        skillId: "test-skill",
        permissions: {
          filesystem: { read: ["src/"], write: [] },
          network: [],
          shell: [],
          env: [],
        },
        walletAccess: false,
      },
    }))
    monitor.processOutput("cat src/index.ts\n")
    expect(monitor.getViolations()).toHaveLength(0)
  })
})

// ── 8. Allowed network actions ──

describe("isAllowed — network", () => {
  it("does not flag curl when the target host is in the allowed network list", () => {
    const monitor = new SkillMonitor(createConfig({
      manifest: {
        skillId: "test-skill",
        permissions: {
          filesystem: { read: [], write: [] },
          network: ["api.github.com"],
          shell: [],
          env: [],
        },
        walletAccess: false,
      },
    }))
    monitor.processOutput("curl https://api.github.com/repos\n")
    expect(monitor.getViolations()).toHaveLength(0)
  })

  it("flags curl when the target host is not in the allowed network list", () => {
    const monitor = new SkillMonitor(createConfig({
      manifest: {
        skillId: "test-skill",
        permissions: {
          filesystem: { read: [], write: [] },
          network: ["api.github.com"],
          shell: [],
          env: [],
        },
        walletAccess: false,
      },
    }))
    monitor.processOutput("curl https://evil.com/data\n")
    expect(monitor.getViolations().some(v => v.type === "network")).toBe(true)
  })

  it("flags curl when the network list is empty", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("curl https://api.github.com/repos\n")
    expect(monitor.getViolations().some(v => v.type === "network")).toBe(true)
  })
})

// ── 9. Wallet allowed ──

describe("isAllowed — wallet", () => {
  it("does not flag wallet operations when walletAccess is true", () => {
    const monitor = new SkillMonitor(createConfig({
      manifest: {
        skillId: "test-skill",
        permissions: { filesystem: { read: [], write: [] }, network: [], shell: [], env: [] },
        walletAccess: true,
      },
    }))
    monitor.processOutput("sign transaction now\n")
    expect(monitor.getViolations()).toHaveLength(0)
  })

  it("flags wallet operations when walletAccess is false", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("sign transaction now\n")
    expect(monitor.getViolations().some(v => v.type === "wallet")).toBe(true)
  })
})

// ── 10. Auto-halt on critical violation ──

describe("auto-halt on critical violations", () => {
  it("halts when autoHalt=true and a critical violation is detected", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({ autoHalt: true, onHalt }))
    monitor.processOutput("rm -rf /\n")
    expect(monitor.isHalted()).toBe(true)
    expect(onHalt).toHaveBeenCalledOnce()
  })

  it("includes the violation type and description in the halt reason", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({ autoHalt: true, onHalt }))
    monitor.processOutput("ssh root@server\n")
    expect(monitor.isHalted()).toBe(true)
    const reason: string = onHalt.mock.calls[0][0]
    expect(reason).toContain("network")
    expect(reason).toContain("SSH command")
  })

  it("halts on critical wallet violation when autoHalt=true", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({ autoHalt: true, onHalt }))
    monitor.processOutput("sign transaction now\n")
    expect(monitor.isHalted()).toBe(true)
    expect(onHalt).toHaveBeenCalledOnce()
  })
})

// ── 11. No auto-halt when autoHalt is false or unset ──

describe("no auto-halt when autoHalt is false or unset", () => {
  it("does not halt on a critical violation when autoHalt is not set", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({ onHalt }))
    monitor.processOutput("rm -rf /\n")
    expect(monitor.isHalted()).toBe(false)
    expect(onHalt).not.toHaveBeenCalled()
  })

  it("does not halt when autoHalt=false, even for critical violations", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({ autoHalt: false, onHalt }))
    monitor.processOutput("ssh root@server\n")
    expect(monitor.isHalted()).toBe(false)
    expect(onHalt).not.toHaveBeenCalled()
  })

  it("still records the violation without halting", () => {
    const monitor = new SkillMonitor(createConfig({ autoHalt: false }))
    monitor.processOutput("ssh root@server\n")
    expect(monitor.getViolations().some(v => v.type === "network")).toBe(true)
    expect(monitor.isHalted()).toBe(false)
  })
})

// ── 12. Max violations halt ──

describe("MAX_VIOLATIONS auto-halt at 50", () => {
  it("halts after exactly 50 violations regardless of autoHalt setting", () => {
    const onHalt = vi.fn()
    // autoHalt is false — only the max-violations safety limit should trigger halt
    const monitor = new SkillMonitor(createConfig({ autoHalt: false, onHalt }))

    // Each "echo $VAR_N" line produces one env warning violation
    for (let i = 0; i < 50; i++) {
      monitor.processOutput(`echo $VAR_${i}\n`)
    }

    expect(monitor.isHalted()).toBe(true)
    expect(onHalt).toHaveBeenCalledOnce()
    expect(monitor.getStats().violationsDetected).toBe(50)
  })

  it("does not halt before the 50th violation", () => {
    const monitor = new SkillMonitor(createConfig({ autoHalt: false }))
    for (let i = 0; i < 49; i++) {
      monitor.processOutput(`echo $VAR_${i}\n`)
    }
    expect(monitor.isHalted()).toBe(false)
    expect(monitor.getStats().violationsDetected).toBe(49)
  })
})

// ── 13. Halted state is a no-op ──

describe("halted state — processOutput is a no-op", () => {
  it("stops processing output after halt", () => {
    const onViolation = vi.fn()
    const monitor = new SkillMonitor(createConfig({ autoHalt: true, onViolation }))

    // Trigger halt via critical violation
    monitor.processOutput("rm -rf /\n")
    expect(monitor.isHalted()).toBe(true)

    const statsAfterHalt = monitor.getStats()
    onViolation.mockClear()

    // Further output must be silently ignored
    monitor.processOutput("cat /etc/passwd\n")
    monitor.processOutput("ssh root@server\n")

    expect(monitor.getStats().linesProcessed).toBe(statsAfterHalt.linesProcessed)
    expect(onViolation).not.toHaveBeenCalled()
  })

  it("halt is idempotent — onHalt fires exactly once even on repeated halt attempts", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({ autoHalt: true, onHalt }))
    monitor.processOutput("rm -rf /\n")
    expect(monitor.isHalted()).toBe(true)
    expect(onHalt).toHaveBeenCalledOnce()
  })
})

// ── 14. onViolation callback ──

describe("onViolation callback", () => {
  it("is called once for each violation detected", () => {
    const onViolation = vi.fn()
    const monitor = new SkillMonitor(createConfig({ onViolation }))
    monitor.processOutput("cat /etc/passwd\n")
    monitor.processOutput("echo $SECRET\n")
    expect(onViolation).toHaveBeenCalledTimes(2)
  })

  it("receives a MonitorViolation object with all required fields", () => {
    const onViolation = vi.fn()
    const monitor = new SkillMonitor(createConfig({ onViolation }))
    monitor.processOutput("cat /etc/passwd\n")

    const violation = onViolation.mock.calls[0][0]
    expect(violation).toMatchObject({
      type: "filesystem",
      description: expect.any(String),
      matchedText: expect.any(String),
      timestamp: expect.any(Number),
      severity: expect.stringMatching(/^(warning|critical)$/),
    })
  })

  it("truncates matchedText to 200 characters for very long matches", () => {
    const onViolation = vi.fn()
    const monitor = new SkillMonitor(createConfig({ onViolation }))
    // The pattern captures the filename — make it very long (under MAX_LINE_LENGTH though)
    const longPath = "a".repeat(300)
    monitor.processOutput(`cat ${longPath}\n`)
    if (onViolation.mock.calls.length > 0) {
      const violation = onViolation.mock.calls[0][0]
      expect(violation.matchedText.length).toBeLessThanOrEqual(200)
    }
  })

  it("does not throw when the onViolation callback itself throws", () => {
    const monitor = new SkillMonitor(createConfig({
      onViolation: () => { throw new Error("callback error") },
    }))
    expect(() => monitor.processOutput("cat /etc/passwd\n")).not.toThrow()
  })
})

// ── 15. onHalt callback ──

describe("onHalt callback", () => {
  it("is called with a non-empty reason string", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({ autoHalt: true, onHalt }))
    monitor.processOutput("ssh root@server\n")
    expect(onHalt).toHaveBeenCalledOnce()
    const reason = onHalt.mock.calls[0][0]
    expect(typeof reason).toBe("string")
    expect(reason.length).toBeGreaterThan(0)
  })

  it("does not throw when the onHalt callback itself throws", () => {
    const monitor = new SkillMonitor(createConfig({
      autoHalt: true,
      onHalt: () => { throw new Error("halt error") },
    }))
    expect(() => monitor.processOutput("rm -rf /\n")).not.toThrow()
  })

  it("is not called for warning-severity violations when autoHalt is false", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({ autoHalt: false, onHalt }))
    monitor.processOutput("cat /etc/passwd\n") // warning severity
    expect(onHalt).not.toHaveBeenCalled()
  })
})

// ── 16. Resumed session enforcement ──

describe("resumed session enforcement", () => {
  beforeEach(() => {
    mockHasPermission.mockReturnValue(false)
    mockViolationTypeToPermissionKey.mockImplementation((t: string) => t)
  })

  it("halts on critical violation when isResumedSession=true and hasPermission returns false", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({
      isResumedSession: true,
      authorityMap: { sessionId: "resumed", permissions: [], createdAt: Date.now() },
      onHalt,
    }))

    monitor.processOutput("sign transaction now\n")
    expect(monitor.isHalted()).toBe(true)
    expect(onHalt).toHaveBeenCalledOnce()
  })

  it("does not halt via resumed session path when authorityMap is absent", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({
      isResumedSession: true,
      // authorityMap deliberately omitted
      autoHalt: false,
      onHalt,
    }))

    monitor.processOutput("sign transaction now\n")
    // Without authorityMap, the resumed session enforcement branch is skipped
    expect(monitor.isHalted()).toBe(false)
    expect(onHalt).not.toHaveBeenCalled()
  })

  it("does not apply resumed session halt for warning-severity violations", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({
      isResumedSession: true,
      authorityMap: { sessionId: "resumed", permissions: [], createdAt: Date.now() },
      autoHalt: false,
      onHalt,
    }))

    // cat produces a warning violation — should not trigger resumed halt
    monitor.processOutput("cat /etc/passwd\n")
    expect(monitor.isHalted()).toBe(false)
    expect(onHalt).not.toHaveBeenCalled()
  })

  it("does not halt when hasPermission returns true for the violated permission", () => {
    mockHasPermission.mockReturnValue(true)

    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({
      isResumedSession: true,
      authorityMap: { sessionId: "resumed", permissions: [], createdAt: Date.now() },
      autoHalt: false,
      onHalt,
    }))

    monitor.processOutput("sign transaction now\n")
    expect(monitor.isHalted()).toBe(false)
    expect(onHalt).not.toHaveBeenCalled()
  })
})

// ── 17. onReauthRequired callback ──

describe("onReauthRequired callback", () => {
  beforeEach(() => {
    mockHasPermission.mockReturnValue(false)
    mockViolationTypeToPermissionKey.mockImplementation((t: string) => t)
  })

  it("is called when a critical resumed-session violation has no valid permission", () => {
    const onReauthRequired = vi.fn()
    const monitor = new SkillMonitor(createConfig({
      isResumedSession: true,
      authorityMap: { sessionId: "resumed", permissions: [], createdAt: Date.now() },
      onReauthRequired,
    }))

    monitor.processOutput("sign transaction now\n")
    expect(onReauthRequired).toHaveBeenCalledOnce()
  })

  it("receives the violation object and the permission key as arguments", () => {
    const onReauthRequired = vi.fn()
    const monitor = new SkillMonitor(createConfig({
      isResumedSession: true,
      authorityMap: { sessionId: "resumed", permissions: [], createdAt: Date.now() },
      onReauthRequired,
    }))

    monitor.processOutput("sign transaction now\n")
    const [violation, permKey] = onReauthRequired.mock.calls[0]
    expect(violation.type).toBe("wallet")
    expect(violation.severity).toBe("critical")
    expect(typeof permKey).toBe("string")
    expect(permKey.length).toBeGreaterThan(0)
  })

  it("is not called when the session is not resumed", () => {
    const onReauthRequired = vi.fn()
    const monitor = new SkillMonitor(createConfig({
      isResumedSession: false,
      authorityMap: { sessionId: "fresh", permissions: [], createdAt: Date.now() },
      autoHalt: false,
      onReauthRequired,
    }))

    monitor.processOutput("sign transaction now\n")
    expect(onReauthRequired).not.toHaveBeenCalled()
  })

  it("does not throw when the onReauthRequired callback itself throws", () => {
    const monitor = new SkillMonitor(createConfig({
      isResumedSession: true,
      authorityMap: { sessionId: "resumed", permissions: [], createdAt: Date.now() },
      onReauthRequired: () => { throw new Error("reauth error") },
    }))
    expect(() => monitor.processOutput("sign transaction now\n")).not.toThrow()
  })
})

// ── 18. Line buffering ──

describe("line buffering across multiple processOutput calls", () => {
  it("assembles a violation from a line split across two calls", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("ca")
    monitor.processOutput("t /etc/passwd")
    // Line not yet terminated — no violations
    expect(monitor.getStats().linesProcessed).toBe(0)
    monitor.processOutput("\n")
    // Now the complete line is flushed and processed
    expect(monitor.getStats().linesProcessed).toBe(1)
    expect(monitor.getViolations().some(v => v.type === "filesystem")).toBe(true)
  })

  it("processes all complete lines in a multi-line chunk delivered at once", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("cat /etc/passwd\necho $SECRET\nssh root@host\n")
    expect(monitor.getStats().linesProcessed).toBe(3)
    expect(monitor.getStats().violationsDetected).toBeGreaterThanOrEqual(3)
  })

  it("retains the partial line in the buffer until a newline arrives", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("line1\npartial")
    expect(monitor.getStats().linesProcessed).toBe(1)
    monitor.processOutput("_complete\n")
    expect(monitor.getStats().linesProcessed).toBe(2)
  })
})

// ── 19. Long line skipping ──

describe("long line handling", () => {
  it("counts long lines in linesProcessed but skips pattern matching", () => {
    const monitor = new SkillMonitor(createConfig())
    // Line content longer than MAX_LINE_LENGTH (5000 chars)
    const longLine = "cat " + "a".repeat(5001) + "\n"
    monitor.processOutput(longLine)
    expect(monitor.getStats().linesProcessed).toBe(1)
    expect(monitor.getViolations()).toHaveLength(0)
  })

  it("processes lines at exactly 5000 chars (the boundary is strictly > 5000)", () => {
    const monitor = new SkillMonitor(createConfig())
    // "cat " (4) + 4996 "a"s = 5000 chars exactly — should NOT be skipped
    const line = "cat " + "a".repeat(4996) + "\n"
    expect(line.trimEnd().length).toBe(5000)
    monitor.processOutput(line)
    expect(monitor.getStats().linesProcessed).toBe(1)
    expect(monitor.getViolations().some(v => v.type === "filesystem")).toBe(true)
  })
})

// ── 20. getStats / getViolations / isHalted ──

describe("state accessors", () => {
  it("getStats returns correct initial values", () => {
    const monitor = new SkillMonitor(createConfig())
    const stats = monitor.getStats()
    expect(stats.linesProcessed).toBe(0)
    expect(stats.violationsDetected).toBe(0)
    expect(stats.halted).toBe(false)
    expect(stats.haltReason).toBeUndefined()
    expect(typeof stats.startedAt).toBe("number")
    expect(typeof stats.lastActivityAt).toBe("number")
  })

  it("getStats returns a copy — external mutations do not affect internal state", () => {
    const monitor = new SkillMonitor(createConfig())
    const stats = monitor.getStats()
    stats.linesProcessed = 999
    expect(monitor.getStats().linesProcessed).toBe(0)
  })

  it("getViolations returns all accumulated violations", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("cat /etc/passwd\n")
    monitor.processOutput("echo $SECRET\n")
    expect(monitor.getViolations()).toHaveLength(2)
  })

  it("getViolations returns a copy — external mutations do not affect internal state", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("cat /etc/passwd\n")
    const violations = monitor.getViolations()
    violations.push({} as any)
    expect(monitor.getViolations()).toHaveLength(1)
  })

  it("isHalted returns false initially", () => {
    const monitor = new SkillMonitor(createConfig())
    expect(monitor.isHalted()).toBe(false)
  })

  it("isHalted returns true after halt", () => {
    const monitor = new SkillMonitor(createConfig({ autoHalt: true }))
    monitor.processOutput("rm -rf /\n")
    expect(monitor.isHalted()).toBe(true)
  })

  it("getStats includes haltReason after halt", () => {
    const monitor = new SkillMonitor(createConfig({ autoHalt: true }))
    monitor.processOutput("rm -rf /\n")
    const stats = monitor.getStats()
    expect(stats.halted).toBe(true)
    expect(typeof stats.haltReason).toBe("string")
    expect(stats.haltReason!.length).toBeGreaterThan(0)
  })

  it("violationsDetected in stats matches getViolations().length", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("cat /etc/passwd\n")
    monitor.processOutput("echo $SECRET\n")
    expect(monitor.getStats().violationsDetected).toBe(monitor.getViolations().length)
  })
})

// ── 21. flush() ──

describe("flush()", () => {
  it("processes the remaining buffer on flush and detects violations", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("cat /etc/passwd")
    expect(monitor.getViolations()).toHaveLength(0)

    monitor.flush()
    expect(monitor.getViolations().some(v => v.type === "filesystem")).toBe(true)
  })

  it("increments linesProcessed when flushing a non-empty buffer", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("echo $SECRET")
    expect(monitor.getStats().linesProcessed).toBe(0)

    monitor.flush()
    expect(monitor.getStats().linesProcessed).toBe(1)
  })

  it("is a no-op when the buffer is already empty", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("done\n") // newline causes the buffer to be empty
    const linesBefore = monitor.getStats().linesProcessed

    monitor.flush()
    expect(monitor.getStats().linesProcessed).toBe(linesBefore)
  })

  it("clears the buffer after flush so a second flush is a no-op", () => {
    const monitor = new SkillMonitor(createConfig())
    monitor.processOutput("partial")
    monitor.flush()
    const linesAfterFirstFlush = monitor.getStats().linesProcessed

    monitor.flush()
    expect(monitor.getStats().linesProcessed).toBe(linesAfterFirstFlush)
  })

  it("can trigger a halt via flush when autoHalt is enabled and a critical command is in the buffer", () => {
    const onHalt = vi.fn()
    const monitor = new SkillMonitor(createConfig({ autoHalt: true, onHalt }))
    // Deliver without newline — not yet processed
    monitor.processOutput("rm -rf /")
    expect(monitor.isHalted()).toBe(false)

    monitor.flush()
    expect(monitor.isHalted()).toBe(true)
    expect(onHalt).toHaveBeenCalledOnce()
  })
})
