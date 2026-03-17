import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const SUPPORTED_AGENT_IDS = [
  "claude",
  "codex",
  "cursor",
  "gemini",
  "aider",
  "openclaw",
  "cline",
] as const

export type LaunchAgentId = (typeof SUPPORTED_AGENT_IDS)[number]

type ClaudeModel = "sonnet" | "opus" | "haiku"
type ClaudeEffort = "default" | "low" | "medium" | "high" | "max"
type CodexModel = string
type CodexMode = "default" | "full-auto" | "danger-full-access"
type CodexReasoningEffort = "default" | "low" | "medium" | "high" | "xhigh"
type AiderModel = "default" | "gpt-4o" | "claude-3.5-sonnet" | "deepseek-chat" | "o3-mini"
type OpenClawProvider = "default" | "openai" | "anthropic" | "ollama" | "custom"
type GeminiApprovalMode = "default" | "auto_edit" | "yolo" | "plan"
type CursorMode = "default" | "plan" | "ask"
type CursorSandbox = "default" | "enabled" | "disabled"

const CLAUDE_MODELS = ["sonnet", "opus", "haiku"] as const
const CLAUDE_EFFORTS = ["default", "low", "medium", "high", "max"] as const
const CODEX_MODES = ["default", "full-auto", "danger-full-access"] as const
const CODEX_REASONING = ["default", "low", "medium", "high", "xhigh"] as const
const AIDER_MODELS = ["default", "gpt-4o", "claude-3.5-sonnet", "deepseek-chat", "o3-mini"] as const
const OPENCLAW_PROVIDERS = ["default", "openai", "anthropic", "ollama", "custom"] as const
const GEMINI_APPROVAL_MODES = ["default", "auto_edit", "yolo", "plan"] as const
const CURSOR_MODES = ["default", "plan", "ask"] as const
const CURSOR_SANDBOXES = ["default", "enabled", "disabled"] as const

const SAFE_TOKEN_RE = /^[A-Za-z0-9._:/-]{1,120}$/
const SAFE_LOCALE_RE = /^[A-Za-z0-9_-]{1,32}$/
const SAFE_RESUME_ID_RE = /^[A-Za-z0-9_-]{1,120}$/
const SAFE_PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,120}$/
const SAFE_UNQUOTED_RE = /^[A-Za-z0-9_./:=+-]+$/

export interface AgentInstallInfo {
  bin: string
  npm?: string
  pip?: string
  script?: string
}

export const AGENT_INSTALL_INFO: Record<LaunchAgentId, AgentInstallInfo> = {
  claude: { bin: "claude", npm: "@anthropic-ai/claude-code" },
  codex: { bin: "codex", npm: "@openai/codex" },
  cursor: { bin: "agent", script: "curl https://cursor.com/install -fsSL | bash" },
  gemini: { bin: "gemini", npm: "@google/gemini-cli" },
  aider: { bin: "aider", pip: "aider-chat" },
  openclaw: { bin: "openclaw", npm: "openclaw" },
  cline: { bin: "cline", npm: "@anthropic-ai/cline" },
}

export interface NormalizedAgentSettings {
  model: ClaudeModel
  bypass: boolean
  planMode: boolean
  autoEdit: boolean
  claudeEffort: ClaudeEffort
  codexModel: CodexModel
  codexMode: CodexMode
  codexReasoningEffort: CodexReasoningEffort
  aiderModel: AiderModel
  aiderAutoCommit: boolean
  aiderArchitect: boolean
  openclawProvider: OpenClawProvider
  geminiModel: string
  geminiApprovalMode: GeminiApprovalMode
  geminiSandbox: boolean
  cursorMode: CursorMode
  cursorModel: string
  cursorSandbox: CursorSandbox
  locale: string
}

