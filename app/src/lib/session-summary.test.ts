import { describe, expect, it } from "vitest"
import type { AgentEvent } from "../types"
import {
  buildProjectDecisionSummary,
  buildProjectSummarySignature,
  buildSessionDigest,
  isSummaryNoise,
  selectRecommendedSession,
} from "./session-summary"

function makeEvent(partial: Partial<AgentEvent> & Pick<AgentEvent, "id" | "timestamp" | "type" | "status" | "title">): AgentEvent {
  return {
    detail: "",
    ...partial,
  }
}

describe("session-summary", () => {
  it("filters planning boilerplate and keeps the useful result", () => {
    const digest = buildSessionDigest([
      makeEvent({
        id: "r1",
        timestamp: 100,
        type: "response",
        status: "in_progress",
        title: "I'll inspect the summary cache and patch the fetch logic first.",
      }),
      makeEvent({
        id: "p1",
        timestamp: 200,
        type: "progress_report",
        status: "completed",
        title: "Summary fixed",
        progress: {
          title: "Summary fixed",
          status: "done",
          summary: "Fixed summary cache invalidation and now it refreshes when a session meaningfully changes.",
          nextSteps: ["Run the homepage smoke test and verify the right session is recommended."],
        },
      }),
    ], { locale: "en", sessionId: "s1" })

    expect(digest.summary).toContain("Fixed summary cache invalidation")
    expect(digest.nextAction).toContain("Run the homepage smoke test")
    expect(isSummaryNoise("I'll inspect the summary cache and patch the fetch logic first.")).toBe(true)
  })

  it("marks waiting decisions as the highest-priority session to resume", () => {
    const blocked = buildSessionDigest([
      makeEvent({
        id: "d1",
        timestamp: 100,
        type: "decision_request",
        status: "waiting",
        title: "Need approval to merge the watchdog fix",
        detail: "Need approval to merge the watchdog fix into dev",
      }),
    ], { locale: "en", sessionId: "blocked", displayLabel: "Codex watchdog" })

    const done = buildSessionDigest([
      makeEvent({
        id: "p2",
        timestamp: 150,
        type: "progress_report",
        status: "completed",
        title: "Tests passed",
        progress: {
          title: "Tests passed",
          status: "done",
          summary: "All smoke tests passed after the daemon restart.",
          nextSteps: [],
        },
      }),
    ], { locale: "en", sessionId: "done", displayLabel: "Claude smoke" })

    const recommended = selectRecommendedSession([done, blocked])
    expect(recommended?.sessionId).toBe("blocked")

    const summary = buildProjectDecisionSummary([done, blocked], "en")
    expect(summary).toContain("Codex watchdog")
    expect(summary).toContain("Need approval")
  })

  it("builds a stable signature when only noisy events change", () => {
    const baseDigest = buildSessionDigest([
      makeEvent({
        id: "p3",
        timestamp: 100,
        type: "progress_report",
        status: "in_progress",
        title: "Homepage summary",
        progress: {
          title: "Homepage summary",
          status: "in_progress",
          summary: "Reworked the homepage digest to focus on blockers, results, and next steps.",
          nextSteps: ["Verify the project recommendation card on mobile."],
        },
      }),
    ], { locale: "en", sessionId: "session-a" })

    const noisyDigest = buildSessionDigest([
      makeEvent({
        id: "p3",
        timestamp: 100,
        type: "progress_report",
        status: "in_progress",
        title: "Homepage summary",
        progress: {
          title: "Homepage summary",
          status: "in_progress",
          summary: "Reworked the homepage digest to focus on blockers, results, and next steps.",
          nextSteps: ["Verify the project recommendation card on mobile."],
        },
      }),
      makeEvent({
        id: "r2",
        timestamp: 200,
        type: "response",
        status: "in_progress",
        title: "Thinking...",
      }),
    ], { locale: "en", sessionId: "session-a" })

    expect(buildProjectSummarySignature([baseDigest])).toBe(buildProjectSummarySignature([noisyDigest]))
  })
})
