import { describe, expect, it } from "vitest"
import { sanitizeProjectList, isEphemeralTestProject } from "./project-registry.js"

describe("project-registry", () => {
  it("removes duplicate smoke projects that point at a real project cwd", () => {
    const projects = [
      { id: "agentrune", name: "AgentRune", cwd: "C:/Users/me/AgentRune-New" },
      { id: "codex-smoke-1773744805120", name: "Codex Smoke 1773744805120", cwd: "C:/Users/me/AgentRune-New" },
      { id: "claude-smoke-1773744805102", name: "Claude Smoke 1773744805102", cwd: "C:/Users/me/AgentRune-New" },
    ]

    const result = sanitizeProjectList(projects)

    expect(result.changed).toBe(true)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].id).toBe("agentrune")
  })

  it("removes tmp trust projects even without a canonical duplicate", () => {
    const projects = [
      { id: "agentrune", name: "AgentRune", cwd: "C:/Users/me/AgentRune-New" },
      { id: "codex-trust-1773741666828", name: "Codex Trust 1773741666828", cwd: "C:/Users/me/AgentRune-New/tmp/codex-trust-check-1773741666827" },
    ]

    expect(isEphemeralTestProject(projects[1], projects)).toBe(true)
    expect(sanitizeProjectList(projects).projects).toHaveLength(1)
  })

  it("keeps ordinary user projects untouched", () => {
    const projects = [
      { id: "agentlore", name: "AgentLore", cwd: "C:/Users/me/AgentWiki" },
      { id: "agentrune", name: "AgentRune", cwd: "C:/Users/me/AgentRune-New" },
      { id: "blog", name: "My Blog", cwd: "C:/Users/me/blog" },
    ]

    const result = sanitizeProjectList(projects)

    expect(result.changed).toBe(false)
    expect(result.projects).toEqual(projects)
  })
})
