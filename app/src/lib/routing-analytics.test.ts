import { describe, it, expect, beforeEach } from "vitest"
import { RoutingAnalytics } from "./routing-analytics"

describe("RoutingAnalytics", () => {
  let analytics: RoutingAnalytics

  beforeEach(() => {
    analytics = new RoutingAnalytics()
    localStorage.removeItem("agentrune_routing_analytics")
  })

  it("records a routing event", () => {
    analytics.record({
      command: "fix auth",
      proposedSessionId: "s1",
      actualSessionId: "s1",
      wasOverridden: false,
    })
    expect(analytics.getEvents()).toHaveLength(1)
  })

  it("tracks overrides as misroutes", () => {
    analytics.record({
      command: "update docs",
      proposedSessionId: "s1",
      actualSessionId: "s2",
      wasOverridden: true,
    })
    const misroutes = analytics.getMisroutes()
    expect(misroutes).toHaveLength(1)
    expect(misroutes[0].command).toBe("update docs")
  })

  it("caps at max events", () => {
    for (let i = 0; i < 200; i++) {
      analytics.record({ command: `cmd ${i}`, proposedSessionId: "s1", actualSessionId: "s1", wasOverridden: false })
    }
    expect(analytics.getEvents().length).toBeLessThanOrEqual(100)
  })

  it("calculates accuracy rate", () => {
    analytics.record({ command: "a", proposedSessionId: "s1", actualSessionId: "s1", wasOverridden: false })
    analytics.record({ command: "b", proposedSessionId: "s1", actualSessionId: "s2", wasOverridden: true })
    expect(analytics.getAccuracyRate()).toBe(0.5)
  })

  it("learns from override and suggests correct session next time", () => {
    analytics.record({ command: "update docs", proposedSessionId: "s1", actualSessionId: "s2", wasOverridden: true })
    const suggestion = analytics.getSuggestion("update docs")
    expect(suggestion).toBe("s2")
  })

  it("learns from multiple overrides and picks most frequent", () => {
    analytics.record({ command: "fix css", proposedSessionId: "s1", actualSessionId: "s3", wasOverridden: true })
    analytics.record({ command: "fix css", proposedSessionId: "s1", actualSessionId: "s3", wasOverridden: true })
    analytics.record({ command: "fix css", proposedSessionId: "s1", actualSessionId: "s2", wasOverridden: true })
    expect(analytics.getSuggestion("fix css")).toBe("s3")
  })

  it("persists learned routes to localStorage", () => {
    analytics.record({ command: "deploy", proposedSessionId: "s1", actualSessionId: "s2", wasOverridden: true })
    analytics.save()
    const loaded = RoutingAnalytics.load()
    expect(loaded.getSuggestion("deploy")).toBe("s2")
  })

  it("returns null suggestion when no learning data", () => {
    expect(analytics.getSuggestion("unknown command")).toBeNull()
  })

  it("returns 1.0 accuracy rate for empty analytics", () => {
    expect(analytics.getAccuracyRate()).toBe(1)
  })
})
