// Shared types — ported from AirTerm

export interface Project {
  id: string
  name: string
  cwd: string
  shell?: string
}

export interface AgentInstallInfo {
  /** The binary name to check (e.g. "claude", "codex") */
  bin: string
  /** npm/pip/curl install command */
  npm?: string
  pip?: string
  script?: string
}

export interface AgentDef {
  id: string
  name: string
  description: string
  transport: "pty" | "api"
  command: (settings: ProjectSettings) => string | null
  install?: AgentInstallInfo
  apiConfig?: { gatewayUrl?: string }
  slashCommands?: SlashCommand[]
}

export type CodexModel = string
export type CodexMode = "default" | "full-auto" | "danger-full-access"
export type CodexReasoningEffort = "default" | "low" | "medium" | "high" | "xhigh"
export type AiderModel = "default" | "gpt-4o" | "claude-3.5-sonnet" | "deepseek-chat" | "o3-mini"
export type OpenClawProvider = "default" | "openai" | "anthropic" | "ollama" | "custom"
export type GeminiApprovalMode = "default" | "auto_edit" | "yolo" | "plan"
export type CursorMode = "default" | "plan" | "ask"
export type CursorSandbox = "default" | "enabled" | "disabled"
export type ClaudeEffort = "default" | "low" | "medium" | "high" | "max"

export interface ProjectSettings {
  model: "sonnet" | "opus" | "haiku"
  bypass: boolean
  planMode: boolean
  autoEdit: boolean
  fastMode: boolean
  claudeEffort: ClaudeEffort
  claudeThinking: boolean
  codexModel: CodexModel
  codexMode: CodexMode
  codexReasoningEffort: CodexReasoningEffort
  // Aider
  aiderModel: AiderModel
  aiderAutoCommit: boolean
  aiderArchitect: boolean
  // Cline
  clineAutoApprove: boolean
  // OpenClaw
  openclawGatewayUrl: string
  openclawToken: string
  openclawProvider: OpenClawProvider
  // Gemini
  geminiModel: string
  geminiApprovalMode: GeminiApprovalMode
  geminiSandbox: boolean
  // Cursor
  cursorMode: CursorMode
  cursorModel: string
  cursorSandbox: CursorSandbox
  // Routing
  routingRules?: RoutingRule[]
  // Global sandbox (overridden by feature-specific: automation trustProfile, skill chain config)
  sandboxLevel: "strict" | "moderate" | "permissive" | "none"
  requirePlanReview: boolean
  requireMergeApproval: boolean
  // Injected at launch time (not persisted)
  locale?: string
}

export interface AppSession {
  id: string
  projectId: string
  agentId: string
  worktreeBranch?: string | null
  status?: "active" | "recoverable"
  claudeSessionId?: string
  taskTitle?: string
  createdAt?: number
  lastActivity?: number
  lastAgentStatus?: "working" | "idle" | "waiting"
}

export interface SmartAction {
  label: string
  input: string
  style: "primary" | "danger" | "default"
}

export interface SlashCommand {
  command: string
  description: string
}

export interface AgentEvent {
  id: string
  timestamp: number
  type:
    | "file_edit"
    | "file_create"
    | "file_delete"
    | "command_run"
    | "test_result"
    | "install_package"
    | "decision_request"
    | "error"
    | "info"
    | "user_message"
    | "token_usage"
    | "response"
    | "session_summary"
    | "progress_report"
  status: "in_progress" | "completed" | "failed" | "waiting"
  title: string
  detail?: string
  raw?: string
  diff?: {
    filePath: string
    before: string
    after: string
  }
  decision?: {
    options: DecisionOption[]
    purpose?: string    // 目的 — why the agent needs this permission
    scope?: string      // 影響範圍 — what files/systems will be affected
  }
  progress?: ProgressReport
  _images?: string[]  // base64 image thumbnails for user messages
}

export interface DecisionOption {
  label: string
  input: string
  style: "primary" | "danger" | "default"
}

export interface DeviceInfo {
  id: string
  hostname: string
  platform: string
  localIp: string
  port: number
  protocol: string
  cloudSessionToken?: string
  status: "ONLINE" | "OFFLINE"
  lastSeen: string
}

