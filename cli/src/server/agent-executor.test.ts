import { describe, expect, it } from "vitest"
import { buildAgentEnvironment, createManagedSessionId } from "./agent-executor.js"

describe("agent-executor", () => {
  it("builds a managed session id without Math.random", () => {
    const id = createManagedSessionId("project-alpha", 1234567890)
    expect(id).toMatch(/^project-alpha_1234567890_[0-9a-f]{6}$/)
  })

  it("scrubs nested Claude markers but preserves useful auth env", () => {
    const env = buildAgentEnvironment({
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "true",
      ANTHROPIC_API_KEY: "secret",
      PATH: "C:\\Windows",
    })

    expect(env).not.toHaveProperty("CLAUDECODE")
    expect(env).not.toHaveProperty("CLAUDE_CODE_ENTRYPOINT")
    expect(env.ANTHROPIC_API_KEY).toBe("secret")
    expect(env.PATH).toBe("C:\\Windows")
  })
})