export const DEFAULT_AGENT_SETTINGS: NormalizedAgentSettings = {
  model: "sonnet",
  bypass: false,
  planMode: false,
  autoEdit: false,
  claudeEffort: "default",
  codexModel: "default",
  codexMode: "default",
  codexReasoningEffort: "default",
  aiderModel: "default",
  aiderAutoCommit: true,
  aiderArchitect: false,
  openclawProvider: "default",
  geminiModel: "",
  geminiApprovalMode: "default",
  geminiSandbox: false,
  cursorMode: "default",
  cursorModel: "",
  cursorSandbox: "default",
  locale: "",
}

export interface AgentLaunchOptions {
  projectId?: string
  port?: number
  continueSession?: boolean
  resumeSessionId?: string | null
}

export interface AgentLaunch {
  agentId: LaunchAgentId
  args: string[]
  command: string
  settings: NormalizedAgentSettings
}

type AgentSettingsInput = Partial<NormalizedAgentSettings> | Record<string, unknown>

export function isLaunchAgentId(value: unknown): value is LaunchAgentId {
  return typeof value === "string" && SUPPORTED_AGENT_IDS.includes(value as LaunchAgentId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function readBoolean(settings: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = settings[key]
  return typeof value === "boolean" ? value : fallback
}

function readEnum<T extends readonly string[]>(
  settings: Record<string, unknown>,
  key: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const value = settings[key]
  return typeof value === "string" && allowed.includes(value as T[number]) ? value as T[number] : fallback
}

function readSafeToken(settings: Record<string, unknown>, key: string): string {
  const value = settings[key]
  return typeof value === "string" && SAFE_TOKEN_RE.test(value) ? value : ""
}

function readCodexModel(settings: Record<string, unknown>, fallback: CodexModel): CodexModel {
  const value = settings.codexModel
  if (typeof value !== "string") return fallback
  if (value === "default") return "default"
  return SAFE_TOKEN_RE.test(value) ? value : fallback
}

function sanitizeLocale(value: unknown): string {
  return typeof value === "string" && SAFE_LOCALE_RE.test(value) ? value : ""
}

function sanitizeProjectId(projectId?: string): string {
  if (!projectId) return ""
  if (SAFE_PROJECT_ID_RE.test(projectId)) return projectId
  return projectId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)
}

function sanitizeResumeSessionId(value?: string | null): string {
  return value && SAFE_RESUME_ID_RE.test(value) ? value : ""
}

export function normalizeAgentSettings(rawSettings?: AgentSettingsInput): NormalizedAgentSettings {
  const settings = isRecord(rawSettings) ? rawSettings : {}
  return {
    model: readEnum(settings, "model", CLAUDE_MODELS, DEFAULT_AGENT_SETTINGS.model),
    bypass: readBoolean(settings, "bypass", DEFAULT_AGENT_SETTINGS.bypass),
    planMode: readBoolean(settings, "planMode", DEFAULT_AGENT_SETTINGS.planMode),
    autoEdit: readBoolean(settings, "autoEdit", DEFAULT_AGENT_SETTINGS.autoEdit),
    claudeEffort: readEnum(settings, "claudeEffort", CLAUDE_EFFORTS, DEFAULT_AGENT_SETTINGS.claudeEffort),
    codexModel: readCodexModel(settings, DEFAULT_AGENT_SETTINGS.codexModel),
    codexMode: readEnum(settings, "codexMode", CODEX_MODES, DEFAULT_AGENT_SETTINGS.codexMode),
    codexReasoningEffort: readEnum(settings, "codexReasoningEffort", CODEX_REASONING, DEFAULT_AGENT_SETTINGS.codexReasoningEffort),
    aiderModel: readEnum(settings, "aiderModel", AIDER_MODELS, DEFAULT_AGENT_SETTINGS.aiderModel),
    aiderAutoCommit: readBoolean(settings, "aiderAutoCommit", DEFAULT_AGENT_SETTINGS.aiderAutoCommit),
    aiderArchitect: readBoolean(settings, "aiderArchitect", DEFAULT_AGENT_SETTINGS.aiderArchitect),
    openclawProvider: readEnum(settings, "openclawProvider", OPENCLAW_PROVIDERS, DEFAULT_AGENT_SETTINGS.openclawProvider),
    geminiModel: readSafeToken(settings, "geminiModel"),
    geminiApprovalMode: readEnum(settings, "geminiApprovalMode", GEMINI_APPROVAL_MODES, DEFAULT_AGENT_SETTINGS.geminiApprovalMode),
    geminiSandbox: readBoolean(settings, "geminiSandbox", DEFAULT_AGENT_SETTINGS.geminiSandbox),
    cursorMode: readEnum(settings, "cursorMode", CURSOR_MODES, DEFAULT_AGENT_SETTINGS.cursorMode),
    cursorModel: readSafeToken(settings, "cursorModel"),
    cursorSandbox: readEnum(settings, "cursorSandbox", CURSOR_SANDBOXES, DEFAULT_AGENT_SETTINGS.cursorSandbox),
    locale: sanitizeLocale(settings.locale),
  }
}

function countActivePrds(projectId?: string): number {
  const safeProjectId = sanitizeProjectId(projectId)
  if (!safeProjectId) return 0

  const prdDir = join(homedir(), ".agentrune", "prd", safeProjectId)
  if (!existsSync(prdDir)) return 0

  let activeCount = 0
  for (const file of readdirSync(prdDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const parsed = JSON.parse(readFileSync(join(prdDir, file), "utf-8")) as { status?: string }
      if (parsed.status === "active") activeCount++
    } catch {
      // Ignore malformed PRD files.
    }
  }
  return activeCount
}

function buildAgentProtocol(locale: string, projectId?: string): { full: string; short: string } {
  const langHint = locale ? ` Respond in the user's language (${locale}).` : ""
  const activePrds = countActivePrds(projectId)
  const prdHint = activePrds > 0
    ? ` PRD: This project has ${activePrds} active PRD(s). See .agentrune/rules.md for PRD API details.`
    : ""

  return {
    full: [
      "AGENTRUNE PROTOCOL: You are running inside AgentRune.",
      `FIRST ACTION (mandatory, before anything else): If .agentrune/rules.md exists, read it and follow the behavior rules strictly. Then read .agentrune/agentlore.md (your project memory - treat it like memory.md). If agentlore.md does not exist, create it (mkdir -p .agentrune) by scanning the project.${langHint}`,
      "MEMORY: .agentrune/agentlore.md IS your memory. Read it at session start, write to it when you learn something. Do NOT use CLAUDE.md, .claude/memory/, or any agent-native memory system - user cannot see those.",
      prdHint,
    ].filter(Boolean).join(" "),
    short: [
      "AGENTRUNE: If .agentrune/rules.md exists, read and follow it.",
      "Read .agentrune/agentlore.md (project memory) - if missing, create it (mkdir -p .agentrune) by scanning the project.",
      "agentlore.md IS your memory - read on start, write when you learn. Do NOT use your own memory system - only .agentrune/agentlore.md.",
      langHint.trim(),
      prdHint.trim(),
    ].filter(Boolean).join(" "),
  }
}

function quoteForPowerShell(arg: string): string {
  if (arg.length === 0) return "''"
  if (SAFE_UNQUOTED_RE.test(arg)) return arg
  return `'${arg.replace(/'/g, "''")}'`
}

function quoteForPosix(arg: string): string {
  if (arg.length === 0) return "''"
  if (SAFE_UNQUOTED_RE.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\"'\"'`)}'`
}

export function serializeShellCommand(args: readonly string[], platform: NodeJS.Platform = process.platform): string {
  if (args.length === 0) return ""
  const quote = platform === "win32" ? quoteForPowerShell : quoteForPosix
  return args.map(quote).join(" ")
}

function buildClaudeArgs(settings: NormalizedAgentSettings, options: AgentLaunchOptions): string[] {
  const protocol = buildAgentProtocol(settings.locale, options.projectId)
  const resumeSessionId = sanitizeResumeSessionId(options.resumeSessionId)
  const args = ["claude"]

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId)
  } else if (options.continueSession) {
    args.push("--continue")
  }

  if (settings.model !== "sonnet") args.push("--model", settings.model)
  if (settings.claudeEffort !== "default") args.push("--effort", settings.claudeEffort)

  if (settings.bypass) {
    args.push("--dangerously-skip-permissions")
  } else if (settings.planMode) {
    args.push("--permission-mode", "plan")
  } else if (settings.autoEdit) {
    args.push("--permission-mode", "acceptEdits")
  }

  args.push("--append-system-prompt", protocol.full)
  return args
}

