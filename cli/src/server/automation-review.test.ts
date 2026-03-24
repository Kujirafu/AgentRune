import { describe, expect, it } from "vitest"
import {
  estimatePhaseGateReviewMs,
  estimateReauthReviewMs,
  summarizeReviewDecision,
} from "./automation-review.js"

describe("automation-review helpers", () => {
  it("estimates a non-trivial phase gate review floor", () => {
    const ms = estimatePhaseGateReviewMs([
      { roleName: "Planner", outputSummary: "Inspect code paths, compare risk, propose two rollout options." },
      { roleName: "Reviewer", outputSummary: "Found one regression risk in the auth flow and one missing test." },
    ])
    expect(ms).toBeGreaterThanOrEqual(6000)
  })

  it("uses a shorter review floor for reauth prompts", () => {
    const ms = estimateReauthReviewMs("filesystem.write", "Agent wants to edit production config files.")
    expect(ms).toBeGreaterThanOrEqual(5000)
    expect(ms).toBeLessThanOrEqual(45000)
  })

  it("flags decisions that happened below the review floor", () => {
    expect(summarizeReviewDecision({
      requestedAt: 1000,
      resolvedAt: 3500,
      estimatedReviewMs: 5000,
      reviewNote: "Checked scope first",
    })).toEqual({
      decisionLatencyMs: 2500,
      estimatedReviewMs: 5000,
      belowReviewFloor: true,
      reviewNote: "Checked scope first",
      reviewNoteProvided: true,
    })
  })
})
