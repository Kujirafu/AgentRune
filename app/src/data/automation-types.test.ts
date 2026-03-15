import { describe, it, expect } from "vitest"
import { TRUST_PROFILE_PRESETS, type TrustProfileConfig, type SandboxLevel } from "./automation-types"

describe("TRUST_PROFILE_PRESETS", () => {
  it("has three presets: autonomous, supervised, guarded", () => {
    expect(Object.keys(TRUST_PROFILE_PRESETS)).toEqual(["autonomous", "supervised", "guarded"])
  })

  describe("autonomous", () => {
    const preset = TRUST_PROFILE_PRESETS.autonomous

    it("has no sandbox", () => {
      expect(preset.sandboxLevel).toBe("none")
    })

    it("does not require plan review", () => {
      expect(preset.requirePlanReview).toBe(false)
    })

    it("does not require merge approval", () => {
      expect(preset.requireMergeApproval).toBe(false)
    })

    it("has unlimited daily runs", () => {
      expect(preset.dailyRunLimit).toBe(0)
    })
  })

  describe("supervised", () => {
    const preset = TRUST_PROFILE_PRESETS.supervised

    it("has moderate sandbox", () => {
      expect(preset.sandboxLevel).toBe("moderate")
    })

    it("has a daily run limit", () => {
      expect(preset.dailyRunLimit).toBeGreaterThan(0)
    })
  })

  describe("guarded", () => {
    const preset = TRUST_PROFILE_PRESETS.guarded

    it("has strict sandbox", () => {
      expect(preset.sandboxLevel).toBe("strict")
    })

    it("requires plan review", () => {
      expect(preset.requirePlanReview).toBe(true)
    })

    it("requires merge approval", () => {
      expect(preset.requireMergeApproval).toBe(true)
    })

    it("has the lowest daily run limit", () => {
      expect(preset.dailyRunLimit).toBeLessThanOrEqual(TRUST_PROFILE_PRESETS.supervised.dailyRunLimit)
    })
  })

  it("all presets have valid sandbox levels", () => {
    const validLevels: SandboxLevel[] = ["strict", "moderate", "permissive", "none"]
    for (const preset of Object.values(TRUST_PROFILE_PRESETS)) {
      expect(validLevels).toContain(preset.sandboxLevel)
    }
  })

  it("all presets have non-negative numeric fields", () => {
    for (const preset of Object.values(TRUST_PROFILE_PRESETS)) {
      expect(preset.dailyRunLimit).toBeGreaterThanOrEqual(0)
      expect(preset.planReviewTimeoutMinutes).toBeGreaterThanOrEqual(0)
    }
  })
})
