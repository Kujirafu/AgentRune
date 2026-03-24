import { describe, expect, it } from "vitest"

import type { AppSession } from "../types"
import { buildSessionOrdinalMap, extractSessionTimestamp, sortSessionsByOrdinal } from "./session-ordinals"

function makeSession(overrides: Partial<AppSession> & Pick<AppSession, "id" | "projectId" | "agentId">): AppSession {
  return {
    id: overrides.id,
    projectId: overrides.projectId,
    agentId: overrides.agentId,
    createdAt: overrides.createdAt,
    lastActivity: overrides.lastActivity,
  }
}

describe("extractSessionTimestamp", () => {
  it("extracts the last timestamp-looking segment from a session id", () => {
    expect(extractSessionTimestamp("project_alpha_1742812345678")).toBe(1742812345678)
    expect(extractSessionTimestamp("exec_auto_1742812345678_retry")).toBe(1742812345678)
  })

  it("returns null when the session id has no timestamp", () => {
    expect(extractSessionTimestamp("manual-session")).toBeNull()
  })
})

describe("buildSessionOrdinalMap", () => {
  it("assigns stable numbers from creation order instead of input order", () => {
    const sessions = [
      makeSession({ id: "proj_1742812345679", projectId: "proj", agentId: "claude", createdAt: 1742812345679 }),
      makeSession({ id: "proj_1742812345677", projectId: "proj", agentId: "claude", createdAt: 1742812345677 }),
      makeSession({ id: "proj_1742812345678", projectId: "proj", agentId: "claude", createdAt: 1742812345678 }),
    ]

    const ordinals = buildSessionOrdinalMap(sessions)

    expect(ordinals.get("proj_1742812345677")).toBe(1)
    expect(ordinals.get("proj_1742812345678")).toBe(2)
    expect(ordinals.get("proj_1742812345679")).toBe(3)
  })
})

describe("sortSessionsByOrdinal", () => {
  it("falls back to timestamps embedded in the session id", () => {
    const sessions = [
      makeSession({ id: "proj_1742812345679", projectId: "proj", agentId: "claude" }),
      makeSession({ id: "proj_1742812345677", projectId: "proj", agentId: "claude" }),
    ]

    expect(sortSessionsByOrdinal(sessions).map((session) => session.id)).toEqual([
      "proj_1742812345677",
      "proj_1742812345679",
    ])
  })
})
