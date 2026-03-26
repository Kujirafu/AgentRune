import { describe, expect, it } from "vitest"
import { normalizeAutomationConfig, normalizeAutomationConfigs, normalizeAutomationSchedule } from "./automation-normalize"

describe("automation-normalize", () => {
  it("falls back to a safe daily schedule when data is missing", () => {
    expect(normalizeAutomationSchedule(undefined)).toEqual({
      type: "daily",
      timeOfDay: "09:00",
      weekdays: [1, 2, 3, 4, 5],
    })
  })

  it("repairs invalid interval schedules", () => {
    expect(normalizeAutomationSchedule({ type: "interval", intervalMinutes: 0 })).toEqual({
      type: "interval",
      intervalMinutes: 30,
    })
  })

  it("normalizes automation records without dropping extra fields", () => {
    expect(normalizeAutomationConfig({
      id: "auto-1",
      name: "Nightly",
      schedule: { type: "daily", timeOfDay: "25:00" },
      enabled: true,
    })).toEqual({
      id: "auto-1",
      name: "Nightly",
      schedule: {
        type: "daily",
        timeOfDay: "09:00",
        weekdays: [1, 2, 3, 4, 5],
      },
      enabled: true,
    })
  })

  it("ignores non-object items in automation lists", () => {
    expect(normalizeAutomationConfigs([
      {
        id: "auto-1",
        projectId: "demo",
        name: "Nightly",
        schedule: { type: "daily", timeOfDay: "08:00", weekdays: [5, 1, 1] },
        runMode: "local",
        agentId: "claude",
      },
      null,
      "bad",
    ])).toEqual([
      {
        id: "auto-1",
        projectId: "demo",
        name: "Nightly",
        schedule: { type: "daily", timeOfDay: "08:00", weekdays: [1, 5] },
        runMode: "local",
        agentId: "claude",
      },
    ])
  })
})
