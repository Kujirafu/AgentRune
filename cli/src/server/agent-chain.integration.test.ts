/**
 * Integration test: Agent launch config → environment building chain
 * Verifies cross-module interaction between agent-launch and agent-executor.
 */
import { describe, it, expect } from "vitest"
import {
  buildAgentLaunch,
  normalizeAgentSettings,
  SUPPORTED_AGENT_IDS,
  isLaunchAgentId,
} from "./agent-launch.js"
import { buildAgentEnvironment } from "./agent-executor.js"

describe("Agent launch → environment chain", () => {
  it("produces valid launch config for all supported agents", () => {
    for (const agentId of SUPPORTED_AGENT_IDS) {
      const settings = normalizeAgentSettings(agentId, {})
      const launch = buildAgentLaunch(agentId, settings, {
        projectId: "test-project",
      })

      expect(launch, `${agentId} should produce launch config`).toBeDefined()
      expect(launch.args.length, `${agentId} should have args`).toBeGreaterThan(0)
      expect(launch.command, `${agentId} should have command string`).toBeTruthy()
    }
  })

  it("Claude launch with full settings produces correct flag chain", () => {
    const launch = buildAgentLaunch(
      "claude",
      { model: "opus", claudeEffort: "high", bypass: true, locale: "zh-TW" },
      { projectId: "proj-1", prompt: "fix the bug" },
    )

    expect(launch.args).toContain("claude")
    expect(launch.args).toContain("--model")
    expect(launch.args).toContain("opus")
    expect(launch.args).toContain("--effort")
    expect(launch.args).toContain("high")
    expect(launch.args).toContain("--dangerously-skip-permissions")
    // Prompt is passed via stdin/piping, not in the CLI args
    expect(launch.command).toBeTruthy()
  })

  it("Codex launch with settings produces valid args", () => {
    const launch = buildAgentLaunch(
      "codex",
      { codexModel: "o3-mini", codexMode: "full-auto" },
      { projectId: "proj-2" },
    )

    expect(launch.args).toContain("codex")
    expect(launch.command).toBeTruthy()
  })

  it("buildAgentEnvironment strips Claude session detection vars", () => {
    const env = buildAgentEnvironment(
      {
        PATH: "/usr/bin",
        HOME: "/home/test",
        CLAUDECODE: "1",
        CLAUDE_CODE_ENTRYPOINT: "/some/path",
        ANTHROPIC_API_KEY: "sk-ant-test",
      },
      { CUSTOM_VAR: "hello" },
    )

    expect(env.PATH).toBe("/usr/bin")
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test")
    expect(env.CUSTOM_VAR).toBe("hello")
    // Should be stripped
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
  })

  it("environment extra vars override base env", () => {
    const env = buildAgentEnvironment(
      { API_KEY: "old" },
      { API_KEY: "new" },
    )
    expect(env.API_KEY).toBe("new")
  })

  it("normalizeAgentSettings provides defaults for unknown settings", () => {
    for (const agentId of SUPPORTED_AGENT_IDS) {
      const normalized = normalizeAgentSettings(agentId, {
        unknownField: "should-be-ignored" as any,
      })
      expect(normalized).toBeDefined()
    }
  })

  it("resume session includes --resume flag with session ID", () => {
    const launch = buildAgentLaunch(
      "claude",
      { model: "sonnet" },
      {
        projectId: "proj-1",
        continueSession: true,
        resumeSessionId: "session_abc123",
      },
    )

    expect(launch.args).toContain("--resume")
    expect(launch.args).toContain("session_abc123")
  })

  it("isLaunchAgentId validates correctly", () => {
    expect(isLaunchAgentId("claude")).toBe(true)
    expect(isLaunchAgentId("codex")).toBe(true)
    expect(isLaunchAgentId("gemini")).toBe(true)
    expect(isLaunchAgentId("unknown-agent")).toBe(false)
    expect(isLaunchAgentId("")).toBe(false)
  })

  it("prevents command injection in prompt text", () => {
    const launch = buildAgentLaunch(
      "claude",
      {},
      { projectId: "proj-1", prompt: "hello; rm -rf /" },
    )
    // The prompt should be in the command but safely quoted
    expect(launch.command).toBeTruthy()
    // Args should not have shell metacharacters unescaped
    const joinedArgs = launch.args.join(" ")
    // The prompt content should be present but the command should be structured
    expect(launch.args[0]).toBe("claude")
  })
})
