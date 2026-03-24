import { describe, expect, it } from "vitest"
import {
  buildAgentLaunch,
  serializeShellCommand,
  isLaunchAgentId,
  normalizeAgentSettings,
  DEFAULT_AGENT_SETTINGS,
  SUPPORTED_AGENT_IDS,
} from "./agent-launch.js"

describe("agent-launch", () => {
  it("builds a Claude resume command with validated flags", () => {
    const launch = buildAgentLaunch("claude", {
      model: "opus",
      claudeEffort: "high",
      bypass: true,
      locale: "zh-TW",
    }, {
      projectId: "demo",
      continueSession: true,
      resumeSessionId: "session_123",
    })

    expect(launch.args).toEqual([
      "claude",
      "--resume",
      "session_123",
      "--model",
      "opus",
      "--effort",
      "high",
      "--dangerously-skip-permissions",
    ])
    expect(launch.command).toContain("--resume")
    expect(launch.command).toContain("session_123")
    expect(launch.args).not.toContain("--append-system-prompt")
    expect(launch.command).not.toContain("--append-system-prompt")
  })

  it("sanitizes Codex settings and keeps dangerous text inside a quoted argument", () => {
    const launch = buildAgentLaunch("codex", {
      codexModel: "gpt-5-codex",
      codexMode: "danger-full-access",
      codexReasoningEffort: "xhigh",
      locale: "zh-TW'; rm -rf / #",
    })

    expect(launch.settings.locale).toBe("")
    expect(launch.args).toContain("gpt-5-codex")
    expect(launch.args).toContain("--dangerously-bypass-approvals-and-sandbox")
    expect(launch.args).toContain('model_reasoning_effort="xhigh"')
    expect(launch.command).not.toContain("rm -rf")
  })

  it("accepts safe custom Codex model ids such as gpt-5.4", () => {
    const launch = buildAgentLaunch("codex", {
      codexModel: "gpt-5.4",
      codexReasoningEffort: "high",
    })

    expect(launch.settings.codexModel).toBe("gpt-5.4")
    expect(launch.args).toContain("--model")
    expect(launch.args).toContain("gpt-5.4")
  })

  it("uses the shared AgentRune memory path for Aider", () => {
    const launch = buildAgentLaunch("aider", {
      aiderAutoCommit: false,
      aiderArchitect: true,
    })

    expect(launch.args).toEqual([
      "aider",
      "--no-auto-commits",
      "--architect",
      "--read",
      ".agentrune/agentlore.md",
    ])
  })

  it("tells fresh sessions to use the memory index and read only relevant sections", () => {
    const launch = buildAgentLaunch("codex", {
      locale: "zh-TW",
    }, {
      projectId: "demo",
    })

    const protocolArg = launch.args.at(-1) || ""
    expect(protocolArg).toContain("project memory index")
    expect(protocolArg).toContain("Do not read every section by default")
    expect(protocolArg).toContain("Search the structured memory sections")
  })

  it("quotes shell arguments safely for POSIX shells", () => {
    const command = serializeShellCommand([
      "codex",
      "hello world",
      "$(touch hacked)",
    ], "linux")

    expect(command).toBe("codex 'hello world' '$(touch hacked)'")
  })

  // --- isLaunchAgentId ---

  it("isLaunchAgentId returns true for every supported agent ID", () => {
    for (const id of SUPPORTED_AGENT_IDS) {
      expect(isLaunchAgentId(id)).toBe(true)
    }
  })

  it("isLaunchAgentId returns false for unknown strings", () => {
    expect(isLaunchAgentId("gpt4")).toBe(false)
    expect(isLaunchAgentId("")).toBe(false)
    expect(isLaunchAgentId("CLAUDE")).toBe(false)
  })

  it("isLaunchAgentId returns false for non-string values", () => {
    expect(isLaunchAgentId(null)).toBe(false)
    expect(isLaunchAgentId(undefined)).toBe(false)
    expect(isLaunchAgentId(42)).toBe(false)
    expect(isLaunchAgentId(["claude"])).toBe(false)
  })

  // --- normalizeAgentSettings ---

  it("normalizeAgentSettings returns defaults when called with no argument", () => {
    const settings = normalizeAgentSettings()
    expect(settings).toEqual(DEFAULT_AGENT_SETTINGS)
  })

  it("normalizeAgentSettings returns defaults when called with null/array/primitive", () => {
    expect(normalizeAgentSettings(null as never)).toEqual(DEFAULT_AGENT_SETTINGS)
    expect(normalizeAgentSettings([] as never)).toEqual(DEFAULT_AGENT_SETTINGS)
    expect(normalizeAgentSettings("claude" as never)).toEqual(DEFAULT_AGENT_SETTINGS)
  })

  it("normalizeAgentSettings rejects invalid enum values and falls back to defaults", () => {
    const settings = normalizeAgentSettings({
      model: "gpt-5" as never,
      claudeEffort: "ultra" as never,
      codexMode: "nuke" as never,
      geminiApprovalMode: "turbo" as never,
    })
    expect(settings.model).toBe(DEFAULT_AGENT_SETTINGS.model)
    expect(settings.claudeEffort).toBe(DEFAULT_AGENT_SETTINGS.claudeEffort)
    expect(settings.codexMode).toBe(DEFAULT_AGENT_SETTINGS.codexMode)
    expect(settings.geminiApprovalMode).toBe(DEFAULT_AGENT_SETTINGS.geminiApprovalMode)
  })

  it("normalizeAgentSettings rejects non-boolean bypass and falls back to false", () => {
    const settings = normalizeAgentSettings({ bypass: 1 as never, aiderAutoCommit: "yes" as never })
    expect(settings.bypass).toBe(false)
    expect(settings.aiderAutoCommit).toBe(true) // default is true
  })

  it("normalizeAgentSettings sanitizes unsafe locale to empty string", () => {
    const settings = normalizeAgentSettings({ locale: "zh-TW'; DROP TABLE users; --" })
    expect(settings.locale).toBe("")
  })

  it("normalizeAgentSettings accepts a valid locale", () => {
    const settings = normalizeAgentSettings({ locale: "zh-TW" })
    expect(settings.locale).toBe("zh-TW")
  })

  it("normalizeAgentSettings rejects unsafe geminiModel token and returns empty string", () => {
    const settings = normalizeAgentSettings({ geminiModel: "gemini; rm -rf /" })
    expect(settings.geminiModel).toBe("")
  })

  it("normalizeAgentSettings accepts a safe geminiModel token", () => {
    const settings = normalizeAgentSettings({ geminiModel: "gemini-2.0-flash" })
    expect(settings.geminiModel).toBe("gemini-2.0-flash")
  })

  // --- serializeShellCommand (win32 / PowerShell) ---

  it("quotes shell arguments for PowerShell (win32)", () => {
    const command = serializeShellCommand([
      "agent",
      "hello world",
      "it's a test",
    ], "win32")
    // spaces → single-quoted; embedded single-quote → doubled
    expect(command).toBe("agent 'hello world' 'it''s a test'")
  })

  it("serializeShellCommand returns empty string for empty array", () => {
    expect(serializeShellCommand([], "linux")).toBe("")
    expect(serializeShellCommand([], "win32")).toBe("")
  })

  it("serializeShellCommand does not quote safe unquoted tokens", () => {
    const command = serializeShellCommand(["codex", "--model", "gpt-5-codex"], "linux")
    expect(command).toBe("codex --model gpt-5-codex")
  })

  it("serializeShellCommand handles empty-string argument on POSIX", () => {
    expect(serializeShellCommand(["echo", ""], "linux")).toBe("echo ''")
  })

  it("serializeShellCommand handles empty-string argument on win32", () => {
    expect(serializeShellCommand(["echo", ""], "win32")).toBe("echo ''")
  })

  // --- Claude --continue (continueSession without resumeSessionId) ---

  it("builds a Claude --continue command when continueSession is true but no resumeSessionId", () => {
    const launch = buildAgentLaunch("claude", {}, { continueSession: true })
    expect(launch.args[1]).toBe("--continue")
    expect(launch.command).toContain("--continue")
    expect(launch.args).not.toContain("--resume")
  })

  it("builds a basic Claude command with no session flags when neither continueSession nor resumeSessionId is set", () => {
    const launch = buildAgentLaunch("claude", {})
    expect(launch.args).not.toContain("--continue")
    expect(launch.args).not.toContain("--resume")
  })

  // --- Claude planMode and autoEdit ---

  it("adds --permission-mode plan when planMode is true and bypass is false", () => {
    const launch = buildAgentLaunch("claude", { planMode: true })
    expect(launch.args).toContain("--permission-mode")
    expect(launch.args).toContain("plan")
    expect(launch.args).not.toContain("--dangerously-skip-permissions")
  })

  it("adds --permission-mode acceptEdits when autoEdit is true and bypass/planMode are false", () => {
    const launch = buildAgentLaunch("claude", { autoEdit: true })
    expect(launch.args).toContain("--permission-mode")
    expect(launch.args).toContain("acceptEdits")
    expect(launch.args).not.toContain("--dangerously-skip-permissions")
  })

  it("bypass takes priority over planMode and autoEdit", () => {
    const launch = buildAgentLaunch("claude", { bypass: true, planMode: true, autoEdit: true })
    expect(launch.args).toContain("--dangerously-skip-permissions")
    expect(launch.args).not.toContain("--permission-mode")
  })

  // --- Cursor agent ---

  it("builds Cursor args with defaults (no extra flags)", () => {
    const launch = buildAgentLaunch("cursor", {})
    expect(launch.args[0]).toBe("agent")
    expect(launch.args).not.toContain("--model")
    expect(launch.args).not.toContain("--sandbox")
    expect(launch.args).toContain("-p")
  })

  it("builds Cursor args with model, mode and sandbox", () => {
    const launch = buildAgentLaunch("cursor", {
      cursorModel: "gpt-4o",
      cursorMode: "plan",
      cursorSandbox: "enabled",
    })
    expect(launch.args).toContain("--model")
    expect(launch.args).toContain("gpt-4o")
    expect(launch.args).toContain("--mode=plan")
    expect(launch.args).toContain("--sandbox")
    expect(launch.args).toContain("enabled")
  })

  // --- Gemini agent ---

  it("builds Gemini args with defaults (no extra flags)", () => {
    const launch = buildAgentLaunch("gemini", {})
    expect(launch.args[0]).toBe("gemini")
    expect(launch.args).not.toContain("--model")
    expect(launch.args).not.toContain("--approval-mode")
    expect(launch.args).not.toContain("--sandbox")
    expect(launch.args).toContain("-i")
  })

  it("builds Gemini args with model, approval mode and sandbox", () => {
    const launch = buildAgentLaunch("gemini", {
      geminiModel: "gemini-2.0-flash",
      geminiApprovalMode: "yolo",
      geminiSandbox: true,
    })
    expect(launch.args).toContain("--model")
    expect(launch.args).toContain("gemini-2.0-flash")
    expect(launch.args).toContain("--approval-mode")
    expect(launch.args).toContain("yolo")
    expect(launch.args).toContain("--sandbox")
  })

  // --- OpenClaw agent ---

  it("builds OpenClaw args without provider when set to default", () => {
    const launch = buildAgentLaunch("openclaw", {})
    expect(launch.args).toEqual(["openclaw", "chat"])
  })

  it("builds OpenClaw args with a non-default provider", () => {
    const launch = buildAgentLaunch("openclaw", { openclawProvider: "anthropic" })
    expect(launch.args).toEqual(["openclaw", "chat", "--provider", "anthropic"])
  })

  // --- Cline agent ---

  it("builds Cline args as a single-element array", () => {
    const launch = buildAgentLaunch("cline", {})
    expect(launch.args).toEqual(["cline"])
    expect(launch.command).toBe("cline")
  })
})
