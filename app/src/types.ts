// Shared types — ported from AirTerm

export interface Project {
  id: string
  name: string
  cwd: string
  shell?: string
}

export interface AgentDef {
  id: string
  name: string
  description: string
  transport: "pty" | "api"
  command: (settings: ProjectSettings) => string | null
  apiConfig?: { gatewayUrl?: string }
  slashCommands?: SlashCommand[]
}

export type CodexModel = "default" | "gpt-5" | "gpt-5-codex" | "codex-mini-latest"
export type CodexMode = "default" | "full-auto" | "danger-full-access"
export type CodexReasoningEffort = "default" | "low" | "medium" | "high" | "xhigh"
export type AiderModel = "default" | "gpt-4o" | "claude-3.5-sonnet" | "deepseek-chat" | "o3-mini"
export type OpenClawProvider = "default" | "openai" | "anthropic" | "ollama" | "custom"
export type GeminiApprovalMode = "default" | "auto_edit" | "yolo" | "plan"

export interface ProjectSettings {
  model: "sonnet" | "opus" | "haiku"
  bypass: boolean
  planMode: boolean
  autoEdit: boolean
  fastMode: boolean
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
}

export interface AppSession {
  id: string
  projectId: string
  agentId: string
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
    | "session_summary"
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
  }
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

export interface Task {
  id: number
  title: string
  description: string
  status: "pending" | "in_progress" | "done"
  dependsOn: number[]
}

export interface TaskStore {
  projectId: string
  requirement: string
  tasks: Task[]
  createdAt: number
  updatedAt: number
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  model: "sonnet",
  bypass: false,
  planMode: false,
  autoEdit: false,
  fastMode: false,
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
}

export const AGENTS: AgentDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "AI Coding Assistant",
    transport: "pty",
    command: (s) => {
      let cmd = "claude"
      if (s.model !== "sonnet") cmd += ` --model ${s.model}`
      if (s.bypass) cmd += " --dangerously-skip-permissions"
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
    id: "openclaw",
    name: "OpenClaw",
    description: "Open Source AI Agent",
    transport: "pty",
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
    command: (s) => {
      let cmd = "aider"
      if (s.aiderModel !== "default") cmd += ` --model ${s.aiderModel}`
      if (!s.aiderAutoCommit) cmd += " --no-auto-commits"
      if (s.aiderArchitect) cmd += " --architect"
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
    command: (s) => {
      let cmd = "gemini"
      if (s.geminiModel) cmd += ` --model ${s.geminiModel}`
      if (s.geminiApprovalMode !== "default") cmd += ` --approval-mode ${s.geminiApprovalMode}`
      if (s.geminiSandbox) cmd += " --sandbox"
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
