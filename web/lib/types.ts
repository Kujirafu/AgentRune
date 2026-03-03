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
  icon: string
  command: (settings: ProjectSettings) => string | null
}

export interface ProjectSettings {
  model: "sonnet" | "opus" | "haiku"
  bypass: boolean
  planMode: boolean
  autoEdit: boolean
}

export interface SmartAction {
  label: string
  input: string
  style: "primary" | "danger" | "default"
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
    description: "AI coding assistant",
    icon: "\u{1F916}",
    command: (s) => {
      let cmd = "claude"
      if (s.model !== "sonnet") cmd += ` --model ${s.model}`
      if (s.bypass) cmd += " --dangerously-skip-permissions"
      return cmd
    },
  },
  {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI code agent",
    icon: "\u26A1",
    command: () => "codex",
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    description: "Open-source AI agent",
    icon: "\u{1F99E}",
    command: () => "openclaw chat",
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Plain shell",
    icon: ">_",
    command: () => null,
  },
]