function buildCodexArgs(settings: NormalizedAgentSettings, options: AgentLaunchOptions): string[] {
  const protocol = buildAgentProtocol(settings.locale, options.projectId)
  const args = ["codex", "--no-alt-screen"]

  if (settings.codexModel !== "default") args.push("--model", settings.codexModel)
  if (settings.codexReasoningEffort !== "default") {
    args.push("-c", `model_reasoning_effort="${settings.codexReasoningEffort}"`)
  }
  if (settings.codexMode === "full-auto") args.push("--full-auto")
  if (settings.codexMode === "danger-full-access") args.push("--dangerously-bypass-approvals-and-sandbox")

  args.push(protocol.short)
  return args
}

function buildCursorArgs(settings: NormalizedAgentSettings, options: AgentLaunchOptions): string[] {
  const protocol = buildAgentProtocol(settings.locale, options.projectId)
  const args = ["agent"]

  if (settings.cursorModel) args.push("--model", settings.cursorModel)
  if (settings.cursorMode !== "default") args.push(`--mode=${settings.cursorMode}`)
  if (settings.cursorSandbox !== "default") args.push("--sandbox", settings.cursorSandbox)

  args.push("-p", protocol.short)
  return args
}

function buildGeminiArgs(settings: NormalizedAgentSettings, options: AgentLaunchOptions): string[] {
  const protocol = buildAgentProtocol(settings.locale, options.projectId)
  const args = ["gemini"]

  if (settings.geminiModel) args.push("--model", settings.geminiModel)
  if (settings.geminiApprovalMode !== "default") args.push("--approval-mode", settings.geminiApprovalMode)
  if (settings.geminiSandbox) args.push("--sandbox")

  args.push("-i", protocol.short)
  return args
}

