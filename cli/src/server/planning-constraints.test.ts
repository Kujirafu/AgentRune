/**
 * Integration tests for planning-constraints.ts
 * Tests how sandbox, authority-map, and standards merge into a unified constraint set.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildPlanningConstraints, formatConstraintsForPrompt } from "./planning-constraints.js"
import { createFromTrustProfile, grantPermission, inheritForResume } from "./authority-map.js"
import { createManifestForLevel } from "./skill-manifest.js"

// Mock standards-loader since it requires filesystem
vi.mock("./standards-loader.js", () => ({
  loadStandards: () => ({
    categories: [
      {
        name: "security",
        rules: [
          { id: "SEC-001", title: "No hardcoded secrets", description: "Never commit API keys", severity: "error", enabled: true },
          { id: "SEC-002", title: "HTTPS only", description: "Use HTTPS for all external requests", severity: "warning", enabled: true },
          { id: "SEC-003", title: "Disabled rule", description: "This is disabled", severity: "error", enabled: false },
        ],
      },
    ],
  }),
  generateStandardsPrompt: () => "Standards prompt text",
}))

describe("buildPlanningConstraints integration", () => {
  describe("sandbox level constraints", () => {
    it("strict sandbox generates filesystem, network, shell, wallet constraints", () => {
      const result = buildPlanningConstraints({ sandboxLevel: "strict" })
      const refs = result.constraints.map(c => c.ref)
      expect(refs).toContain("filesystem.write")
      expect(refs).toContain("network")
      expect(refs).toContain("shell")
      expect(refs).toContain("wallet")
    })

    it("none sandbox generates no sandbox constraints", () => {
      const result = buildPlanningConstraints({ sandboxLevel: "none" })
      const sandboxConstraints = result.constraints.filter(c => c.source === "sandbox")
      expect(sandboxConstraints).toHaveLength(0)
    })

    it("moderate sandbox allows filesystem write but blocks network", () => {
      const result = buildPlanningConstraints({ sandboxLevel: "moderate" })
      const refs = result.constraints.filter(c => c.source === "sandbox").map(c => c.ref)
      expect(refs).not.toContain("filesystem.write")
      expect(refs).toContain("network")
    })

    it("permissive sandbox allows network but restricts shell to specific commands", () => {
      const result = buildPlanningConstraints({ sandboxLevel: "permissive" })
      const sandboxConstraints = result.constraints.filter(c => c.source === "sandbox")
      const networkConstraint = sandboxConstraints.find(c => c.ref === "network")
      expect(networkConstraint).toBeUndefined() // permissive has network: ["*"]
      const shellConstraint = sandboxConstraints.find(c => c.ref === "shell")
      expect(shellConstraint?.severity).toBe("warning") // restricted, not blocked
    })
  })

  describe("authority map integration", () => {
    it("denied permissions generate error constraints", () => {
      const authMap = createFromTrustProfile({
        sessionId: "test-session",
        sandboxLevel: "strict",
        requireMergeApproval: true,
      })
      const result = buildPlanningConstraints({
        sandboxLevel: "strict",
        authorityMap: authMap,
      })
      const authorityConstraints = result.constraints.filter(c => c.source === "authority")
      expect(authorityConstraints.length).toBeGreaterThan(0)
      const mergeConstraint = authorityConstraints.find(c => c.ref === "merge")
      expect(mergeConstraint).toBeDefined()
      expect(mergeConstraint!.severity).toBe("error")
    })

    it("inherited permissions generate info constraints", () => {
      const original = createFromTrustProfile({
        sessionId: "original",
        sandboxLevel: "none",
      })
      const inherited = inheritForResume(original, "new-session")
      const result = buildPlanningConstraints({
        sandboxLevel: "none",
        authorityMap: inherited,
      })
      const infos = result.constraints.filter(c => c.severity === "info")
      expect(infos.length).toBeGreaterThan(0)
      infos.forEach(info => {
        expect(info.description.toLowerCase()).toContain("inherited")
      })
    })

    it("granted non-inherited permissions do not generate constraints", () => {
      const authMap = createFromTrustProfile({
        sessionId: "test",
        sandboxLevel: "none",
      })
      const result = buildPlanningConstraints({
        sandboxLevel: "none",
        authorityMap: authMap,
      })
      const authorityErrors = result.constraints.filter(c => c.source === "authority" && c.severity === "error")
      expect(authorityErrors).toHaveLength(0)
    })
  })

  describe("standards integration", () => {
    it("includes enabled error-level standard rules", () => {
      const result = buildPlanningConstraints({ sandboxLevel: "none" })
      const standardConstraints = result.constraints.filter(c => c.source === "standard")
      expect(standardConstraints).toHaveLength(1)
      expect(standardConstraints[0].ref).toBe("SEC-001")
    })

    it("excludes disabled rules", () => {
      const result = buildPlanningConstraints({ sandboxLevel: "none" })
      const disabled = result.constraints.find(c => c.ref === "SEC-003")
      expect(disabled).toBeUndefined()
    })

    it("excludes warning-level rules from hard constraints", () => {
      const result = buildPlanningConstraints({ sandboxLevel: "none" })
      const sec002 = result.constraints.find(c => c.ref === "SEC-002")
      expect(sec002).toBeUndefined()
    })

    it("includes standardsPrompt in result", () => {
      const result = buildPlanningConstraints({ sandboxLevel: "none" })
      expect(result.standardsPrompt).toBe("Standards prompt text")
    })
  })

  describe("combined constraints", () => {
    it("strict sandbox + guarded trust profile generates many constraints", () => {
      const authMap = createFromTrustProfile({
        sessionId: "test",
        sandboxLevel: "strict",
        requirePlanReview: true,
        requireMergeApproval: true,
      })
      const result = buildPlanningConstraints({
        sandboxLevel: "strict",
        authorityMap: authMap,
        trustProfile: "guarded",
      })
      expect(result.constraints.length).toBeGreaterThan(5)
      expect(result.sandboxLevel).toBe("strict")
      expect(result.trustProfile).toBe("guarded")
    })

    it("result includes sandboxInstructions", () => {
      const result = buildPlanningConstraints({ sandboxLevel: "strict" })
      expect(result.sandboxInstructions).toContain("SECURITY SCOPE")
    })

    it("custom manifest overrides sandbox level", () => {
      const manifest = createManifestForLevel("custom", "permissive")
      const result = buildPlanningConstraints({
        sandboxLevel: "strict", // this would normally be strict
        manifest, // but this permissive manifest overrides
      })
      // With permissive manifest, filesystem.write should be allowed
      const fsWrite = result.constraints.find(c => c.ref === "filesystem.write" && c.source === "sandbox")
      expect(fsWrite).toBeUndefined()
    })
  })
})

describe("formatConstraintsForPrompt", () => {
  it("returns empty string when no constraints", () => {
    const result = formatConstraintsForPrompt({
      constraints: [],
      sandboxLevel: "none",
    })
    expect(result).toBe("")
  })

  it("formats error constraints under MUST NOT section", () => {
    const result = formatConstraintsForPrompt({
      constraints: [{
        source: "sandbox",
        severity: "error",
        title: "No network",
        description: "Network blocked",
      }],
      sandboxLevel: "strict",
    })
    expect(result).toContain("MUST NOT violate")
    expect(result).toContain("No network")
  })

  it("formats warning constraints under Should consider section", () => {
    const result = formatConstraintsForPrompt({
      constraints: [{
        source: "sandbox",
        severity: "warning",
        title: "Restricted shell",
        description: "Limited commands",
      }],
      sandboxLevel: "moderate",
    })
    expect(result).toContain("Should consider")
    expect(result).toContain("Restricted shell")
  })

  it("formats info constraints under Note section", () => {
    const result = formatConstraintsForPrompt({
      constraints: [{
        source: "authority",
        severity: "info",
        title: "network (inherited)",
        description: "Inherited from previous session",
      }],
      sandboxLevel: "none",
    })
    expect(result).toContain("Note")
    expect(result).toContain("inherited")
  })

  it("includes all three sections when mixed severities", () => {
    const result = formatConstraintsForPrompt({
      constraints: [
        { source: "sandbox", severity: "error", title: "E", description: "error" },
        { source: "sandbox", severity: "warning", title: "W", description: "warning" },
        { source: "authority", severity: "info", title: "I", description: "info" },
      ],
      sandboxLevel: "strict",
    })
    expect(result).toContain("MUST NOT violate")
    expect(result).toContain("Should consider")
    expect(result).toContain("Note")
  })
})