export type PrdPriority = "p0" | "p1" | "p2" | "p3"
export type PrdStatus = "active" | "done"

export interface Task {
  id: number
  title: string
  description: string
  status: "pending" | "in_progress" | "done" | "skipped"
  priority?: PrdPriority
  dependsOn: number[]
}

export interface PrdDecision {
  question: string
  answer: string
}

export interface PrdApproach {
  name: string
  pros: string[]
  cons: string[]
  adopted: boolean
  techNote?: string
}

export interface PrdItem {
  id: string
  title: string
  priority: PrdPriority
  status: PrdStatus
  goal: string
  decisions: PrdDecision[]
  approaches: PrdApproach[]
  scope: { included: string[]; excluded: string[] }
  tasks: Task[]
  createdAt: number
  updatedAt: number
}

/** Summary for list view — no full details */
export interface PrdSummary {
  id: string
  title: string
  priority: PrdPriority
  status: PrdStatus
  tasksDone: number
  tasksSkipped: number
  tasksTotal: number
  createdAt: number
  updatedAt: number
}

/** @deprecated Use PrdItem instead */
export interface Prd {
  goal: string
  decisions: PrdDecision[]
  approaches: PrdApproach[]
  scope: { included: string[]; excluded: string[] }
}

/** @deprecated Use PrdItem instead */
export interface TaskStore {
  projectId: string
  requirement: string
  prd?: Prd
  tasks: Task[]
  createdAt: number
  updatedAt: number
}

export interface ProgressReport {
  title: string
  status: "done" | "blocked" | "in_progress"
  summary: string
  nextSteps: string[]
  details?: string
}

// ── Routing Rules ──

export interface RoutingRule {
  id: string
  keywords: string[]
  agentId: string
  enabled: boolean
}

export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  { id: "default-1", keywords: ["test", "spec", "coverage", "unit"], agentId: "codex", enabled: true },
  { id: "default-2", keywords: ["fix", "bug", "error", "debug", "crash"], agentId: "claude", enabled: true },
  { id: "default-3", keywords: ["refactor", "clean", "rename", "move"], agentId: "gemini", enabled: true },
]

export interface DetectedAgent {
  id: string
  name: string
  installed: boolean
  version?: string
  path?: string
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  model: "sonnet",
  bypass: false,
  planMode: false,
  autoEdit: false,
  fastMode: false,
  claudeEffort: "default",
  claudeThinking: false,
  codexModel: "default",
  codexMode: "default",
  codexReasoningEffort: "default",
  aiderModel: "default",
  aiderAutoCommit: true,
  aiderArchitect: false,
  clineAutoApprove: false,
  openclawGatewayUrl: "ws://127.0.0.1:18789",
  openclawToken: "",
  openclawProvider: "default",
  geminiModel: "",
  geminiApprovalMode: "default",
  geminiSandbox: false,
  cursorMode: "default",
  cursorModel: "",
  cursorSandbox: "default",
  sandboxLevel: "none",
  requirePlanReview: false,
  requireMergeApproval: false,
}

// AgentRune Protocol — injected into every agent's system/initial prompt.
// FULL version for agents with system prompt support (Claude).
// SHORT version for agents where it goes into visible user prompt (Codex, Gemini).
// Rules live in .agentrune/rules.md, memory in .agentrune/agentlore.md — agents read both on start.
const buildProtocol = (locale?: string) => {
  const langHint = locale ? ` Respond in the user's language (${locale}).` : ""
  return {
    full: [
      "AGENTRUNE PROTOCOL: You are running inside AgentRune.",
      `FIRST ACTION (mandatory, before anything else): If .agentrune/rules.md exists, read it and follow the behavior rules strictly. Then read .agentrune/agentlore.md (your project memory — treat it like memory.md). If agentlore.md does not exist, create it (mkdir -p .agentrune) by scanning the project.${langHint}`,
      "MEMORY: .agentrune/agentlore.md IS your memory. Read it at session start, write to it when you learn something. Do NOT use CLAUDE.md, .claude/memory/, or any agent-native memory system — user cannot see those.",
    ].join(" "),
    short: `AGENTRUNE: If .agentrune/rules.md exists, read and follow it. Read .agentrune/agentlore.md (project memory) — if missing, create it (mkdir -p .agentrune) by scanning the project. agentlore.md IS your memory — read on start, write when you learn. Do NOT use your own memory system — only .agentrune/agentlore.md.${langHint}`,
  }
}

