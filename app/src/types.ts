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

export type CodexModel = "default" | "gpt-5" | "gpt-5-codex" | "codex-mini-latest"
export type CodexMode = "default" | "full-auto" | "danger-full-access"
export type CodexReasoningEffort = "default" | "low" | "medium" | "high" | "xhigh"
export type AiderModel = "default" | "gpt-4o" | "claude-3.5-sonnet" | "deepseek-chat" | "o3-mini"
export type OpenClawProvider = "default" | "openai" | "anthropic" | "ollama" | "custom"
export type GeminiApprovalMode = "default" | "auto_edit" | "yolo" | "plan"
export type CursorMode = "default" | "plan" | "ask"
export type CursorSandbox = "default" | "enabled" | "disabled"

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
  // Cursor
  cursorMode: CursorMode
  cursorModel: string
  cursorSandbox: CursorSandbox
}

export interface AppSession {
  id: string
  projectId: string
  agentId: string
  worktreeBranch?: string | null
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
  }
  progress?: ProgressReport
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

export interface ProgressReport {
  title: string
  status: "done" | "blocked" | "in_progress"
  summary: string
  nextSteps: string[]
  details?: string
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
  cursorMode: "default",
  cursorModel: "",
  cursorSandbox: "default",
}

// AgentRune Protocol — injected into every agent's system/initial prompt.
// FULL version for agents with system prompt support (Claude).
// SHORT version for agents where it goes into visible user prompt (Codex, Gemini).
// Both versions funnel into agentlore.md which contains the full workflow.
const AGENT_PROTOCOL_FULL = [
  "AGENTRUNE PROTOCOL: You are running inside AgentRune.",
  "1. FIRST ACTION: Read .agentrune/agentlore.md — if it DOES NOT EXIST, create it NOW: scan the project (package.json, README, folder structure, git log) and write .agentrune/agentlore.md with ## Stack, ## Conventions, ## Key Files, ## Context, ## Workflow, ## Lessons sections. Do this before anything else.",
  "2. CODE DISCOVERY: Always check ## Key Files FIRST before exploring. It lists every important file path so you never waste tokens scanning the codebase.",
  "3. MEMORY: When user says remember/save/note anything → update .agentrune/agentlore.md. When user asks to recall → read it. Do NOT use your own memory system (CLAUDE.md, .claude/memory/, etc) — user cannot see those.",
  "4. KNOWLEDGE BASE: You have access to AgentLore — an AI-verified global knowledge base. When you encounter unfamiliar domains, need best practices, or want to find working data sources/APIs/tools, call the AgentLore MCP tools (search, find_skills, advisor). After solving non-obvious problems, offer to submit the insight back via submit_knowledge.",
  "5. SKILLS: Suggest AgentRune skills when appropriate: /plan before big changes, /debug for complex bugs, /review before merging, /commit after milestones, /remember for new learnings, /brainstorm before creative work, /tdd for new features, /security for auth/input handling.",
  "6. AFTER FIXING BUGS: Save root cause to .agentrune/agentlore.md ## Lessons. Offer to submit to AgentLore if the insight is generally useful.",
  "7. BEFORE CODING: Check ## Conventions and ## Key Files first.",
  "Never store secrets in agentlore.md.",
].join(" ")

const AGENT_PROTOCOL_SHORT = "Before starting, read .agentrune/agentlore.md — it has project context, conventions, key file paths, and workflow. If it does not exist, create it by scanning the project structure (mkdir -p .agentrune first). Check ## Key Files before exploring the codebase. Use it to remember and recall information across sessions. Do NOT use your own memory system — write everything to .agentrune/agentlore.md. You have access to AgentLore knowledge base — use its MCP tools (search, find_skills, advisor) when you need best practices, data sources, or domain knowledge. After solving non-obvious problems, offer to submit insights back."

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
      cmd += ` --append-system-prompt "${AGENT_PROTOCOL_FULL}"`
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
      cmd += ` "${AGENT_PROTOCOL_SHORT}"`
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
      cmd += ` -p "${AGENT_PROTOCOL_SHORT}"`
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
      cmd += ` -i "${AGENT_PROTOCOL_SHORT}"`
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