function buildAiderArgs(settings: NormalizedAgentSettings): string[] {
  const args = ["aider"]

  if (settings.aiderModel !== "default") args.push("--model", settings.aiderModel)
  if (!settings.aiderAutoCommit) args.push("--no-auto-commits")
  if (settings.aiderArchitect) args.push("--architect")

  args.push("--read", ".agentrune/agentlore.md")
  return args
}

function buildOpenClawArgs(settings: NormalizedAgentSettings): string[] {
  const args = ["openclaw", "chat"]
  if (settings.openclawProvider !== "default") args.push("--provider", settings.openclawProvider)
  return args
}

export function buildAgentLaunch(
  agentId: LaunchAgentId,
  rawSettings?: AgentSettingsInput,
  options: AgentLaunchOptions = {},
): AgentLaunch {
  const settings = normalizeAgentSettings(rawSettings)
  let args: string[]

  switch (agentId) {
    case "claude":
      args = buildClaudeArgs(settings, options)
      break
    case "codex":
      args = buildCodexArgs(settings, options)
      break
    case "cursor":
      args = buildCursorArgs(settings, options)
      break
    case "gemini":
      args = buildGeminiArgs(settings, options)
      break
    case "aider":
      args = buildAiderArgs(settings)
      break
    case "openclaw":
      args = buildOpenClawArgs(settings)
      break
    case "cline":
      args = ["cline"]
      break
  }

  return {
    agentId,
    args,
    command: serializeShellCommand(args),
    settings,
  }
}