export const AGENTS: AgentDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "AI Coding Assistant",
    transport: "pty",
    install: { bin: "claude", npm: "@anthropic-ai/claude-code" },
    command: (s) => {
      let cmd = "claude"
      if (s.model !== "sonnet") cmd += ` --model ${s.model}`
      if (s.bypass) cmd += " --dangerously-skip-permissions"
      cmd += ` --append-system-prompt "${buildProtocol(s.locale).full}"`
      return cmd
    },
    slashCommands: [
      { command: "/help", description: "Show available commands" },
      { command: "/compact", description: "Compact conversation context" },
      { command: "/clear", description: "Clear conversation history" },
      { command: "/cost", description: "Show token usage & cost" },
      { command: "/model", description: "Switch AI model" },
      { command: "/init", description: "Initialize CLAUDE.md" },
      { command: "/review", description: "Review code changes" },
      { command: "/bug", description: "Report and diagnose bugs" },
      { command: "/config", description: "Open config panel" },
      { command: "/vim", description: "Toggle vim mode" },
      { command: "/add-dir", description: "Add directory to context" },
      { command: "/memory", description: "Manage memory files" },
      { command: "/terminal-setup", description: "Configure terminal theme" },
      { command: "/add", description: "Add file to chat" },
      { command: "/drop", description: "Remove file from chat" },
      { command: "/run", description: "Run a shell command" },
      { command: "/test", description: "Run tests" },
      { command: "/lint", description: "Run linter" },
      { command: "/commit", description: "Commit changes" },
      { command: "/doctors", description: "Run health checks" },
      { command: "/login", description: "Login to Anthropic" },
      { command: "/logout", description: "Logout" },
      { command: "/permissions", description: "Manage permissions" },
      { command: "/resume", description: "Resume a previous session" },
      { command: "/status", description: "Show session status" },
      { command: "/mcp", description: "Manage MCP servers" },
    ],
  },
  {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI Coding Agent",
    transport: "pty",
    install: { bin: "codex", npm: "@openai/codex" },
    command: (s) => {
      let cmd = "codex --no-alt-screen"
      if (s.codexModel !== "default") cmd += ` --model ${s.codexModel}`
      if (s.codexReasoningEffort !== "default") {
        cmd += ` -c 'model_reasoning_effort="${s.codexReasoningEffort}"'`
      }
      if (s.codexMode === "full-auto") cmd += " --full-auto"
      if (s.codexMode === "danger-full-access") {
        cmd += " --dangerously-bypass-approvals-and-sandbox"
      }
      cmd += ` "${buildProtocol(s.locale).short}"`
      return cmd
    },
    slashCommands: [
      { command: "/help", description: "Show help" },
      { command: "/status", description: "Show current session status" },
      { command: "/model", description: "Change the active model" },
      { command: "/approval", description: "Adjust approval policy" },
      { command: "/sandbox", description: "Adjust sandbox mode" },
      { command: "/fullauto", description: "Enable full-auto mode" },
      { command: "/permissions", description: "Show active tool permissions" },
      { command: "/profile", description: "Switch config profile" },
      { command: "/mcp", description: "Manage MCP servers" },
      { command: "/add-dir", description: "Add writable directory" },
      { command: "/agents", description: "Manage sub-agents" },
      { command: "/clear", description: "Clear conversation" },
      { command: "/compact", description: "Compact context" },
    ],
  },
  {
    id: "cursor",
    name: "Cursor Agent",
    description: "Cursor AI Coding Agent",
    transport: "pty",
    install: { bin: "agent", script: "curl https://cursor.com/install -fsSL | bash" },
    command: (s) => {
      let cmd = "agent"
      if (s.cursorModel) cmd += ` --model ${s.cursorModel}`
      if (s.cursorMode !== "default") cmd += ` --mode=${s.cursorMode}`
      if (s.cursorSandbox !== "default") cmd += ` --sandbox ${s.cursorSandbox}`
      cmd += ` -p "${buildProtocol(s.locale).short}"`
      return cmd
    },
    slashCommands: [
      { command: "/help", description: "Show help" },
      { command: "/plan", description: "Switch to plan mode" },
      { command: "/ask", description: "Switch to ask mode" },
      { command: "/compact", description: "Compact context" },
      { command: "/clear", description: "Clear conversation" },
      { command: "/model", description: "Switch model" },
      { command: "/mcp", description: "Manage MCP servers" },
      { command: "/sandbox", description: "Configure sandbox" },
      { command: "/max-mode", description: "Toggle max mode" },
    ],
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    description: "Open Source AI Agent",
    transport: "pty",
    install: { bin: "openclaw", npm: "openclaw" },
    command: (s) => {
      let cmd = "openclaw chat"
      if (s.openclawProvider !== "default") cmd += ` --provider ${s.openclawProvider}`
      return cmd
    },
    apiConfig: { gatewayUrl: "ws://127.0.0.1:18789" },
    slashCommands: [
      { command: "/help", description: "Show help" },
      { command: "/status", description: "Agent status" },
      { command: "/skills", description: "List available skills" },
    ],
  },
  {
    id: "aider",
    name: "Aider",
    description: "AI Pair Programming",
    transport: "pty",
    install: { bin: "aider", pip: "aider-chat" },
    command: (s) => {
      let cmd = "aider"
      if (s.aiderModel !== "default") cmd += ` --model ${s.aiderModel}`
      if (!s.aiderAutoCommit) cmd += " --no-auto-commits"
      if (s.aiderArchitect) cmd += " --architect"
      cmd += " --read agentlore.md"
      return cmd
    },
    slashCommands: [
      { command: "/help", description: "Show help" },
      { command: "/clear", description: "Clear chat" },
      { command: "/add", description: "Add file to chat" },
      { command: "/drop", description: "Remove file from chat" },
      { command: "/run", description: "Run a shell command" },
      { command: "/diff", description: "Show diff of changes" },
      { command: "/undo", description: "Undo last change" },
      { command: "/commit", description: "Commit changes" },
      { command: "/tokens", description: "Show token usage" },
      { command: "/model", description: "Switch AI model" },
      { command: "/architect", description: "Toggle architect mode" },
    ],
  },
  {
    id: "cline",
    name: "Cline",
    description: "AI Coding Agent",
    transport: "pty",
    install: { bin: "cline", npm: "@anthropic-ai/cline" },
    command: () => "cline",
    slashCommands: [
      { command: "/help", description: "Show help" },
      { command: "/clear", description: "Clear conversation" },
    ],
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google AI Agent",
    transport: "pty",
    install: { bin: "gemini", npm: "@anthropic-ai/gemini-cli" },
    command: (s) => {
      let cmd = "gemini"
      if (s.geminiModel) cmd += ` --model ${s.geminiModel}`
      if (s.geminiApprovalMode !== "default") cmd += ` --approval-mode ${s.geminiApprovalMode}`
      if (s.geminiSandbox) cmd += " --sandbox"
      cmd += ` -i "${buildProtocol(s.locale).short}"`
      return cmd
    },
    slashCommands: [
      { command: "/help", description: "Show help" },
      { command: "/clear", description: "Clear conversation" },
      { command: "/mcp", description: "Manage MCP servers" },
      { command: "/extensions", description: "Manage extensions" },
      { command: "/skills", description: "Manage skills" },
      { command: "/hooks", description: "Manage hooks" },
      { command: "/resume", description: "Resume previous session" },
    ],
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Plain Shell Environment",
    transport: "pty",
    command: () => null,
  },
]

export const KNOWN_AGENT_IDS = AGENTS.map(a => a.id)
export const MODEL_NAMES = ["opus", "sonnet", "haiku", "flash", "gpt-4o", "o3-mini", "deepseek"] as const
