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
  command: (settings: ProjectSettings) => string | null
  slashCommands?: SlashCommand[]
}

export interface ProjectSettings {
  model: "sonnet" | "opus" | "haiku"
  bypass: boolean
  planMode: boolean
  autoEdit: boolean
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

export const DEFAULT_SETTINGS: ProjectSettings = {
  model: "sonnet",
  bypass: false,
  planMode: false,
  autoEdit: false,
}

export const AGENTS: AgentDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "AI Coding Assistant",
    command: (s) => {
      let cmd = "claude"
      if (s.model !== "sonnet") cmd += ` --model ${s.model}`
      if (s.bypass) cmd += " --dangerously-skip-permissions"
      return cmd
    },
    slashCommands: [
      // Official Claude Code commands
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
      { command: "/status", description: "Show session status" },
      { command: "/mcp", description: "Manage MCP servers" },
    ],
  },
  {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI Coding Agent",
    command: () => "codex",
    slashCommands: [
      { command: "/help", description: "Show help" },
      { command: "/clear", description: "Clear conversation" },
      { command: "/compact", description: "Compact context" },
    ],
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    description: "Open Source AI Agent",
    command: () => "openclaw chat",
    slashCommands: [
      { command: "/help", description: "Show help" },
      { command: "/clear", description: "Clear conversation" },
    ],
  },
  {
    id: "aider",
    name: "Aider",
    description: "AI Pair Programming",
    command: () => "aider",
    slashCommands: [
      { command: "/help", description: "Show help" },
      { command: "/clear", description: "Clear chat" },
      { command: "/add", description: "Add file to chat" },
      { command: "/drop", description: "Remove file from chat" },
      { command: "/run", description: "Run a shell command" },
      { command: "/diff", description: "Show diff of changes" },
      { command: "/undo", description: "Undo last change" },
      { command: "/commit", description: "Commit changes" },
    ],
  },
  {
    id: "cline",
    name: "Cline",
    description: "AI Coding Assistant",
    command: () => "cline",
    slashCommands: [
      { command: "/help", description: "Show help" },
      { command: "/clear", description: "Clear conversation" },
    ],
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Plain Shell Environment",
    command: () => null,
  },
]
