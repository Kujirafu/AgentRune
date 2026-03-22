import { describe, expect, it } from "vitest"
import type { AgentEvent } from "../shared/types.js"
import {
  buildProjectSummaryResponse,
  buildSessionDigest,
  selectRecommendedSession,
} from "./project-summary.js"

function makeEvent(partial: Partial<AgentEvent> & Pick<AgentEvent, "id" | "timestamp" | "type" | "status" | "title">): AgentEvent {
  return {
    detail: "",
    ...partial,
  }
}

describe("project-summary", () => {
  it("ignores planning boilerplate and uses the meaningful progress summary", () => {
    const digest = buildSessionDigest("session-a", "codex", [
      makeEvent({
        id: "r1",
        timestamp: 100,
        type: "response",
        status: "in_progress",
        title: "I'll inspect the summary cache and patch the homepage cards.",
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
          summary: "Homepage summaries now focus on blockers, results, and next steps instead of conversation openers.",
          nextSteps: ["Verify which session the homepage recommends after a daemon restart."],
        },
      }),
    ], "en")

    expect(digest.summary).toContain("Homepage summaries now focus on blockers")
    expect(digest.nextAction).toContain("Verify which session")
  })

  it("recommends the blocked session first", () => {
    const blockedEvents = [
      makeEvent({
        id: "d1",
        timestamp: 100,
        type: "decision_request",
        status: "waiting",
        title: "Need approval to merge the watchdog fix",
        detail: "Need approval to merge the watchdog fix into dev",
      }),
    ]
    const doneEvents = [
      makeEvent({
        id: "p2",
        timestamp: 140,
        type: "progress_report",
        status: "completed",
        title: "CLI publish ready",
        progress: {
          title: "CLI publish ready",
          status: "done",
          summary: "CLI tests passed and publish artifacts are ready.",
          nextSteps: [],
        },
      }),
    ]
    const blocked = buildSessionDigest("blocked", "claude", blockedEvents, "en")
    const done = buildSessionDigest("done", "codex", doneEvents, "en")

    expect(selectRecommendedSession([done, blocked])?.sessionId).toBe("blocked")

    const project = buildProjectSummaryResponse([
      { sessionId: blocked.sessionId, agentId: blocked.agentId, events: blockedEvents },
      { sessionId: done.sessionId, agentId: done.agentId, events: doneEvents },
    ], "en")

    expect(project.recommendedSessionId).toBe("blocked")
    expect(project.summary).toContain("Need approval")
  })

  it("builds a project summary from structured digests", () => {
    const response = buildProjectSummaryResponse([
      {
        sessionId: "session-a",
        agentId: "codex",
        events: [
          makeEvent({
            id: "d1",
            timestamp: 100,
            type: "decision_request",
            status: "waiting",
            title: "Need approval to ship the app release",
            detail: "Need approval to ship the app release to GitHub Releases",
          }),
        ],
      },
      {
        sessionId: "session-b",
        agentId: "claude",
        events: [
          makeEvent({
            id: "p3",
            timestamp: 90,
            type: "progress_report",
            status: "in_progress",
            title: "Schedule report UI",
            progress: {
              title: "Schedule report UI",
              status: "in_progress",
              summary: "Report markdown now renders in a single readable document.",
              nextSteps: ["Check dark mode colors on mobile."],
            },
          }),
        ],
      },
    ], "en")

    expect(response.recommendedSessionId).toBe("session-a")
    expect(response.summary).toContain("codex")
    expect(response.sessions).toHaveLength(2)
  })
})
